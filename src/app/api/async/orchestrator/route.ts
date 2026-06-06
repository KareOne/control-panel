import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { hostFetch } from "@/lib/server";
import { readScrapersConfig } from "@/lib/scrapers";

export const dynamic = "force-dynamic";

async function safeGet(url: string, timeoutSec = 8) {
  try {
    return await hostFetch("GET", url, undefined, timeoutSec);
  } catch {
    return { ok: false, statusCode: 0, body: "request failed", latencyMs: 0 };
  }
}

export const GET = handler(async (req: NextRequest) => {
  await requireRole(req, "READONLY");
  const cfg = await readScrapersConfig();
  const base = cfg.orchestratorUrl; // http://localhost:8010

  // Probe all known orchestrator endpoints in parallel
  const [healthR, workersR, jobsR, statsR, queueR] = await Promise.all([
    safeGet(`${base}/health`),
    safeGet(`${base}/workers`),
    safeGet(`${base}/jobs?limit=50`),
    safeGet(`${base}/stats`),
    safeGet(`${base}/queue`),
  ]);

  let health: unknown = null;
  let workers: unknown[] = [];
  let jobs: unknown[] = [];
  let stats: unknown = null;
  let queue: unknown = null;

  try { health = JSON.parse(healthR.body); } catch {}
  try {
    const parsed = JSON.parse(workersR.body);
    // Support both {workers:[...]} and [...] shapes
    workers = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.workers) ? parsed.workers : []);
  } catch {}
  try {
    const parsed = JSON.parse(jobsR.body);
    jobs = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.jobs) ? parsed.jobs : []);
  } catch {}
  try { stats = JSON.parse(statsR.body); } catch {}
  try { queue = JSON.parse(queueR.body); } catch {}

  // Compute worker summary
  const workerSummary = {
    total: workers.length,
    idle: workers.filter((w: any) => w.status === "idle").length,
    working: workers.filter((w: any) => w.status === "working").length,
    byType: {} as Record<string, { total: number; idle: number; working: number }>,
  };
  for (const w of workers as any[]) {
    const type = typeof w.api_type === "string" ? w.api_type : (typeof w.type === "string" ? w.type : "unknown");
    if (!workerSummary.byType[type]) workerSummary.byType[type] = { total: 0, idle: 0, working: 0 };
    workerSummary.byType[type].total += 1;
    if (w.status === "idle") workerSummary.byType[type].idle += 1;
    if (w.status === "working") workerSummary.byType[type].working += 1;
  }

  // Active tasks = jobs with status in-progress
  const activeTasks = (jobs as any[]).filter(
    (j) => ["pending", "running", "started", "PENDING", "STARTED", "working"].includes(j.status ?? "")
  );

  // Endpoint availability map (so UI knows what data is real)
  const endpoints = {
    health: healthR.ok,
    workers: workersR.ok,
    jobs: jobsR.ok,
    stats: statsR.ok,
    queue: queueR.ok,
  };

  return json({
    ok: healthR.ok,
    baseUrl: base,
    latencyMs: healthR.latencyMs,
    health,
    workers,
    workerSummary,
    jobs,
    activeTasks,
    stats,
    queue,
    endpoints,
    checkedAt: new Date().toISOString(),
  });
});
