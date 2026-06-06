import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { hostExec } from "@/lib/server";
import { readScrapersConfig } from "@/lib/scrapers";

export const dynamic = "force-dynamic";

async function curlJson(url: string): Promise<{
  ok: boolean;
  data: Record<string, unknown> | null;
  latencyMs: number;
  error?: string;
}> {
  const t0 = Date.now();
  try {
    const { stdout } = await hostExec(
      `curl -sf --max-time 5 -H "Accept: application/json" ${JSON.stringify(url)}`,
      8000
    );
    const data = JSON.parse(stdout.trim()) as Record<string, unknown>;
    return { ok: true, data, latencyMs: Date.now() - t0 };
  } catch (e: any) {
    return {
      ok: false,
      data: null,
      latencyMs: Date.now() - t0,
      error: ((e?.stderr as string) || (e?.message as string) || String(e)).slice(0, 200),
    };
  }
}

export const GET = handler(async (req: NextRequest) => {
  await requireRole(req, "READONLY");
  const cfg = await readScrapersConfig();

  // Check each scraper service concurrently
  const svcEntries = Object.entries(cfg.services);
  const svcResults = await Promise.all(
    svcEntries.map(async ([key, svc]) => {
      const url = `${svc.url}${svc.healthPath}`;
      const r = await curlJson(url);
      const status =
        typeof r.data?.status === "string" ? r.data.status :
        r.ok ? "healthy" : "down";
      return [key, { url, ok: r.ok, latencyMs: r.latencyMs, status, data: r.data, error: r.error }] as const;
    })
  );

  const services: Record<string, unknown> = {};
  for (const [k, v] of svcResults) services[k] = v;

  // Orchestrator health + workers in parallel
  const [orchH, orchW] = await Promise.all([
    curlJson(`${cfg.orchestratorUrl}/health`),
    curlJson(`${cfg.orchestratorUrl}/workers`),
  ]);

  // Parse worker list into per-type counts
  const byType: Record<string, { total: number; idle: number; working: number }> = {};
  if (orchW.ok && Array.isArray(orchW.data?.workers)) {
    for (const w of orchW.data.workers as Array<Record<string, unknown>>) {
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
      status: typeof orchH.data?.status === "string" ? orchH.data.status : (orchH.ok ? "healthy" : "unreachable"),
      error: orchH.error,
      workers: orchW.ok
        ? { ok: true, byType }
        : { ok: false, byType: {}, error: orchW.error },
    },
    checkedAt: new Date().toISOString(),
  });
});
