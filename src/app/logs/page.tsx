"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { PageHeader } from "@/components/Shell";
import { useUI } from "@/components/Providers";
import { t } from "@/lib/i18n";
import {
  RefreshCw,
  Settings2,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ActivitySquare,
  ListFilter,
  Search,
  Clock,
  Layers,
} from "lucide-react";

/* ─── Types ─────────────────────────────────────────────────────────────────── */

interface LogHit {
  _id?: string;
  _index?: string;
  "@timestamp"?: string;
  phase?: string;
  session_id?: string;
  scraper?: string;
  level?: string;
  message?: string;
  [key: string]: unknown;
}

interface HistoBucket {
  ts: string;
  count: number;
}

interface SessionInfo {
  sessionId: string;
  count: number;
  latestTs?: string;
  phase?: string;
  message?: string;
  scraper?: string;
  level?: string;
}

interface QueryResult {
  ok: boolean;
  error?: string;
  total: number;
  hits: LogHit[];
  histogram: HistoBucket[];
  phaseCounts: Record<string, number>;
  scrapers: string[];
  levels: string[];
  sessions: SessionInfo[];
  interval: string;
}

interface ElkConfig {
  url?: string;
  indexPattern?: string;
  authType?: "none" | "basic" | "apikey";
  username?: string;
  password?: string;
  apiKey?: string;
}

/* ─── Phase colours ─────────────────────────────────────────────────────────── */

const NAMED_COLORS: Record<string, string> = {
  request_init: "#3b82f6",
  completed:    "#10b981",
  processing:   "#f59e0b",
  started:      "#8b5cf6",
  failed:       "#ef4444",
  error:        "#dc2626",
  retry:        "#f97316",
  timeout:      "#dc2626",
  fetching:     "#06b6d4",
  parsing:      "#84cc16",
  saving:       "#14b8a6",
  pending:      "#6b7280",
  queued:       "#64748b",
  running:      "#a78bfa",
};

const PALETTE = [
  "#3b82f6","#10b981","#f59e0b","#8b5cf6","#ec4899",
  "#06b6d4","#84cc16","#f97316","#14b8a6","#a78bfa",
];

function phaseColor(phase: string): string {
  if (NAMED_COLORS[phase]) return NAMED_COLORS[phase];
  let h = 0;
  for (const c of phase) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return PALETTE[h % PALETTE.length];
}

/* ─── Tiny components ───────────────────────────────────────────────────────── */

function PhaseBadge({ phase, small }: { phase: string; small?: boolean }) {
  const col = phaseColor(phase);
  return (
    <span
      className={`inline-flex items-center rounded font-medium ${small ? "px-1.5 py-px text-[10px]" : "px-2 py-0.5 text-[11px]"}`}
      style={{ background: `${col}22`, color: col, border: `1px solid ${col}55` }}
    >
      {phase}
    </span>
  );
}

function LevelBadge({ level }: { level?: string }) {
  const map: Record<string, string> = {
    ERROR: "text-red-500",
    WARN: "text-amber-500",
    WARNING: "text-amber-500",
    DEBUG: "text-zinc-500",
    INFO: "text-sky-400",
  };
  const cls = map[(level || "").toUpperCase()] ?? "text-zinc-400";
  return (
    <span className={`text-[10px] font-mono font-semibold uppercase ${cls}`}>
      {level ?? "—"}
    </span>
  );
}

