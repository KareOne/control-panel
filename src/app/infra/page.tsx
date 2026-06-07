"use client";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { PageHeader } from "@/components/Shell";
import { useUI } from "@/components/Providers";
import { fetcher } from "@/lib/fetcher";
import { CheckCircle2, XCircle, RefreshCw, CloudUpload, Play, FlaskConical } from "lucide-react";

interface Container {
  name: string;
  image: string;
  status: string;
  running: boolean;
}

interface Commit {
  sha: string;
  shortSha: string;
  author: string;
  date: string;
  message: string;
}

interface StatusData {
  containers: Container[];
  commit: Commit | null;
  dir: string;
}

interface DeployJob {
  id: string;
  label: string;
  state: string;
  progress: number | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  params: { services?: string[]; dryRun?: boolean } | null;
  createdBy: { email: string } | null;
}

const STATE_COLOR: Record<string, string> = {
  QUEUED: "text-zinc-400",
  RUNNING: "text-amber-400",
  SUCCEEDED: "text-emerald-400",
  FAILED: "text-red-400",
  CANCELLED: "text-zinc-500",
};

export default function InfraPage() {
  const { lang } = useUI();

  const { data: status, mutate: refetchStatus, isLoading: loadingStatus } =
    useSWR<StatusData>("/api/infra/status", fetcher, { refreshInterval: 20000 });

  const { data: deployData, mutate: refetchJobs } =
    useSWR<{ jobs: DeployJob[] }>("/api/infra/deploy", fetcher, { refreshInterval: 5000 });

  const [dryRun, setDryRun] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [banner, setBanner] = useState<{ kind: "ok" | "fail"; msg: string } | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const logBoxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (logBoxRef.current)
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
  }, [logLines]);

  // Auto-attach to any currently running job on mount
  useEffect(() => {
    const running = deployData?.jobs.find(
      (j) => j.state === "RUNNING" || j.state === "QUEUED"
    );
    if (running && !activeJobId) streamJob(running.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deployData]);

  function streamJob(jobId: string) {
    setActiveJobId(jobId);
    setLogLines([]);
    esRef.current?.close();
    const es = new EventSource(`/api/infra/deploy/${jobId}/stream`);
    esRef.current = es;
    es.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (d.logDelta) {
          setLogLines((prev) => [
            ...prev,
            ...d.logDelta.split("\n").filter(Boolean),
          ]);
        }
        if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(d.state)) {
          es.close();
          refetchJobs();
          refetchStatus();
          setBusy(false);
          if (d.state === "SUCCEEDED")
            setBanner({ kind: "ok", msg: "Deploy completed successfully." });
          else if (d.state === "FAILED")
            setBanner({ kind: "fail", msg: d.error || "Deploy failed." });
        }
      } catch { /* ignore */ }
    };
    es.onerror = () => { es.close(); setBusy(false); };
  }

  async function triggerDeploy() {
    setBusy(true);
    setBanner(null);
    setLogLines([]);
    const res = await fetch("/api/infra/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun }),
    });
    const body = await res.json();
    if (!res.ok) {
      setBusy(false);
      setBanner({ kind: "fail", msg: body.error || "Failed to start deploy." });
      return;
    }
    streamJob(body.jobId);
    refetchJobs();
  }

  const runningJob = deployData?.jobs.find(
    (j) => j.state === "RUNNING" || j.state === "QUEUED"
  );

  return (
    <div>
      <PageHeader
        title="MN Infrastructure"
        desc="Deploy Market Navigator backend services and frontend from the panel."
      />

      <div className="p-6 space-y-6">
        {banner && (
          <div
            className={`rounded-md px-4 py-3 text-sm ${
              banner.kind === "ok"
                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-600/40"
                : "bg-red-500/15 text-red-400 border border-red-600/40"
            }`}
          >
            {banner.msg}
          </div>
        )}

        {runningJob && !activeJobId && (
          <div className="rounded-md px-4 py-3 text-sm bg-amber-500/10 text-amber-400 border border-amber-600/40 flex items-center gap-2">
            <span>⚠</span>
            <span>
              A deploy is running.{" "}
              <button className="underline" onClick={() => streamJob(runningJob.id)}>
                Attach to live log
              </button>
            </span>
          </div>
        )}

        {/* Container status */}
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
          <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 text-sm font-medium flex items-center justify-between">
            <span>MN Container Status</span>
            <button
              onClick={() => refetchStatus()}
              className="text-zinc-400 hover:text-zinc-200 p-1 rounded"
              title="Refresh"
            >
              <RefreshCw size={13} className={loadingStatus ? "animate-spin" : ""} />
            </button>
          </div>

          {status?.commit && (
            <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500 flex gap-4">
              <span>
                Deployed commit:{" "}
                <code className="font-mono text-zinc-300">{status.commit.shortSha}</code>
              </span>
              <span>{status.commit.message.slice(0, 80)}</span>
              <span>{status.commit.author}</span>
              <span>{new Date(status.commit.date).toLocaleString()}</span>
            </div>
          )}

          {!status ? (
            <div className="px-4 py-6 text-sm text-zinc-500">Loading…</div>
          ) : status.containers.length === 0 ? (
            <div className="px-4 py-6 text-sm text-zinc-500">
              No containers found at <code>{status.dir}</code>. The directory may not exist on the host yet.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-zinc-500">
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="text-start px-4 py-2">Container</th>
                  <th className="text-start px-4 py-2">Image</th>
                  <th className="text-start px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {status.containers.map((c) => (
                  <tr key={c.name} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="px-4 py-2 font-mono text-xs">{c.name}</td>
                    <td className="px-4 py-2 text-xs text-zinc-400">{c.image}</td>
                    <td className="px-4 py-2">
                      <span className={`flex items-center gap-1 text-xs ${c.running ? "text-emerald-400" : "text-red-400"}`}>
                        {c.running ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
                        {c.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Deploy trigger */}
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 space-y-4">
          <div className="text-sm font-medium">Trigger Deploy</div>
          <div className="text-xs text-zinc-500">
            Runs <code className="font-mono">git pull origin main</code> then{" "}
            <code className="font-mono">docker compose up -d --build</code> in{" "}
            <code className="font-mono">/opt/marketnavigator</code> on the host.
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="accent-[var(--primary)]"
            />
            <span>
              <span className="font-medium">Dry run</span>
              <span className="text-zinc-500 ml-2">— pull + build image only, do NOT restart containers</span>
            </span>
          </label>

          <div className="flex gap-3">
            <button
              disabled={busy || !!runningJob}
              onClick={triggerDeploy}
              className="flex items-center gap-2 bg-[#09637E] hover:bg-[#088395] text-white rounded px-4 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {dryRun ? <FlaskConical size={14} /> : <CloudUpload size={14} />}
              {dryRun ? "Run dry-run build" : "Deploy now"}
            </button>
            {busy && (
              <span className="flex items-center gap-1 text-xs text-amber-400">
                <RefreshCw size={11} className="animate-spin" /> Running…
              </span>
            )}
          </div>
        </div>

        {/* Live log */}
        {activeJobId && (
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
            <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 text-sm font-medium flex items-center justify-between">
              <span>Live log</span>
              <button
                className="text-xs text-zinc-500 hover:text-zinc-300 underline"
                onClick={() => { setActiveJobId(null); esRef.current?.close(); }}
              >
                dismiss
              </button>
            </div>
            <div
              ref={logBoxRef}
              className="font-mono text-xs p-3 max-h-96 overflow-auto bg-zinc-950 text-zinc-300"
            >
              {logLines.length === 0 ? (
                <span className="text-zinc-600">Waiting for output…</span>
              ) : (
                logLines.map((l, i) => (
                  <div
                    key={i}
                    className={
                      l.startsWith("ERROR") ? "text-red-400" :
                      l.startsWith(">>>") ? "text-cyan-400 font-semibold" :
                      l.startsWith("===") ? "text-emerald-400 font-semibold" :
                      ""
                    }
                  >
                    {l}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Deploy history */}
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
          <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 text-sm font-medium">
            Deploy History
          </div>
          {!deployData || deployData.jobs.length === 0 ? (
            <div className="px-4 py-6 text-sm text-zinc-500">No deploys yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-zinc-500">
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="text-start px-4 py-2">Label</th>
                  <th className="text-start px-4 py-2">State</th>
                  <th className="text-start px-4 py-2">By</th>
                  <th className="text-start px-4 py-2">Started</th>
                  <th className="text-start px-4 py-2">Duration</th>
                  <th className="text-start px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {deployData.jobs.map((j) => {
                  const dur =
                    j.startedAt && j.finishedAt
                      ? Math.round(
                          (new Date(j.finishedAt).getTime() -
                            new Date(j.startedAt).getTime()) /
                            1000
                        ) + "s"
                      : j.startedAt && !j.finishedAt
                      ? "running"
                      : "—";
                  return (
                    <tr key={j.id} className="border-b border-zinc-100 dark:border-zinc-900">
                      <td className="px-4 py-2">
                        {j.label}
                        {j.params?.dryRun && (
                          <span className="ml-2 text-xs text-zinc-500 border border-zinc-600 rounded px-1">dry</span>
                        )}
                      </td>
                      <td className={`px-4 py-2 ${STATE_COLOR[j.state] ?? "text-zinc-400"}`}>
                        {j.state}
                        {j.state === "RUNNING" && j.progress != null && (
                          <span className="ml-1 text-zinc-500">({j.progress}%)</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-zinc-500">{j.createdBy?.email ?? "—"}</td>
                      <td className="px-4 py-2 text-xs text-zinc-500">
                        {j.startedAt ? new Date(j.startedAt).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-2 text-xs text-zinc-500">{dur}</td>
                      <td className="px-4 py-2">
                        <button
                          className="text-xs text-emerald-500 hover:underline"
                          onClick={() => streamJob(j.id)}
                        >
                          <Play size={11} className="inline mr-1" />log
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
