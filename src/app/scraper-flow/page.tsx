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
  Activity,
  Users,
  Wifi,
  WifiOff,
  Settings2,
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

// What each step does — shown as a tooltip-like description in the health tab
const STEP_DESC: Record<string, Record<string, string>> = {
  crunchbase: {
    request_init:  "Incoming request validation",
    search:        "Keyword search on Crunchbase",
    batch_search:  "Batch keyword expansion",
    collection:    "Collect company URLs",
    similarity:    "Vector similarity scoring",
    scraping:      "Scrape company profile pages",
    enrichment:    "Enrich with additional data",
    completed:     "Request fulfilled successfully",
  },
  tracxn: {
    request_init:  "Incoming request + DB check",
    login:         "Browser login (signup API + OTP flow)",
    captcha:       "reCAPTCHA / audio captcha solve",
    search:        "TracXN internal API search",
    scraping:      "Company page scraping",
    completed:     "Request fulfilled successfully",
  },
  "news-search": {
    route:          "Route selection (Google / Bing / Archive)",
    search_request: "Prepare search query",
    google_search:  "Google search via Puppeteer",
    captcha:        "Captcha solving (2captcha)",
    bing_search:    "Bing search fallback",
    archive_fetch:  "Archive.org fetch fallback",
  },
  twitter: {
    request_init:   "Incoming request init",
    search_request: "Twitter API tweet search",
    reply_fetch:    "Fetch tweet replies",
    thread_fetch:   "Reconstruct full thread",
  },
};

const SERVICE_COLOR: Record<string, string> = {
  crunchbase:    "#3b82f6",
  tracxn:        "#8b5cf6",
  "news-search": "#10b981",
  twitter:       "#06b6d4",
};

const ALL_SERVICES = ["crunchbase", "tracxn", "news-search", "twitter"];

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

interface StepProbe {
  ok: boolean;
  statusCode?: number;
  latencyMs: number;
  data?: unknown;
  error?: string;
}

interface ServiceHealth {
  url: string;
  ok: boolean;
  latencyMs: number;
  status: string;
  data: Record<string, unknown> | null;
  error?: string;
  steps?: Record<string, StepProbe>;
}

interface WorkersByType {
  total: number;
  idle: number;
  working: number;
}

interface HealthResult {
  ok: boolean;
  services: Record<string, ServiceHealth>;
  orchestrator: {
    ok: boolean;
    latencyMs: number;
    status: string;
    error?: string;
    workers: { ok: boolean; byType: Record<string, WorkersByType>; error?: string };
  };
  checkedAt: string;
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
  if (seen.step === "failed" || seen.step === "error" || seen.step === "all_failed") return "failed";
  if (session.currentPhase === phase && session.status === "running") return "active";
  return "done";
}

/* ─── Pipeline node ──────────────────────────────────────────────────────── */

const NODE_STYLE: Record<NodeStatus, { bg: string; border: string; text: string; icon: React.ReactNode }> = {
  done:    { bg: "#052e16", border: "#16a34a", text: "#4ade80", icon: <CheckCircle2 size={11} /> },
  active:  { bg: "#1e1b4b", border: "#818cf8", text: "#a5b4fc", icon: <Loader2 size={11} className="animate-spin" /> },
  failed:  { bg: "#2d0a0a", border: "#dc2626", text: "#f87171", icon: <AlertCircle size={11} /> },
  pending: { bg: "transparent", border: "#374151", text: "#4b5563", icon: <Circle size={11} /> },
};

function PipelineNode({ phase, status, last }: { phase: string; status: NodeStatus; last: boolean }) {
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
      {!last && <span className="text-[13px] select-none" style={{ color: "#374151" }}>→</span>}
    </div>
  );
}

/* ─── Session card ───────────────────────────────────────────────────────── */

