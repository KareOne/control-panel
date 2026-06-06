import { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json } from "@/lib/api";
import { requireRole, audit } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const ENVS = ["DEV", "STAGING", "DEMO", "OPERATIONAL", "PROD"] as const;

export const GET = handler(async (req: NextRequest) => {
  await requireRole(req, "READONLY");
  const url = new URL(req.url);
  const env = url.searchParams.get("environment");
  const limit = Number(url.searchParams.get("limit") || "100");

  const items = await prisma.deployment.findMany({
    where: env && ENVS.includes(env as any) ? { environment: env as any } : undefined,
    orderBy: { deployedAt: "desc" },
    take: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 500) : 100,
    include: { deployedBy: { select: { id: true, name: true } } },
  });
  return json(items);
});

const createSchema = z.object({
  environment: z.enum(ENVS),
  commitSha: z.string().min(4),
  version: z.string().optional().nullable(),
  logUrl: z.string().url().optional().nullable(),
});

export const POST = handler(async (req: NextRequest) => {
  const user = await requireRole(req, "ENGINEER");
  const body = createSchema.parse(await req.json());

  const startedAt = new Date();
  const dep = await prisma.$transaction(async (tx) => {
    await tx.deployment.updateMany({
      where: { environment: body.environment, status: "active" },
      data: { status: "superseded" },
    });
    return tx.deployment.create({
      data: {
        environment: body.environment,
        commitSha: body.commitSha,
        version: body.version ?? null,
        status: "active",
        deployedById: user.id,
        startedAt,
        finishedAt: startedAt,
        durationMs: 0,
        logUrl: body.logUrl ?? null,
      },
      include: { deployedBy: { select: { id: true, name: true } } },
    });
  });

  await audit(user.id, "deployment.create", dep.id, {
    environment: dep.environment,
    commitSha: dep.commitSha,
    version: dep.version,
  });
  return json(dep, { status: 201 });
});
