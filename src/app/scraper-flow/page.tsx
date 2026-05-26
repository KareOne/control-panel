"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/Shell";
import {
  RefreshCw,
  Clock,
  AlertCircle,
  CheckCircle2,
  Circle,
  Loader2,
  ChevronDown,
} from "lucide-react";

/* ─── Pipeline definitions ───────────────────────────────────────────────── */

const SERVICE_PIPELINE: Record<string, string[]> = {
  crunchbase: [
    "request_init", "search", "batch_search", "collection",
    "similarity", "scraping", "enrichment", "completed",
  ],
  tracxn: [
    "request_init", "login", "captcha",
    "search", "scraping", "completed",
  ],
  "news-search": [
    "route", "search_request", "google_search",
    "captcha", "bing_search", "archive_fetch",
  ],
  twitter: [
    "request_init", "search_request",
    "reply_fetch", "thread_fetch",
  ],
};

const SERVICE_COLOR: Record<string, string> = {
  crunchbase:   "#3b82f6",
  tracxn:       "#8b5cf6",
  "news-search":"#10b981",
  twitter:      "#06b6d4",
};

function svcColor(s: string) {
  return SERVICE_COLOR[s] ?? "#6b7280";
}

/* ─── Types ──────────────────────────────────────────────────────────────── */

interface PhaseEvent {
  phase: string;
  step: string;
  ts: string;
  message: string;
}

