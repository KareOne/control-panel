"use client";
import useSWR from "swr";
import { useState } from "react";
import { fetcher } from "@/lib/fetcher";
import { PageHeader } from "@/components/Shell";
import { RefreshCw, Camera, AlertTriangle, CheckCircle, Minus, XCircle } from "lucide-react";

interface ServiceDrift {
  service: string;
  state: string;
  environment: string | null;
  liveKeyCount: number;
  snapshotKeyCount: number;
  lastSnapshotAt: string | null;
  status: "clean" | "changed" | "new_key" | "missing_key" | "no_snapshot";
  drifts: { key: string; status: "changed" | "new_key" | "missing_key" }[];
}

interface DriftData {
  services: ServiceDrift[];
  drifts: { service: string; environment: string | null; key: string; status: string }[];
  environments: string[];
}

interface DiffRow {
  service: string;
  key: string;
  env1Value: string | null;
  env1Masked: boolean;
  env2Value: string | null;
  env2Masked: boolean;
  status: "same" | "different" | "only_env1" | "only_env2";
}

interface CompareData {
  env1: string;
  env2: string;
  diffs: DiffRow[];
  summary: { same: number; different: number; only_env1: number; only_env2: number };
}

const STATUS_CONFIG: Record<
  ServiceDrift["status"],
  { color: string; bg: string; icon: React.ReactNode; label: string }
> = {
  clean:        { color: "var(--success)",    bg: "rgba(16,185,129,.12)",  icon: <CheckCircle size={13} />,   label: "Clean" },
  changed:      { color: "var(--warning)",    bg: "rgba(245,158,11,.12)",  icon: <AlertTriangle size={13} />, label: "Changed" },
  new_key:      { color: "var(--primary)",    bg: "rgba(99,102,241,.12)",  icon: <AlertTriangle size={13} />, label: "New keys" },
  missing_key:  { color: "var(--danger)",     bg: "rgba(239,68,68,.12)",   icon: <XCircle size={13} />,       label: "Missing keys" },
  no_snapshot:  { color: "var(--text-muted)", bg: "rgba(107,114,128,.12)", icon: <Minus size={13} />,         label: "No snapshot" },
};

const DIFF_COLOR: Record<DiffRow["status"], string> = {
  same:      "var(--text-muted)",
  different: "var(--warning)",
  only_env1: "var(--danger)",
  only_env2: "var(--success)",
};

const DIFF_LABEL: Record<DiffRow["status"], string> = {
  same:      "Same",
  different: "Different",
  only_env1: "Only in #1",
  only_env2: "Only in #2",
};

const card: React.CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: "10px",
  padding: "14px 16px",
};

const inputStyle: React.CSSProperties = {
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: "7px",
  color: "var(--text-main)",
  padding: "6px 10px",
  fontSize: "13px",
  outline: "none",
};

