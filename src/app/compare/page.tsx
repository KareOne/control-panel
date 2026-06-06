"use client";
import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { PageHeader } from "@/components/Shell";
import { fetcher } from "@/lib/fetcher";

type Commit = { hash: string; fullHash: string; author: string; date: string; message: string };
type Stat = { filesChanged: number; insertions: number; deletions: number };
type CompareResult = { from: string; to: string; commits: Commit[]; stat: Stat; error?: string };

export default function ComparePage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [key, setKey] = useState<string | null>(null);

  const { data, isLoading } = useSWR<CompareResult>(key, fetcher);

  const run = () => {
    if (!from.trim() || !to.trim()) return;
    setKey(`/api/deployments/compare?from=${encodeURIComponent(from.trim())}&to=${encodeURIComponent(to.trim())}`);
  };

  const card: React.CSSProperties = {
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "16px 20px",
  };

  return (
    <>
      <PageHeader title="Release Compare" desc="Compare two git refs (tags, branches, or commit SHAs) side-by-side." />
      <div style={{ padding: "24px 28px", maxWidth: 900, display: "flex", flexDirection: "column", gap: 20 }}>

        {/* Ref picker */}
        <div style={{ ...card, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 180px" }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>From (older ref)</span>
            <input
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder="e.g. v1.0.0"
              onKeyDown={(e) => e.key === "Enter" && run()}
              style={{
                background: "var(--bg-panel)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "7px 10px",
                color: "var(--text-main)",
                fontSize: 13,
                outline: "none",
              }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 180px" }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>To (newer ref)</span>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="e.g. v1.1.0"
              onKeyDown={(e) => e.key === "Enter" && run()}
              style={{
                background: "var(--bg-panel)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "7px 10px",
                color: "var(--text-main)",
                fontSize: 13,
                outline: "none",
              }}
            />
          </label>
          <button
            onClick={run}
            disabled={isLoading || !from.trim() || !to.trim()}
            style={{
              background: "var(--primary)",
              color: "var(--accent)",
              border: "none",
              borderRadius: 6,
              padding: "8px 18px",
              fontWeight: 600,
              fontSize: 13,
              cursor: isLoading || !from.trim() || !to.trim() ? "not-allowed" : "pointer",
              opacity: isLoading || !from.trim() || !to.trim() ? 0.6 : 1,
              flexShrink: 0,
            }}
          >
            {isLoading ? "Loading…" : "Compare"}
          </button>
        </div>

        {/* Error */}
        {data?.error && (
          <div style={{ ...card, borderColor: "var(--danger)", color: "var(--danger)", fontSize: 13 }}>
            {data.error}
          </div>
        )}

        {/* Stat summary */}
        {data && !data.error && (
          <div style={{ ...card, display: "flex", gap: 24, flexWrap: "wrap" }}>
            <StatPill label="Files changed" value={String(data.stat.filesChanged)} />
            <StatPill label="Insertions" value={`+${data.stat.insertions}`} color="var(--success)" />
            <StatPill label="Deletions" value={`-${data.stat.deletions}`} color="var(--danger)" />
            <StatPill label="Commits" value={String(data.commits.length)} color="var(--primary)" />
          </div>
        )}

        {/* Commit list */}
        {data && !data.error && (
          <div style={card}>
            <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Commits ({data.from} → {data.to})
            </p>
            {data.commits.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No changes between these refs.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {data.commits.map((c) => (
                  <div
                    key={c.fullHash}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "7ch 1fr auto",
                      gap: 12,
                      padding: "8px 10px",
                      borderRadius: 6,
                      fontSize: 13,
                      alignItems: "start",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-panel)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <code style={{ color: "var(--primary)", fontFamily: "monospace", fontSize: 12 }}>{c.hash}</code>
                    <span style={{ color: "var(--text-main)" }}>{c.message}</span>
                    <span style={{ color: "var(--text-muted)", fontSize: 11, whiteSpace: "nowrap", textAlign: "right" }}>
                      {c.author} · {new Date(c.date).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Deploy CTA */}
        {data && !data.error && (
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Link
              href={`/deploy?ref=${encodeURIComponent(data.to)}`}
              style={{
                background: "var(--success)",
                color: "#fff",
                borderRadius: 6,
                padding: "8px 20px",
                fontWeight: 600,
                fontSize: 13,
                textDecoration: "none",
              }}
            >
              Deploy from {data.to}
            </Link>
          </div>
        )}
      </div>
    </>
  );
}

function StatPill({ label, value, color = "var(--text-main)" }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
      <span style={{ fontSize: 20, fontWeight: 700, color }}>{value}</span>
    </div>
  );
}
