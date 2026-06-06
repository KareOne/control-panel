import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: NextRequest) => {
  await requireRole(req, "READONLY");
  const u = new URL(req.url);
  const days = Math.max(1, Math.min(365, Number(u.searchParams.get("days") || "30")));
  const since = new Date(Date.now() - days * 86400_000);

  const samples = await prisma.aiSample.findMany({
    where: { createdAt: { gte: since } },
    select: {
      model: true,
      humanRating: true,
      latencyMs: true,
      costUsd: true,
      flag: true,
    },
  });

  const regressionRuns = await prisma.aiRegressionRun.findMany({
    where: { createdAt: { gte: since } },
    select: { model: true, matchScore: true, latencyMs: true, costUsd: true },
  });

  // Aggregate by model
  type ModelStats = {
    model: string;
    sampleCount: number;
    avgRating: number | null;
    avgLatencyMs: number | null;
    p95LatencyMs: number | null;
    avgCostUsd: number | null;
    hallucinationRate: number;
    refusalRate: number;
    errorRate: number;
    failureRate: number;
    avgMatchScore: number | null;
    regressionRuns: number;
  };

  const byModel = new Map<string, { samples: typeof samples; runs: typeof regressionRuns }>();
  for (const s of samples) {
    const e = byModel.get(s.model) ?? { samples: [], runs: [] };
    e.samples.push(s);
    byModel.set(s.model, e);
  }
  for (const r of regressionRuns) {
    const e = byModel.get(r.model) ?? { samples: [], runs: [] };
    e.runs.push(r);
    byModel.set(r.model, e);
  }

  const result: ModelStats[] = [];
  for (const [model, { samples: ss, runs: rs }] of Array.from(byModel.entries())) {
    const n = ss.length;
    const rated = ss.filter((s) => s.humanRating != null);
    const avgRating = rated.length > 0
      ? Math.round((rated.reduce((a, s) => a + s.humanRating!, 0) / rated.length) * 100) / 100
      : null;

    const latencies = ss.map((s) => s.latencyMs).filter((v): v is number => v != null).sort((a, b) => a - b);
    const avgLatencyMs = latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : null;
    const p95LatencyMs = latencies.length > 0
      ? latencies[Math.min(latencies.length - 1, Math.ceil(0.95 * latencies.length) - 1)]
      : null;

    const costs = ss.map((s) => s.costUsd).filter((v): v is number => v != null);
    const avgCostUsd = costs.length > 0
      ? Math.round((costs.reduce((a, b) => a + b, 0) / costs.length) * 1e6) / 1e6
      : null;

    const hallucinationRate = n > 0 ? ss.filter((s) => s.flag === "HALLUCINATION").length / n : 0;
    const refusalRate = n > 0 ? ss.filter((s) => s.flag === "REFUSAL").length / n : 0;
    const errorRate = n > 0 ? ss.filter((s) => s.flag === "ERROR").length / n : 0;
    const failureRate = hallucinationRate + refusalRate + errorRate;

    const scores = rs.map((r) => r.matchScore).filter((v): v is number => v != null);
    const avgMatchScore = scores.length > 0
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 1e4) / 1e4
      : null;

    result.push({
      model,
      sampleCount: n,
      avgRating,
      avgLatencyMs,
      p95LatencyMs,
      avgCostUsd,
      hallucinationRate: Math.round(hallucinationRate * 1e4) / 1e4,
      refusalRate: Math.round(refusalRate * 1e4) / 1e4,
      errorRate: Math.round(errorRate * 1e4) / 1e4,
      failureRate: Math.round(failureRate * 1e4) / 1e4,
      avgMatchScore,
      regressionRuns: rs.length,
    });
  }

  return json({
    days,
    models: result.sort((a, b) => b.sampleCount - a.sampleCount),
  });
});