function Card({
  title,
  children,
  right,
}: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function timeAgo(isoTs?: string): string {
  if (!isoTs) return "—";
  const diff = Date.now() - new Date(isoTs).getTime();
  if (diff < 10_000) return "just now";
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3600_000)}h ago`;
}

function fmtTs(isoTs?: string): string {
  if (!isoTs) return "—";
  try {
    const d = new Date(isoTs);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return isoTs; }
}

/* ─── Time range presets ────────────────────────────────────────────────────── */

const TIME_PRESETS = [
  { label: "Last 5 min",   value: "5m" },
  { label: "Last 20 min",  value: "20m" },
  { label: "Last 1 hour",  value: "1h" },
  { label: "Last 4 hours", value: "4h" },
  { label: "Last 24 hours",value: "24h" },
  { label: "Last 7 days",  value: "7d" },
] as const;

function resolveRange(preset: string): { from: string; to: string } {
  const now = new Date();
  const durations: Record<string, number> = {
    "5m":  5 * 60_000,
    "20m": 20 * 60_000,
    "1h":  3600_000,
    "4h":  4 * 3600_000,
    "24h": 24 * 3600_000,
    "7d":  7 * 86400_000,
  };
  const ms = durations[preset] ?? 20 * 60_000;
  return {
    from: new Date(now.getTime() - ms).toISOString(),
    to:   now.toISOString(),
  };
}

/* ─── Session Tracker ───────────────────────────────────────────────────────── */

function SessionCard({ s, now }: { s: SessionInfo; now: number }) {
  const col = s.phase ? phaseColor(s.phase) : "#6b7280";
  const ageMs = s.latestTs ? now - new Date(s.latestTs).getTime() : Infinity;
  const stale = ageMs > 5 * 60_000;

  return (
    <div
      className="rounded-lg p-3 border flex flex-col gap-1.5 min-w-0"
      style={{
        borderColor: `${col}55`,
        background: `${col}08`,
        opacity: stale ? 0.6 : 1,
      }}
    >
      <div className="flex items-center gap-2 justify-between">
        {s.phase ? <PhaseBadge phase={s.phase} /> : <span className="text-zinc-500 text-xs">—</span>}
        <span className="text-[10px] text-zinc-500 shrink-0">
          <Clock size={9} className="inline me-0.5" />
          {timeAgo(s.latestTs)}
        </span>
      </div>

      <div className="font-mono text-[10px] truncate" style={{ color: "var(--text-muted)" }}>
        {s.sessionId}
      </div>

      {s.message && (
        <div className="text-[11px] truncate" style={{ color: "var(--text-secondary)" }}>
          {s.message}
        </div>
      )}

      <div className="flex items-center gap-2 mt-0.5">
        {s.scraper && (
          <span className="text-[10px] rounded bg-zinc-200 dark:bg-zinc-800 px-1.5 py-px">
            {s.scraper}
          </span>
        )}
        {s.level && <LevelBadge level={s.level} />}
        <span className="text-[10px] text-zinc-500 ms-auto">
          {s.count} logs
        </span>
      </div>
    </div>
  );
}

/* ─── Log row ────────────────────────────────────────────────────────────────── */

function LogRow({ hit }: { hit: LogHit }) {
  const [open, setOpen] = useState(false);
  const extra = Object.entries(hit).filter(([k]) => !["_id","_index","@timestamp","phase","session_id","scraper","level","message"].includes(k));

  return (
    <>
      <tr
        className="border-b border-zinc-100 dark:border-zinc-800/60 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 cursor-pointer"
        onClick={() => setOpen((x) => !x)}
      >
        <td className="py-1.5 ps-2 pe-3 w-4">
          {open
            ? <ChevronDown size={11} className="text-zinc-400" />
            : <ChevronRight size={11} className="text-zinc-400" />}
        </td>
        <td className="py-1.5 pe-3 font-mono text-[11px] whitespace-nowrap text-zinc-500">
          {fmtTs(hit["@timestamp"] as string)}
        </td>
        <td className="py-1.5 pe-3">
          <LevelBadge level={hit.level as string} />
        </td>
        <td className="py-1.5 pe-3">
          {hit.phase ? <PhaseBadge phase={hit.phase} small /> : <span className="text-zinc-400 text-[11px]">—</span>}
        </td>
        <td className="py-1.5 pe-3 font-mono text-[10px] text-zinc-500 hidden md:table-cell max-w-[120px] truncate">
          {hit.session_id ? (hit.session_id as string).slice(0, 16) + "…" : "—"}
        </td>
        <td className="py-1.5 pe-3 text-[10px] text-zinc-500 hidden lg:table-cell">
          {hit.scraper as string ?? "—"}
        </td>
        <td className="py-1.5 pe-1 text-[12px] max-w-[400px] truncate">
          {hit.message as string ?? "—"}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-zinc-200 dark:border-zinc-800">
          <td colSpan={7} className="px-3 py-3 bg-zinc-50 dark:bg-zinc-950">
            <div className="flex flex-wrap gap-2 mb-2">
              {hit.session_id && (
                <span className="text-[11px] font-mono">
                  <span className="text-zinc-400">session_id: </span>
                  {hit.session_id as string}
                </span>
              )}
              {hit["@timestamp"] && (
                <span className="text-[11px] font-mono">
                  <span className="text-zinc-400">@timestamp: </span>
                  {hit["@timestamp"] as string}
                </span>
              )}
              {hit._index && (
                <span className="text-[11px] font-mono">
                  <span className="text-zinc-400">index: </span>
                  {hit._index}
                </span>
              )}
            </div>
            {extra.length > 0 && (
              <pre className="rounded bg-zinc-100 dark:bg-zinc-900 p-2 text-[11px] overflow-x-auto max-h-48">
                {JSON.stringify(Object.fromEntries(extra), null, 2)}
              </pre>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/* ─── Config editor ─────────────────────────────────────────────────────────── */

function ConfigEditor({
  onSaved,
  canEdit,
}: {
  onSaved: () => void;
  canEdit: boolean;
}) {
  const [cfg, setCfg] = useState<ElkConfig>({ authType: "none" });
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/logs/config", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { setCfg(d); setLoading(false); });
  }, []);

  const save = async () => {
    await fetch("/api/logs/config", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cfg),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    onSaved();
  };

  if (loading) return <p className="text-sm text-zinc-500">Loading config…</p>;

  return (
    <div className="space-y-3 max-w-xl">
      <label className="block text-sm">
        <span className="text-zinc-500">Elasticsearch URL</span>
        <input
          value={cfg.url ?? ""}
          onChange={(e) => setCfg({ ...cfg, url: e.target.value })}
          disabled={!canEdit}
          placeholder="http://localhost:9200"
          className="mt-1 w-full rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 py-1.5 font-mono text-sm disabled:opacity-60"
        />
      </label>

      <label className="block text-sm">
        <span className="text-zinc-500">Index pattern</span>
        <input
          value={cfg.indexPattern ?? ""}
          onChange={(e) => setCfg({ ...cfg, indexPattern: e.target.value })}
          disabled={!canEdit}
          placeholder="tracxn-scraper-logs-*"
          className="mt-1 w-full rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 py-1.5 font-mono text-sm disabled:opacity-60"
        />
      </label>

      <div className="text-sm">
        <span className="text-zinc-500">Authentication</span>
        <div className="mt-1 flex gap-3">
          {(["none","basic","apikey"] as const).map((t) => (
            <label key={t} className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="authType"
                value={t}
                checked={cfg.authType === t}
                onChange={() => setCfg({ ...cfg, authType: t })}
                disabled={!canEdit}
              />
              <span className="text-xs capitalize">{t}</span>
            </label>
          ))}
        </div>
      </div>

      {cfg.authType === "basic" && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="text-zinc-500">Username</span>
            <input
              value={cfg.username ?? ""}
              onChange={(e) => setCfg({ ...cfg, username: e.target.value })}
              disabled={!canEdit}
              className="mt-1 w-full rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 py-1.5 text-sm disabled:opacity-60"
            />
          </label>
          <label className="block text-sm">
            <span className="text-zinc-500">Password</span>
            <input
              type="password"
              value={cfg.password ?? ""}
              onChange={(e) => setCfg({ ...cfg, password: e.target.value })}
              disabled={!canEdit}
              placeholder="unchanged if blank"
              className="mt-1 w-full rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 py-1.5 text-sm disabled:opacity-60"
            />
          </label>
        </div>
      )}

      {cfg.authType === "apikey" && (
        <label className="block text-sm">
          <span className="text-zinc-500">API Key</span>
          <input
            value={cfg.apiKey ?? ""}
            onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })}
            disabled={!canEdit}
            placeholder="unchanged if blank"
            className="mt-1 w-full rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 py-1.5 font-mono text-sm disabled:opacity-60"
          />
        </label>
      )}

      {canEdit && (
        <button
          onClick={save}
          className="rounded px-3 py-1.5 text-sm text-white"
          style={{ background: "var(--primary)" }}
        >
          {saved ? "Saved ✓" : "Save connection"}
        </button>
      )}
      {!canEdit && (
        <p className="text-xs text-zinc-500">ENGINEER role required to edit.</p>
      )}
    </div>
  );
}

/* ─── Phase filter dropdown ─────────────────────────────────────────────────── */

function PhaseFilterDropdown({
  phases,
  selected,
  onChange,
}: {
  phases: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const toggle = (p: string) =>
    onChange(selected.includes(p) ? selected.filter((x) => x !== p) : [...selected, p]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded border border-zinc-300 dark:border-zinc-700 px-2.5 py-1.5 text-xs"
        style={{ background: "var(--bg-card)" }}
      >
        <ListFilter size={12} />
        {selected.length ? `${selected.length} phase${selected.length > 1 ? "s" : ""}` : "All phases"}
        <ChevronDown size={10} />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-50 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-xl min-w-[180px] overflow-hidden"
          style={{ background: "var(--bg-panel)" }}
        >
          <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
            <span className="text-xs text-zinc-500">Filter by phase</span>
            {selected.length > 0 && (
              <button onClick={() => onChange([])} className="text-[10px] text-zinc-400 underline">
                clear
              </button>
            )}
          </div>
          {phases.length === 0
            ? <p className="px-3 py-2 text-xs text-zinc-500">No phases discovered yet</p>
            : phases.map((p) => (
                <label
                  key={p}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(p)}
                    onChange={() => toggle(p)}
                    className="shrink-0"
                  />
                  <PhaseBadge phase={p} small />
                </label>
              ))}
        </div>
      )}
    </div>
  );
}

/* ─── Main page ─────────────────────────────────────────────────────────────── */

export default function LogsPage() {
  const { lang } = useUI();

  // Query state
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);

  // Filter state
  const [search, setSearch] = useState("");
  const [timePreset, setTimePreset] = useState("20m");
  const [selectedPhases, setSelectedPhases] = useState<string[]>([]);
  const [selectedScraper, setSelectedScraper] = useState("");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  // Auto-refresh
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshSec, setRefreshSec] = useState(10);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tabs
  const [activeTab, setActiveTab] = useState<"logs" | "sessions">("sessions");

  // Config editor
  const [showConfig, setShowConfig] = useState(false);

  // Time picker dropdown
  const [showTimePicker, setShowTimePicker] = useState(false);
  const timePickerRef = useRef<HTMLDivElement>(null);

  // User role for edit gating
  const [canEdit, setCanEdit] = useState(false);
  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((me) => setCanEdit(me?.role === "ADMIN" || me?.role === "ENGINEER"))
      .catch(() => {});
  }, []);

  // Ticker for stale indicator in session cards
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  // Close time picker on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (timePickerRef.current && !timePickerRef.current.contains(e.target as Node))
        setShowTimePicker(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const runQuery = useCallback(async () => {
    setLoading(true);
    setQueryError(null);
    const { from, to } = resolveRange(timePreset);
    try {
      const res = await fetch("/api/logs/query", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          from,
          to,
          search: search || undefined,
          phases: selectedPhases.length ? selectedPhases : undefined,
          scraper: selectedScraper || undefined,
          sortDir,
          includeSessions: true,
        }),
      });
      const data: QueryResult = await res.json();
      if (!data.ok) {
        setQueryError(data.error ?? "Unknown error");
      } else {
        setResult(data);
      }
    } catch (e) {
      setQueryError(`Request failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setLoading(false);
    }
  }, [search, timePreset, selectedPhases, selectedScraper, sortDir]);

  // Run on mount and whenever filters change
  useEffect(() => { runQuery(); }, [runQuery]);

  // Auto-refresh
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoRefresh) {
      timerRef.current = setInterval(runQuery, refreshSec * 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [autoRefresh, refreshSec, runQuery]);

  // Discovered phases from aggregation + currently-selected
  const allPhases = result
    ? Array.from(new Set([...Object.keys(result.phaseCounts), ...selectedPhases]))
    : selectedPhases;

  const phaseLabel =
    TIME_PRESETS.find((p) => p.value === timePreset)?.label ?? timePreset;

  return (
    <div style={{ minHeight: "100vh" }}>
      <PageHeader
        title={t("logsTitle", lang)}
        desc={t("logsDesc", lang)}
      />

      {/* ── Toolbar ── */}
      <div
        className="px-6 py-3 flex flex-wrap items-center gap-3 border-b border-zinc-200 dark:border-zinc-800"
        style={{ background: "var(--bg-main)" }}
      >
        {/* Search */}
        <div className="flex-1 min-w-[200px] relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runQuery()}
            placeholder="Filter logs (KQL syntax or text search)…"
            className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 ps-8 pe-3 py-1.5 text-sm"
          />
        </div>

        {/* Time picker */}
        <div className="relative" ref={timePickerRef}>
          <button
            onClick={() => setShowTimePicker(!showTimePicker)}
            className="flex items-center gap-1.5 rounded border border-zinc-300 dark:border-zinc-700 px-2.5 py-1.5 text-xs whitespace-nowrap"
            style={{ background: "var(--bg-card)" }}
          >
            <Clock size={12} />
            {phaseLabel}
            <ChevronDown size={10} />
          </button>
          {showTimePicker && (
            <div
              className="absolute right-0 top-full mt-1 z-50 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-xl overflow-hidden"
              style={{ background: "var(--bg-panel)" }}
            >
              {TIME_PRESETS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => { setTimePreset(p.value); setShowTimePicker(false); }}
                  className={`block w-full px-4 py-2 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                    timePreset === p.value ? "font-semibold" : ""
                  }`}
                  style={{ color: timePreset === p.value ? "var(--primary)" : undefined }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Phase filter */}
        <PhaseFilterDropdown
          phases={allPhases}
          selected={selectedPhases}
          onChange={setSelectedPhases}
        />

        {/* Scraper filter */}
        {result && result.scrapers.length > 0 && (
          <select
            value={selectedScraper}
            onChange={(e) => setSelectedScraper(e.target.value)}
            className="rounded border border-zinc-300 dark:border-zinc-700 px-2 py-1.5 text-xs bg-white dark:bg-zinc-900"
          >
            <option value="">All scrapers</option>
            {result.scrapers.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}

        {/* Sort direction */}
        <button
          onClick={() => setSortDir((d) => d === "desc" ? "asc" : "desc")}
          className="rounded border border-zinc-300 dark:border-zinc-700 px-2.5 py-1.5 text-xs"
          style={{ background: "var(--bg-card)" }}
          title="Toggle sort direction"
        >
          {sortDir === "desc" ? "Newest first" : "Oldest first"}
        </button>

        {/* Auto-refresh */}
        <div className="flex items-center gap-1.5 ms-auto">
          <label className="flex items-center gap-1 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            <span className="text-zinc-500">Auto</span>
          </label>
          {autoRefresh && (
            <select
              value={refreshSec}
              onChange={(e) => setRefreshSec(+e.target.value)}
              className="rounded border border-zinc-300 dark:border-zinc-700 px-1.5 py-1 text-xs bg-transparent"
            >
              {[5, 10, 30, 60].map((s) => (
                <option key={s} value={s}>{s}s</option>
              ))}
            </select>
          )}
          <button
            onClick={runQuery}
            disabled={loading}
            className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs text-white disabled:opacity-60"
            style={{ background: "var(--primary)" }}
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Error banner ── */}
      {queryError && (
        <div className="mx-6 mt-4 rounded border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {queryError}
          {queryError.includes("not configured") && (
            <button
              onClick={() => setShowConfig(true)}
              className="ms-3 underline"
            >
              Configure connection ↓
            </button>
          )}
        </div>
      )}

      <div className="p-6 space-y-4">

        {/* ── Stats strip ── */}
        {result && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-zinc-500">
              <span className="font-semibold text-base" style={{ color: "var(--text-main)" }}>
                {result.total.toLocaleString()}
              </span>{" "}
              documents · {result.interval} buckets
            </span>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(result.phaseCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([phase, count]) => (
                  <button
                    key={phase}
                    onClick={() =>
                      setSelectedPhases((prev) =>
                        prev.includes(phase) ? prev.filter((x) => x !== phase) : [...prev, phase]
                      )
                    }
                    title={`${count} logs — click to filter`}
                    className={`flex items-center gap-1 rounded px-1.5 py-0.5 border text-[10px] transition-opacity ${
                      selectedPhases.length && !selectedPhases.includes(phase) ? "opacity-40" : ""
                    }`}
                    style={{
                      borderColor: `${phaseColor(phase)}55`,
                      background: `${phaseColor(phase)}11`,
                      color: phaseColor(phase),
                    }}
                  >
                    {phase}
                    <span className="opacity-70">{count.toLocaleString()}</span>
                  </button>
                ))}
            </div>
          </div>
        )}

        {/* ── Histogram ── */}
        {result && result.histogram.length > 0 && (
          <Card title="Log volume over time">
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={result.histogram} margin={{ top: 2, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,100,120,0.15)" />
                  <XAxis
                    dataKey="ts"
                    tick={{ fontSize: 9 }}
                    tickFormatter={(v) => fmtTs(v)}
                    interval="preserveStartEnd"
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 9 }} />
                  <Tooltip
                    labelFormatter={(v) => fmtTs(v as string)}
                    contentStyle={{
                      background: "var(--bg-panel)",
                      border: "1px solid var(--border)",
                      fontSize: 11,
                    }}
                  />
                  <Bar dataKey="count" fill="#10b981" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}

        {/* ── Tabs ── */}
        <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
          {[
            { key: "sessions" as const, label: "Session Tracker", icon: <ActivitySquare size={13} /> },
            { key: "logs" as const, label: "Log Stream", icon: <Layers size={13} /> },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-blue-500 font-medium"
                  : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
              style={activeTab === tab.key ? { color: "var(--primary)" } : {}}
            >
              {tab.icon}
              {tab.label}
              {tab.key === "sessions" && result && (
                <span className="rounded-full text-[10px] px-1.5 py-px bg-zinc-200 dark:bg-zinc-700">
                  {result.sessions.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Session Tracker ── */}
        {activeTab === "sessions" && (
          <>
            {!result && !loading && (
              <p className="text-sm text-zinc-500 py-4">
                {queryError ? "Fix the connection above to see sessions." : "Loading…"}
              </p>
            )}
            {result && result.sessions.length === 0 && (
              <div
                className="rounded-xl p-10 text-center text-sm border border-dashed"
                style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
              >
                No sessions found in the selected time range.
              </div>
            )}
            {result && result.sessions.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {result.sessions.map((s) => (
                  <SessionCard key={s.sessionId} s={s} now={now} />
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Log stream table ── */}
        {activeTab === "logs" && (
          <Card
            title="Log stream"
            right={
              result && (
                <span className="text-xs text-zinc-500">
                  showing {result.hits.length} of {result.total.toLocaleString()}
                </span>
              )
            }
          >
            {loading && !result && (
              <p className="text-sm text-zinc-500">Loading…</p>
            )}
            {result && result.hits.length === 0 && (
              <p className="text-sm text-zinc-500">No logs in the selected time range.</p>
            )}
            {result && result.hits.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500">
                      <th className="w-4" />
                      <th className="py-2 pe-3 text-start font-medium">Time</th>
                      <th className="py-2 pe-3 text-start font-medium">Level</th>
                      <th className="py-2 pe-3 text-start font-medium">Phase</th>
                      <th className="py-2 pe-3 text-start font-medium hidden md:table-cell">Session</th>
                      <th className="py-2 pe-3 text-start font-medium hidden lg:table-cell">Scraper</th>
                      <th className="py-2 pe-1 text-start font-medium">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.hits.map((hit, i) => (
                      <LogRow key={hit._id ?? i} hit={hit} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {/* ── Config editor ── */}
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="flex items-center gap-2 w-full px-4 py-3 text-sm font-medium text-start"
          >
            <Settings2 size={14} className="text-zinc-400" />
            <span>Elasticsearch connection</span>
            {!result?.ok && (
              <span className="ms-2 text-[10px] rounded bg-amber-500/20 text-amber-500 px-2 py-0.5">
                not connected
              </span>
            )}
            {showConfig ? <ChevronUp size={13} className="ms-auto text-zinc-400" /> : <ChevronDown size={13} className="ms-auto text-zinc-400" />}
          </button>
          {showConfig && (
            <div className="px-4 pb-4 border-t border-zinc-200 dark:border-zinc-800 pt-3">
              <ConfigEditor canEdit={canEdit} onSaved={runQuery} />
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
