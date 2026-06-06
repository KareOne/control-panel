import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { log, GitNotConfiguredError } from "@/lib/git";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type CiSummary = {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  ciUrl: string | null;
  finishedAt: string | null;
  status: "passing" | "failing" | "unknown";
};

type QaSummary = {
  passing: number;
  failing: number;
  stale: number;
  environments: string[];
};

export const GET = handler(async (req: NextRequest) => {
  await requireRole(req, "READONLY");
  const limit = Number(
    new URL(req.url).searchParams.get("limit") || "50"
  );
  try {
    const commits = await log({ maxCount: Number.isFinite(limit) ? limit : 50 });
    const shas = commits.map((c) => c.sha);

    const [runs, deployments] = await Promise.all([
      prisma.testRun.findMany({
        where: { commitSha: { in: shas } },
        orderBy: { startedAt: "desc" },
      }),
      prisma.deployment.findMany({
        where: { commitSha: { in: shas }, status: "active" },
        select: { commitSha: true, environment: true },
      }),
    ]);

    // CI: latest TestRun per commit
    const ciBySha = new Map<string, CiSummary>();
    for (const r of runs) {
      if (ciBySha.has(r.commitSha!)) continue;
      ciBySha.set(r.commitSha!, {
        passed: r.passed,
        failed: r.failed,
        skipped: r.skipped,
        total: r.total,
        ciUrl: r.ciUrl ?? null,
        finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
        status: r.failed > 0 ? "failing" : r.total > 0 ? "passing" : "unknown",
      });
    }

    // QA: roll up RegressionItem by env, for envs this commit is deployed to
    const envsBySha = new Map<string, string[]>();
    for (const d of deployments) {
      const arr = envsBySha.get(d.commitSha) ?? [];
      arr.push(d.environment);
      envsBySha.set(d.commitSha, arr);
    }
    const allEnvs = Array.from(new Set(deployments.map((d) => d.environment)));
    const qaByEnv = new Map<string, { passing: number; failing: number; stale: number }>();
    if (allEnvs.length) {
      const items = await prisma.regressionItem.findMany({
        where: { environment: { in: allEnvs as any } },
        select: { environment: true, status: true },
      });
      for (const env of allEnvs) qaByEnv.set(env, { passing: 0, failing: 0, stale: 0 });
      for (const it of items) {
        const bucket = qaByEnv.get(it.environment);
        if (!bucket) continue;
        if (it.status === "PASSING") bucket.passing++;
        else if (it.status === "FAILING") bucket.failing++;
        else bucket.stale++;
      }
    }

    const enriched = commits.map((c) => {
      const envs = envsBySha.get(c.sha) ?? [];
      const qa: QaSummary = { passing: 0, failing: 0, stale: 0, environments: envs };
      for (const env of envs) {
        const b = qaByEnv.get(env);
        if (!b) continue;
        qa.passing += b.passing;
        qa.failing += b.failing;
        qa.stale += b.stale;
      }
      return {
        ...c,
        ci: ciBySha.get(c.sha) ?? null,
        qa: envs.length ? qa : null,
      };
    });

    return json({ configured: true, commits: enriched });
  } catch (e) {
    if (e instanceof GitNotConfiguredError)
      return json({ configured: false, error: e.message, commits: [] }, { status: 409 });
    throw e;
  }
});