interface FlowSession {
  sessionId: string;
  service: string;
  startedAt: string;
  lastSeenAt: string;
  durationMs: number;
  currentPhase: string;
  currentStep: string;
  currentMessage: string;
  status: "running" | "completed" | "failed";
  seenPhases: PhaseEvent[];
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function timeAgo(iso?: string): string {
  if (!iso) return "—";
  const d = Date.now() - new Date(iso).getTime();
  if (d < 10_000) return "just now";
  if (d < 60_000) return `${Math.round(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`;
  return `${Math.round(d / 3_600_000)}h ago`;
}

type NodeStatus = "done" | "active" | "failed" | "pending";

function nodeStatus(phase: string, session: FlowSession): NodeStatus {
  const seen = session.seenPhases.find((p) => p.phase === phase);
  if (!seen) return "pending";
  if (
    seen.step === "failed" ||
    seen.step === "error" ||
    seen.step === "all_failed"
  )
    return "failed";
  if (
    session.currentPhase === phase &&
    session.status === "running"
  )
    return "active";
  return "done";
}

/* ─── Pipeline node ──────────────────────────────────────────────────────── */

const NODE_STYLE: Record<
  NodeStatus,
  { bg: string; border: string; text: string; icon: React.ReactNode }
> = {
  done: {
    bg: "#052e16",
    border: "#16a34a",
    text: "#4ade80",
    icon: <CheckCircle2 size={11} />,
  },
  active: {
    bg: "#1e1b4b",
    border: "#818cf8",
    text: "#a5b4fc",
    icon: <Loader2 size={11} className="animate-spin" />,
  },
  failed: {
    bg: "#2d0a0a",
    border: "#dc2626",
    text: "#f87171",
    icon: <AlertCircle size={11} />,
  },
  pending: {
    bg: "transparent",
    border: "#374151",
    text: "#4b5563",
    icon: <Circle size={11} />,
  },
};

function PipelineNode({
  phase,
  status,
  last,
}: {
  phase: string;
  status: NodeStatus;
  last: boolean;
}) {
  const c = NODE_STYLE[status];
  return (
    <div className="flex items-center gap-1 shrink-0">
      <div
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium whitespace-nowrap"
        style={{
          background: c.bg,
          border: `1px solid ${c.border}`,
          color: c.text,
          boxShadow: status === "active" ? `0 0 10px ${c.border}55` : undefined,
        }}
      >
        {c.icon}
        {phase}
      </div>
      {!last && (
        <span
          className="text-[13px] select-none"
          style={{ color: "#374151" }}
        >
          →
        </span>
      )}
    </div>
  );
}

/* ─── Session card ───────────────────────────────────────────────────────── */

function SessionCard({ session }: { session: FlowSession }) {
  const [expanded, setExpanded] = useState(false);
  const col = svcColor(session.service);
  const pipeline = SERVICE_PIPELINE[session.service] ?? [];

  // Merge known pipeline + any extra phases seen (in order seen)
  const extraPhases = session.seenPhases
    .map((p) => p.phase)
    .filter((ph) => !pipeline.includes(ph));
  const allPhases =
    pipeline.length > 0
      ? [...pipeline, ...extraPhases]
      : session.seenPhases.map((p) => p.phase);

  const borderColor =
    session.status === "failed"
      ? "#dc262666"
      : session.status === "completed"
      ? "#16a34a66"
      : `${col}44`;

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ borderColor, background: "var(--bg-card)" }}
    >
      {/* ── Header ── */}
      <div
        className="flex items-center gap-3 px-4 py-2.5"
        style={{ background: `${col}0c`, borderBottom: `1px solid ${col}1a` }}
      >
        <span
          className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded shrink-0"
          style={{ background: `${col}22`, color: col }}
        >
          {session.service}
        </span>

        <span
          className="font-mono text-[10px] truncate min-w-0"
          style={{ color: "var(--text-muted)" }}
        >
          {session.sessionId}
        </span>

        <div className="flex items-center gap-2.5 ms-auto shrink-0">
          <span
            className="text-[10px] flex items-center gap-1"
            style={{ color: "var(--text-muted)" }}
          >
            <Clock size={9} />
            {timeAgo(session.lastSeenAt)}
          </span>

          {session.durationMs > 0 && (
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              ⏱ {fmtDuration(session.durationMs)}
            </span>
          )}

          {session.status === "running" && (
            <span className="flex items-center gap-1 text-[10px] rounded px-1.5 py-0.5 bg-blue-900/40 text-blue-400 border border-blue-800/60">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              live
            </span>
          )}
          {session.status === "completed" && (
            <span className="text-[10px] rounded px-1.5 py-0.5 bg-green-900/40 text-green-400 border border-green-800/60">
              done
            </span>
          )}
          {session.status === "failed" && (
            <span className="text-[10px] rounded px-1.5 py-0.5 bg-red-900/40 text-red-400 border border-red-800/60">
              failed
            </span>
          )}

          <button
            onClick={() => setExpanded((x) => !x)}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Show phase log"
          >
            <ChevronDown
              size={14}
              style={{
                transform: expanded ? "rotate(180deg)" : undefined,
                transition: "transform 0.2s",
              }}
            />
          </button>
        </div>
      </div>

      {/* ── Pipeline ── */}
      <div className="px-4 py-3 overflow-x-auto">
        {allPhases.length > 0 ? (
          <div className="flex items-center gap-0.5 flex-nowrap min-w-max">
            {allPhases.map((ph, i) => (
              <PipelineNode
                key={ph}
                phase={ph}
                status={nodeStatus(ph, session)}
                last={i === allPhases.length - 1}
              />
            ))}
          </div>
        ) : (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            No phase data yet
          </span>
        )}
      </div>

      {/* ── Current step message ── */}
      {session.currentMessage && (
        <div
          className="px-4 pb-3 text-[11px] truncate"
          style={{ color: "var(--text-secondary)" }}
        >
          {session.currentPhase && (
            <span
              className="font-mono me-1.5"
              style={{ color: "var(--text-muted)" }}
            >
              [{session.currentPhase}
              {session.currentStep ? `/${session.currentStep}` : ""}]
            </span>
          )}
          {session.currentMessage}
        </div>
      )}

      {/* ── Expanded phase log ── */}
      {expanded && (
        <div
          className="border-t px-4 py-3 space-y-1"
          style={{ borderColor: "var(--border)", background: "var(--bg-main)" }}
        >
          {session.seenPhases.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              No phase events recorded.
            </p>
          ) : (
            session.seenPhases.map((pe) => (
              <div key={pe.phase} className="flex items-start gap-2 text-[11px]">
                <span
                  className="font-mono shrink-0 mt-px"
                  style={{ color: col, minWidth: 120 }}
                >
                  {pe.phase}
                  {pe.step ? (
                    <span style={{ color: "var(--text-muted)" }}>
                      /{pe.step}
                    </span>
                  ) : null}
                </span>
                <span
                  className="truncate"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {pe.message || "—"}
                </span>
                <span
                  className="shrink-0 ms-auto font-mono"
                  style={{ color: "var(--text-muted)" }}
                >
                  {pe.ts ? new Date(pe.ts).toLocaleTimeString() : ""}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Time presets ───────────────────────────────────────────────────────── */

const TIME_PRESETS = [
  { label: "5 min",   value: "5m"  },
  { label: "20 min",  value: "20m" },
  { label: "1 hour",  value: "1h"  },
  { label: "4 hours", value: "4h"  },
] as const;

function resolveRange(preset: string): { from: string; to: string } {
  const ms: Record<string, number> = {
    "5m":  5   * 60_000,
    "20m": 20  * 60_000,
    "1h":  3_600_000,
    "4h":  4   * 3_600_000,
  };
  const now = Date.now();
  return {
    from: new Date(now - (ms[preset] ?? 20 * 60_000)).toISOString(),
    to:   new Date(now).toISOString(),
  };
}

const ALL_SERVICES = ["crunchbase", "tracxn", "news-search", "twitter"];

/* ─── Page ───────────────────────────────────────────────────────────────── */

export default function ScraperFlowPage() {
  const [sessions, setSessions]       = useState<FlowSession[]>([]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [timePreset, setTimePreset]   = useState("20m");
  const [svcFilter, setSvcFilter]     = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshSec, setRefreshSec]   = useState(5);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { from, to } = resolveRange(timePreset);
    try {
      const res = await fetch("/api/logs/flow", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          from,
          to,
          services: svcFilter ? [svcFilter] : undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) setSessions(data.sessions ?? []);
      else setError(data.error ?? "Query failed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [timePreset, svcFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoRefresh)
      timerRef.current = setInterval(load, refreshSec * 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [autoRefresh, refreshSec, load]);

  const displayed = svcFilter
    ? sessions.filter((s) => s.service === svcFilter)
    : sessions;

  const nLive   = displayed.filter((s) => s.status === "running").length;
  const nFailed = displayed.filter((s) => s.status === "failed").length;
  const nDone   = displayed.filter((s) => s.status === "completed").length;

  return (
    <div style={{ minHeight: "100vh" }}>
      <PageHeader
        title="Scraper Flow"
        desc="Live pipeline — see every session step by step as it happens."
      />

      {/* ── Toolbar ── */}
      <div
        className="px-6 py-3 flex flex-wrap items-center gap-3 border-b"
        style={{
          background: "var(--bg-main)",
          borderColor: "var(--border)",
        }}
      >
        {/* Service tabs */}
        <div className="flex gap-1">
          <button
            onClick={() => setSvcFilter("")}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              !svcFilter
                ? "bg-zinc-700 text-white"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            All
          </button>
          {ALL_SERVICES.map((s) => {
            const active = svcFilter === s;
            const col = svcColor(s);
            return (
              <button
                key={s}
                onClick={() => setSvcFilter(active ? "" : s)}
                className="px-3 py-1.5 rounded text-xs font-medium transition-all"
                style={{
                  background: active ? `${col}22` : "transparent",
                  color: active ? col : "#6b7280",
                  border: `1px solid ${active ? col + "55" : "transparent"}`,
                }}
              >
                {s}
              </button>
            );
          })}
        </div>

        {/* Time range */}
        <div className="flex gap-1">
          {TIME_PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => setTimePreset(p.value)}
              className={`px-2.5 py-1.5 rounded text-xs transition-colors ${
                timePreset === p.value
                  ? "bg-zinc-700 text-white"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Live stats */}
        <div className="flex items-center gap-4 ms-auto text-xs">
          {nLive > 0 && (
            <span className="flex items-center gap-1.5 text-blue-400">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              {nLive} live
            </span>
          )}
          {nFailed > 0 && (
            <span className="text-red-400">{nFailed} failed</span>
          )}
          {nDone > 0 && (
            <span className="text-green-400">{nDone} done</span>
          )}
        </div>

        {/* Auto-refresh */}
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            <span className="text-zinc-400">Auto</span>
          </label>
          {autoRefresh && (
            <select
              value={refreshSec}
              onChange={(e) => setRefreshSec(+e.target.value)}
              className="rounded border border-zinc-700 px-1.5 py-1 text-xs bg-transparent text-zinc-300"
            >
              {[3, 5, 10, 30].map((s) => (
                <option key={s} value={s}>
                  {s}s
                </option>
              ))}
            </select>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs text-white disabled:opacity-60"
            style={{ background: "var(--primary)" }}
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="mx-6 mt-4 rounded border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* ── Sessions ── */}
      <div className="p-6 space-y-3">
        {!loading && !error && displayed.length === 0 && (
          <div
            className="rounded-xl p-16 text-center border border-dashed"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            <p className="text-sm">
              No sessions in the last{" "}
              {TIME_PRESETS.find((p) => p.value === timePreset)?.label}.
            </p>
            <p className="text-xs mt-1 opacity-60">
              Sessions appear when a scrape request is triggered.
            </p>
          </div>
        )}
        {displayed.map((s) => (
          <SessionCard key={s.sessionId} session={s} />
        ))}
      </div>
    </div>
  );
}