function SessionCard({ session }: { session: FlowSession }) {
  const [expanded, setExpanded] = useState(false);
  const col = svcColor(session.service);
  const pipeline = SERVICE_PIPELINE[session.service] ?? [];

  const extraPhases = session.seenPhases
    .map((p) => p.phase)
    .filter((ph) => !pipeline.includes(ph));
  const allPhases =
    pipeline.length > 0
      ? [...pipeline, ...extraPhases]
      : session.seenPhases.map((p) => p.phase);

  const borderColor =
    session.status === "failed" ? "#dc262666" :
    session.status === "completed" ? "#16a34a66" :
    `${col}44`;

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor, background: "var(--bg-card)" }}>
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
        <span className="font-mono text-[10px] truncate min-w-0" style={{ color: "var(--text-muted)" }}>
          {session.sessionId}
        </span>
        <div className="flex items-center gap-2.5 ms-auto shrink-0">
          <span className="text-[10px] flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
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
            <span className="text-[10px] rounded px-1.5 py-0.5 bg-green-900/40 text-green-400 border border-green-800/60">done</span>
          )}
          {session.status === "failed" && (
            <span className="text-[10px] rounded px-1.5 py-0.5 bg-red-900/40 text-red-400 border border-red-800/60">failed</span>
          )}
          <button
            onClick={() => setExpanded((x) => !x)}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <ChevronDown size={14} style={{ transform: expanded ? "rotate(180deg)" : undefined, transition: "transform 0.2s" }} />
          </button>
        </div>
      </div>

      <div className="px-4 py-3 overflow-x-auto">
        {allPhases.length > 0 ? (
          <div className="flex items-center gap-0.5 flex-nowrap min-w-max">
            {allPhases.map((ph, i) => (
              <PipelineNode key={ph} phase={ph} status={nodeStatus(ph, session)} last={i === allPhases.length - 1} />
            ))}
          </div>
        ) : (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>No phase data yet</span>
        )}
      </div>

      {session.currentMessage && (
        <div className="px-4 pb-3 text-[11px] truncate" style={{ color: "var(--text-secondary)" }}>
          {session.currentPhase && (
            <span className="font-mono me-1.5" style={{ color: "var(--text-muted)" }}>
              [{session.currentPhase}{session.currentStep ? `/${session.currentStep}` : ""}]
            </span>
          )}
          {session.currentMessage}
        </div>
      )}

      {expanded && (
        <div className="border-t px-4 py-3 space-y-1" style={{ borderColor: "var(--border)", background: "var(--bg-main)" }}>
          {session.seenPhases.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>No phase events recorded.</p>
          ) : (
            session.seenPhases.map((pe) => (
              <div key={pe.phase} className="flex items-start gap-2 text-[11px]">
                <span className="font-mono shrink-0 mt-px" style={{ color: col, minWidth: 120 }}>
                  {pe.phase}
                  {pe.step ? <span style={{ color: "var(--text-muted)" }}>/{pe.step}</span> : null}
                </span>
                <span className="truncate" style={{ color: "var(--text-secondary)" }}>{pe.message || "—"}</span>
                <span className="shrink-0 ms-auto font-mono" style={{ color: "var(--text-muted)" }}>
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

/* ─── Health tab ─────────────────────────────────────────────────────────── */

// Step coverage: service → phase → most-recent ISO timestamp seen
type StepCoverage = Record<string, Record<string, string>>;

const SIX_HOURS = 6 * 3_600_000;
const TWENTY_FOUR_HOURS = 24 * 3_600_000;

function stepCoverageClass(ts: string | undefined): "recent" | "stale" | "none" {
  if (!ts) return "none";
  const age = Date.now() - new Date(ts).getTime();
  if (age < SIX_HOURS) return "recent";
  if (age < TWENTY_FOUR_HOURS) return "stale";
  return "none";
}

function StepChip({
  phase,
  coverage,
  serviceDown,
  desc,
}: {
  phase: string;
  coverage: string | undefined;
  serviceDown: boolean;
  desc?: string;
}) {
  const cls = serviceDown ? "down" : stepCoverageClass(coverage);

  const style: React.CSSProperties =
    cls === "recent"  ? { background: "#052e16", border: "1px solid #16a34a", color: "#4ade80" } :
    cls === "stale"   ? { background: "#1c1408", border: "1px solid #a16207", color: "#fbbf24" } :
    cls === "down"    ? { background: "#2d0a0a", border: "1px solid #7f1d1d", color: "#f87171" } :
                        { background: "transparent", border: "1px solid #374151", color: "#4b5563" };

  return (
    <div className="group relative">
      <div
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium whitespace-nowrap cursor-default"
        style={style}
      >
        {phase}
        {cls === "recent" && <span className="w-1.5 h-1.5 rounded-full bg-green-400" />}
        {cls === "stale"  && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />}
      </div>
      {/* Tooltip */}
      <div
        className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-10 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ minWidth: 160 }}
      >
        <div
          className="rounded-lg px-2.5 py-2 text-[10px] shadow-lg"
          style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
        >
          {desc && <p className="mb-1" style={{ color: "var(--text-secondary)" }}>{desc}</p>}
          {coverage && cls !== "none" && cls !== "down" ? (
            <p>Last seen {timeAgo(coverage)}</p>
          ) : (
            <p>{serviceDown ? "Service unreachable" : "Not seen in last 24h"}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ServiceHealthCard({
  service,
  health,
  stepCov,
  workers,
}: {
  service: string;
  health: ServiceHealth | undefined;
  stepCov: Record<string, string>;
  workers: WorkersByType | undefined;
}) {
  const col = svcColor(service);
  const steps = SERVICE_PIPELINE[service] ?? [];
  const descs = STEP_DESC[service] ?? {};
  const isDown = !health?.ok;

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ borderColor: isDown ? "#7f1d1d66" : `${col}44`, background: "var(--bg-card)" }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-2.5"
        style={{ background: `${col}0c`, borderBottom: `1px solid ${col}1a` }}
      >
        <span
          className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
          style={{ background: `${col}22`, color: col }}
        >
          {service}
        </span>

        {health ? (
          health.ok ? (
            <span className="flex items-center gap-1 text-[10px] rounded px-1.5 py-0.5 bg-green-900/40 text-green-400 border border-green-800/60">
              <Wifi size={9} /> {health.status}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] rounded px-1.5 py-0.5 bg-red-900/40 text-red-400 border border-red-800/60">
              <WifiOff size={9} /> unreachable
            </span>
          )
        ) : (
          <span className="text-[10px] rounded px-1.5 py-0.5" style={{ color: "var(--text-muted)", background: "var(--bg-main)", border: "1px solid var(--border)" }}>
            not checked
          </span>
        )}

        {health?.ok && (
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            {health.latencyMs}ms
          </span>
        )}

        <div className="ms-auto flex items-center gap-3 text-[10px]" style={{ color: "var(--text-muted)" }}>
          {workers && (
            <span className="flex items-center gap-1">
              <Users size={9} />
              {workers.idle} idle / {workers.working} working
            </span>
          )}
          {health?.url && (
            <span className="font-mono truncate max-w-[180px]" title={health.url}>
              {health.url}
            </span>
          )}
        </div>
      </div>

      {/* Steps */}
      <div className="px-4 py-3 overflow-x-auto">
        <div className="flex items-center gap-1 flex-nowrap min-w-max">
          {steps.map((phase, i) => (
            <div key={phase} className="flex items-center gap-1">
              <StepChip
                phase={phase}
                coverage={stepCov[phase]}
                serviceDown={isDown}
                desc={descs[phase]}
              />
              {i < steps.length - 1 && (
                <span className="text-[13px] select-none" style={{ color: "#374151" }}>→</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Real step probes */}
      {health?.steps && (
        <div className="px-4 pb-3 flex flex-wrap gap-2">
          {Object.entries(health.steps).map(([name, probe]) => (
            <div
              key={name}
              className="flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-mono border"
              style={{
                background: probe.ok ? "#14532d22" : "#7f1d1d22",
                borderColor: probe.ok ? "#16a34a44" : "#dc262644",
                color: probe.ok ? "#4ade80" : "#f87171",
              }}
              title={probe.error ?? (probe.statusCode ? `HTTP ${probe.statusCode}` : "")}
            >
              {probe.ok ? "✓" : "✗"} {name}
              <span style={{ color: "var(--text-muted)", fontSize: 9 }}>{probe.latencyMs}ms</span>
              {!probe.ok && probe.statusCode && (
                <span style={{ color: "#f87171" }}>HTTP {probe.statusCode}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {health && !health.ok && health.error && (
        <div className="px-4 pb-3 text-[10px] font-mono" style={{ color: "#f87171" }}>
          {health.error}
        </div>
      )}
    </div>
  );
}

function OrchestratorCard({ health }: { health: HealthResult["orchestrator"] | undefined }) {
  if (!health) return null;
  const byType = health.workers?.byType ?? {};
  const typeKeys = Object.keys(byType);

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ borderColor: health.ok ? "#09637e44" : "#7f1d1d66", background: "var(--bg-card)" }}
    >
      <div
        className="flex items-center gap-3 px-4 py-2.5"
        style={{ background: health.ok ? "#09637e0c" : "#7f1d1d0c", borderBottom: `1px solid ${health.ok ? "#09637e1a" : "#7f1d1d1a"}` }}
      >
        <span
          className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
          style={{ background: health.ok ? "#09637e22" : "#7f1d1d22", color: health.ok ? "var(--primary)" : "#f87171" }}
        >
          Orchestrator
        </span>

        {health.ok ? (
          <span className="flex items-center gap-1 text-[10px] rounded px-1.5 py-0.5 bg-green-900/40 text-green-400 border border-green-800/60">
            <Activity size={9} /> {health.status}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[10px] rounded px-1.5 py-0.5 bg-red-900/40 text-red-400 border border-red-800/60">
            <WifiOff size={9} /> unreachable
          </span>
        )}

        {health.ok && (
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            {health.latencyMs}ms
          </span>
        )}
      </div>

      <div className="px-4 py-3">
        {typeKeys.length > 0 ? (
          <div className="flex flex-wrap gap-3">
            {typeKeys.map((t) => {
              const w = byType[t];
              const col = svcColor(t);
              return (
                <div key={t} className="flex items-center gap-2 text-xs">
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                    style={{ background: `${col}22`, color: col }}
                  >
                    {t}
                  </span>
                  <span style={{ color: "var(--text-muted)" }}>
                    {w.idle} idle · {w.working} working · {w.total} total
                  </span>
                </div>
              );
            })}
          </div>
        ) : health.ok ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            No workers connected — scrapers may be offline.
          </p>
        ) : (
          <p className="text-xs" style={{ color: "#f87171" }}>
            {health.error ?? "Cannot reach orchestrator"}
          </p>
        )}
      </div>
    </div>
  );
}

function HealthTab() {
  const [health, setHealth]     = useState<HealthResult | null>(null);
  const [coverage, setCoverage] = useState<StepCoverage>({});
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    const now = Date.now();
    try {
      const [healthRes, flowRes] = await Promise.all([
        fetch("/api/scrapers/health", { credentials: "include" }),
        fetch("/api/logs/flow", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            from: new Date(now - TWENTY_FOUR_HOURS).toISOString(),
            to:   new Date(now).toISOString(),
            size: 200,
          }),
        }),
      ]);

      const healthData: HealthResult = await healthRes.json();
      const flowData = await flowRes.json();

      setHealth(healthData);
      setCheckedAt(new Date().toLocaleTimeString());

      // Build step coverage map from ELK sessions
      const cov: StepCoverage = {};
      if (flowData.ok && Array.isArray(flowData.sessions)) {
        for (const session of flowData.sessions as FlowSession[]) {
          const svc = session.service;
          if (!cov[svc]) cov[svc] = {};
          for (const pe of session.seenPhases) {
            const existing = cov[svc][pe.phase];
            if (!existing || pe.ts > existing) {
              cov[svc][pe.phase] = pe.ts;
            }
          }
        }
      }
      setCoverage(cov);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { run(); }, [run]);

  return (
    <div className="p-6 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-3 text-xs" style={{ color: "var(--text-muted)" }}>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-500" /> Seen &lt; 6h
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-yellow-500" /> Seen &lt; 24h
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-zinc-600" /> Not seen in 24h
          </span>
        </div>

        <div className="ms-auto flex items-center gap-2">
          {checkedAt && !loading && (
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              checked at {checkedAt}
            </span>
          )}
          <button
            onClick={run}
            disabled={loading}
            className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs text-white disabled:opacity-60"
            style={{ background: "var(--primary)" }}
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
            {loading ? "Checking…" : "Run Health Check"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Orchestrator */}
      <OrchestratorCard health={health?.orchestrator} />

      {/* Services */}
      {ALL_SERVICES.map((svc) => (
        <ServiceHealthCard
          key={svc}
          service={svc}
          health={health?.services?.[svc]}
          stepCov={coverage[svc] ?? {}}
          workers={health?.orchestrator?.workers?.byType?.[svc]}
        />
      ))}

      {/* Honest note about step testing */}
      <p className="text-[10px] pt-2" style={{ color: "var(--text-muted)" }}>
        Step coverage is derived from ELK logs in the last 24h — green steps were recently exercised in production.
        The health check only pings each service&apos;s <code className="font-mono">/health</code> endpoint.
        Full end-to-end step testing (login → captcha → scrape) requires triggering an actual scrape.
      </p>
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────────── */

export default function ScraperFlowPage() {
  const [tab, setTab] = useState<"sessions" | "health">("sessions");

  // Sessions tab state
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
        body: JSON.stringify({ from, to, services: svcFilter ? [svcFilter] : undefined }),
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

  useEffect(() => { if (tab === "sessions") load(); }, [load, tab]);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoRefresh && tab === "sessions")
      timerRef.current = setInterval(load, refreshSec * 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [autoRefresh, refreshSec, load, tab]);

  const displayed = svcFilter ? sessions.filter((s) => s.service === svcFilter) : sessions;
  const nLive   = displayed.filter((s) => s.status === "running").length;
  const nFailed = displayed.filter((s) => s.status === "failed").length;
  const nDone   = displayed.filter((s) => s.status === "completed").length;

  return (
    <div style={{ minHeight: "100vh" }}>
      <PageHeader
        title="Scraper Flow"
        desc="Live pipeline — see every session step by step as it happens."
      />

      {/* ── Tab bar ── */}
      <div
        className="flex items-center gap-1 px-6 pt-4 pb-0 border-b"
        style={{ borderColor: "var(--border)", background: "var(--bg-main)" }}
      >
        {(["sessions", "health"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-2 text-xs font-medium rounded-t transition-colors capitalize"
            style={{
              borderBottom: tab === t ? "2px solid var(--primary)" : "2px solid transparent",
              color: tab === t ? "var(--primary)" : "var(--text-muted)",
              background: "transparent",
            }}
          >
            {t === "sessions" ? "Live Sessions" : "Health & Coverage"}
          </button>
        ))}
      </div>

      {/* ── Sessions tab ── */}
      {tab === "sessions" && (
        <>
          {/* Toolbar */}
          <div
            className="px-6 py-3 flex flex-wrap items-center gap-3 border-b"
            style={{ background: "var(--bg-main)", borderColor: "var(--border)" }}
          >
            <div className="flex gap-1">
              <button
                onClick={() => setSvcFilter("")}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${!svcFilter ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300"}`}
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

            <div className="flex gap-1">
              {TIME_PRESETS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setTimePreset(p.value)}
                  className={`px-2.5 py-1.5 rounded text-xs transition-colors ${timePreset === p.value ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-4 ms-auto text-xs">
              {nLive > 0 && (
                <span className="flex items-center gap-1.5 text-blue-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                  {nLive} live
                </span>
              )}
              {nFailed > 0 && <span className="text-red-400">{nFailed} failed</span>}
              {nDone   > 0 && <span className="text-green-400">{nDone} done</span>}
            </div>

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
                  {[3, 5, 10, 30].map((s) => <option key={s} value={s}>{s}s</option>)}
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

          {error && (
            <div className="mx-6 mt-4 rounded border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="p-6 space-y-3">
            {!loading && !error && displayed.length === 0 && (
              <div
                className="rounded-xl p-16 text-center border border-dashed"
                style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
              >
                <p className="text-sm">
                  No sessions in the last {TIME_PRESETS.find((p) => p.value === timePreset)?.label}.
                </p>
                <p className="text-xs mt-1 opacity-60">Sessions appear when a scrape request is triggered.</p>
              </div>
            )}
            {displayed.map((s) => <SessionCard key={s.sessionId} session={s} />)}
          </div>
        </>
      )}

      {/* ── Health tab ── */}
      {tab === "health" && <HealthTab />}
    </div>
  );
}
