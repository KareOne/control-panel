import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const GET = handler(
  async (req: NextRequest, ctx: { params: { id: string } }) => {
    await requireRole(req, "READONLY");

    const run = await prisma.deployRun.findUnique({
      where: { id: ctx.params.id },
      select: {
        id: true,
        healthStatus: true,
        healthPort: true,
        environment: true,
        commitSha: true,
        startedAt: true,
        finishedAt: true,
        postDeployChecks: {
          orderBy: { checkedAt: "asc" },
          take: 100,
          select: {
            id: true,
            url: true,
            httpStatus: true,
            durationMs: true,
            ok: true,
            checkedAt: true,
            error: true,
          },
        },
      },
    });

    if (!run) return json({ error: "not found" }, { status: 404 });

    const checks = run.postDeployChecks;
    const total = checks.length;
    const passed = checks.filter((c) => c.ok).length;
    const failed = total - passed;

    return json({
      deployRunId: run.id,
      healthStatus: run.healthStatus,
      healthPort: run.healthPort,
      summary: { total, passed, failed },
      checks,
    });
  }
);
