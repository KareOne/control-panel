import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { hostExec } from "@/lib/server";
import { readScrapersConfig } from "@/lib/scrapers";

export const dynamic = "force-dynamic";

interface ProbeResult {
  ok: boolean;
  statusCode?: number;
  latencyMs: number;
  data?: unknown;
  error?: string;
}

async function probe(
  method: "GET" | "POST",
  url: string,
  body?: unknown,
  timeoutMs = 10000
): Promise<ProbeResult> {
  const t0 = Date.now();
  try {
    const bodyFlag = body
      ? `-H "Content-Type: application/json" -d ${JSON.stringify(JSON.stringify(body))}`
      : "";
    const cmd = `curl -s -o /tmp/_probe_out -w '%{http_code}' --max-time ${Math.ceil(timeoutMs / 1000)} -X ${method} ${bodyFlag} ${JSON.stringify(url)}`;
    const { stdout } = await hostExec(cmd, timeoutMs + 2000);
    const statusCode = parseInt(stdout.trim(), 10);
    const { stdout: raw } = await hostExec("cat /tmp/_probe_out", 3000);
    let data: unknown;
    try { data = JSON.parse(raw.trim()); } catch { data = raw.trim().slice(0, 200); }
    return { ok: statusCode >= 200 && statusCode < 400, statusCode, latencyMs: Date.now() - t0, data };
  } catch (e: any) {
    return { ok: false, latencyMs: Date.now() - t0, error: String(e?.stderr || e?.message || e).slice(0, 200) };
  }
}

// Per-scraper real step probes
async function probeScraper(key: string, baseUrl: string): Promise<{ steps: Record<string, ProbeResult> }> {
  const steps: Record<string, ProbeResult> = {};

  if (key === "crunchbase") {
    steps.health = await probe("GET", `${baseUrl}/health`);
    // Real search step — will catch MySQL/DB errors the /health endpoint hides
    steps.search = await probe("GET", `${baseUrl}/search/crunchbase?hashtag=fintech&num_companies=1`);
  } else if (key === "tracxn") {
    steps.health = await probe("GET", `${baseUrl}/health`);
    // Tracxn health already checks DB; also probe the scrape endpoint responsiveness
    steps.scrape = await probe("POST", `${baseUrl}/scrape`, { company_url: "https://tracxn.com", mode: "ping" });
  } else if (key === "twitter") {
    steps.health = await probe("GET", `${baseUrl}/health`);
    steps.search = await probe("POST", `${baseUrl}/search/tweets`, { keyword: "test", num_posts: 1, query_type: "Top" });
  } else if (key === "news-search") {
    steps.health = await probe("GET", `${baseUrl}/api/health`);
    steps.route = await probe("POST", `${baseUrl}/api/route`, { query: "test", limit: 1 });
  } else {
    steps.health = await probe("GET", `${baseUrl}/health`);
  }

  return { steps };
}

export const GET = handler(async (req: NextRequest) => {
  await requireRole(req, "READONLY");
  const cfg = await readScrapersConfig();

  const svcEntries = Object.entries(cfg.services);
  const svcResults = await Promise.all(
    svcEntries.map(async ([key, svc]) => {
      const { steps } = await probeScraper(key, svc.url);
      const allOk = Object.values(steps).every((s) => s.ok);
      const anyStep = Object.values(steps)[0];
      return [key, {
        url: svc.url,
        ok: allOk,
        // overall latency = sum of step latencies
        latencyMs: Object.values(steps).reduce((a, s) => a + s.latencyMs, 0),
        status: allOk ? "healthy" : "down",
        steps,
        // compat fields
        data: anyStep?.data ?? null,
        error: allOk ? undefined : Object.entries(steps).filter(([, s]) => !s.ok).map(([n, s]) => `${n}: ${s.error ?? `HTTP ${s.statusCode}`}`).join("; "),
      }] as const;
    })
  );

  const services: Record<string, unknown> = {};
  for (const [k, v] of svcResults) services[k] = v;

  // Orchestrator health + workers
  const [orchH, orchW] = await Promise.all([
    probe("GET", `${cfg.orchestratorUrl}/health`),
    probe("GET", `${cfg.orchestratorUrl}/workers`),
  ]);

  const byType: Record<string, { total: number; idle: number; working: number }> = {};
  if (orchW.ok && Array.isArray((orchW.data as any)?.workers)) {
    for (const w of (orchW.data as any).workers as Array<Record<string, unknown>>) {
      const t = typeof w.api_type === "string" ? w.api_type : "unknown";
      if (!byType[t]) byType[t] = { total: 0, idle: 0, working: 0 };
      byType[t].total += 1;
      if (w.status === "idle") byType[t].idle += 1;
      if (w.status === "working") byType[t].working += 1;
    }
  }

  return json({
    ok: true,
    services,
    orchestrator: {
      ok: orchH.ok,
      latencyMs: orchH.latencyMs,
      status: typeof (orchH.data as any)?.status === "string"
        ? (orchH.data as any).status
        : orchH.ok ? "healthy" : "unreachable",
      error: orchH.error,
      workers: orchW.ok
        ? { ok: true, byType }
        : { ok: false, byType: {}, error: orchW.error },
    },
    checkedAt: new Date().toISOString(),
  });
});
