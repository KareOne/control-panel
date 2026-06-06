import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const ENVS = ["DEV", "STAGING", "DEMO", "OPERATIONAL", "PROD"] as const;

export const PUT = handler(async (req: NextRequest, ctx: any) => {
  await requireRole(req, "ADMIN");
  const { env } = await ctx.params;
  if (!ENVS.includes(env as any)) {
    return json({ error: "invalid environment" }, { status: 400 });
  }
  const body = await req.json();

  const gate = await prisma.qualityGate.upsert({
    where: { environment: env as any },
    create: {
      environment: env as any,
      minPassRate: body.minPassRate ?? 0.8,
      requireP0Checks: body.requireP0Checks ?? true,
      blockOnFailing: body.blockOnFailing ?? true,
      enabled: body.enabled ?? true,
    },
    update: {
      ...(body.minPassRate !== undefined ? { minPassRate: body.minPassRate } : {}),
      ...(body.requireP0Checks !== undefined ? { requireP0Checks: body.requireP0Checks } : {}),
      ...(body.blockOnFailing !== undefined ? { blockOnFailing: body.blockOnFailing } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    },
  });
  return json(gate);
});

export const DELETE = handler(async (req: NextRequest, ctx: any) => {
  await requireRole(req, "ADMIN");
  const { env } = await ctx.params;
  if (!ENVS.includes(env as any)) {
    return json({ error: "invalid environment" }, { status: 400 });
  }
  await prisma.qualityGate.delete({ where: { environment: env as any } }).catch(() => null);
  return json({ ok: true });
});