export default function DriftPage() {
  const { data, mutate, isLoading } = useSWR<DriftData>("/api/drift", fetcher, { refreshInterval: 30000 });
  const [snapshotting, setSnapshotting] = useState(false);
  const [snapMsg, setSnapMsg] = useState<string | null>(null);

  const [env1, setEnv1] = useState("production");
  const [env2, setEnv2] = useState("staging");
  const [compareKey, setCompareKey] = useState<string | null>(null);
  const { data: cmpData, isLoading: cmpLoading } = useSWR<CompareData>(compareKey, fetcher);

  const environments = data?.environments ?? [];

  async function takeSnapshot() {
    setSnapshotting(true);
    setSnapMsg(null);
    try {
      const res = await fetch("/api/drift/snapshot", { method: "POST" });
      const j = await res.json();
      setSnapMsg(j.ok ? `Captured ${j.count} env entries` : (j.error ?? "Failed"));
      await mutate();
    } catch {
      setSnapMsg("Failed to capture");
    } finally {
      setSnapshotting(false);
    }
  }

  function runCompare() {
    setCompareKey(`/api/drift/compare?env1=${encodeURIComponent(env1)}&env2=${encodeURIComponent(env2)}`);
  }

  return (
    <div>
      <PageHeader
        title="Env Drift"
        desc="Detect configuration drift across environments by comparing live container env vars against stored snapshots."
      />
      <div className="p-6 space-y-6">

        {/* Toolbar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>
            {data ? `${data.services.length} service${data.services.length !== 1 ? "s" : ""} tracked` : "Loading…"}
          </span>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {snapMsg && <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{snapMsg}</span>}
            <button
              onClick={() => mutate()}
              style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: "7px", color: "var(--text-muted)", padding: "6px 12px", fontSize: "12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px" }}
            >
              <RefreshCw size={12} /> Refresh
            </button>
            <button
              onClick={takeSnapshot}
              disabled={snapshotting}
              style={{ background: "var(--primary)", color: "var(--accent)", border: "none", borderRadius: "7px", padding: "6px 14px", fontSize: "12px", fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", opacity: snapshotting ? 0.7 : 1 }}
            >
              <Camera size={13} /> {snapshotting ? "Capturing…" : "Capture snapshot"}
            </button>
          </div>
        </div>

        {/* Services drift list */}
        {isLoading && (
          <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
            Scanning containers…
          </div>
        )}

        {!isLoading && data && data.services.length === 0 && (
          <div style={{ ...card, textAlign: "center", color: "var(--text-muted)", fontSize: "13px", padding: "40px" }}>
            No running containers found. Start some services and capture a snapshot.
          </div>
        )}

        {!isLoading && data && data.services.length > 0 && (
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "10px", overflow: "hidden" }}>
            {data.services.map((svc, i) => {
              const cfg = STATUS_CONFIG[svc.status] ?? STATUS_CONFIG.no_snapshot;
              const changedCount  = svc.drifts.filter((d) => d.status === "changed").length;
              const newCount      = svc.drifts.filter((d) => d.status === "new_key").length;
              const missingCount  = svc.drifts.filter((d) => d.status === "missing_key").length;
              return (
                <div
                  key={`${svc.service}-${svc.environment}`}
                  style={{ display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: i < data.services.length - 1 ? "1px solid var(--border)" : "none", gap: "12px" }}
                >
                  <span style={{ color: cfg.color, display: "flex", alignItems: "center", flexShrink: 0 }}>{cfg.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontWeight: 600, fontSize: "13px", color: "var(--text-main)" }}>{svc.service}</span>
                      <span style={{ fontSize: "11px", background: "var(--bg-panel)", color: "var(--text-muted)", padding: "1px 6px", borderRadius: "4px" }}>
                        {svc.environment ?? "unknown"}
                      </span>
                      <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{svc.state}</span>
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "3px" }}>
                      {svc.lastSnapshotAt
                        ? <>Last snapshot: {new Date(svc.lastSnapshotAt).toLocaleString()} · {svc.snapshotKeyCount} keys</>
                        : "No snapshot yet"}
                      {changedCount > 0  && <span style={{ color: "var(--warning)", marginLeft: "8px" }}>{changedCount} changed</span>}
                      {newCount > 0      && <span style={{ color: "var(--success)", marginLeft: "8px" }}>+{newCount} new</span>}
                      {missingCount > 0  && <span style={{ color: "var(--danger)",  marginLeft: "8px" }}>-{missingCount} removed</span>}
                    </div>
                  </div>
                  <span style={{ fontSize: "11px", color: cfg.color, background: cfg.bg, padding: "3px 9px", borderRadius: "5px", fontWeight: 600, flexShrink: 0 }}>
                    {cfg.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Compare section */}
        <div style={card}>
          <p style={{ fontWeight: 700, fontSize: "13px", color: "var(--text-main)", marginBottom: "12px" }}>Compare environments</p>
          <div style={{ display: "flex", gap: "10px", alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <label style={{ fontSize: "11px", color: "var(--text-muted)" }}>Environment 1</label>
              <input value={env1} onChange={(e) => setEnv1(e.target.value)} list="env-list" style={inputStyle} placeholder="production" />
            </div>
            <span style={{ color: "var(--text-muted)", paddingBottom: "7px" }}>vs</span>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <label style={{ fontSize: "11px", color: "var(--text-muted)" }}>Environment 2</label>
              <input value={env2} onChange={(e) => setEnv2(e.target.value)} list="env-list" style={inputStyle} placeholder="staging" />
            </div>
            <datalist id="env-list">
              {environments.map((e) => <option key={e} value={e} />)}
            </datalist>
            <button
              onClick={runCompare}
              style={{ background: "var(--primary)", color: "var(--accent)", border: "none", borderRadius: "7px", padding: "7px 16px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}
            >
              Compare
            </button>
          </div>

          {cmpLoading && (
            <div style={{ marginTop: "16px", fontSize: "13px", color: "var(--text-muted)" }}>Comparing…</div>
          )}

          {cmpData && (
            <div style={{ marginTop: "16px" }}>
              {/* Summary chips */}
              <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
                {(["different", "only_env1", "only_env2", "same"] as const).map((k) => (
                  <span key={k} style={{ fontSize: "11px", color: DIFF_COLOR[k], background: `${DIFF_COLOR[k]}18`, padding: "2px 8px", borderRadius: "5px", fontWeight: 600 }}>
                    {DIFF_LABEL[k]}: {cmpData.summary[k]}
                  </span>
                ))}
              </div>

              {cmpData.diffs.length === 0 ? (
                <p style={{ fontSize: "13px", color: "var(--success)" }}>No differences found between these environments.</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border)" }}>
                        {["Service", "Key", cmpData.env1, cmpData.env2, "Status"].map((h) => (
                          <th key={h} style={{ textAlign: "left", padding: "8px 10px", color: "var(--text-muted)", fontWeight: 600, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {cmpData.diffs.filter((d) => d.status !== "same").map((row, idx) => (
                        <tr key={idx} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={{ padding: "7px 10px", fontSize: "11px", color: "var(--text-muted)" }}>{row.service}</td>
                          <td style={{ padding: "7px 10px", fontFamily: "monospace", color: "var(--text-main)" }}>{row.key}</td>
                          <td style={{ padding: "7px 10px", fontFamily: "monospace", color: row.env1Value ? "var(--text-main)" : "var(--text-muted)" }}>
                            {row.env1Masked ? "••••••" : (row.env1Value ?? "—")}
                          </td>
                          <td style={{ padding: "7px 10px", fontFamily: "monospace", color: row.env2Value ? "var(--text-main)" : "var(--text-muted)" }}>
                            {row.env2Masked ? "••••••" : (row.env2Value ?? "—")}
                          </td>
                          <td style={{ padding: "7px 10px" }}>
                            <span style={{ fontSize: "11px", color: DIFF_COLOR[row.status], fontWeight: 600 }}>
                              {DIFF_LABEL[row.status]}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
