import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const PUT = handler(async (req: NextRequest, ctx: any) => {
  await requireRole(req, "ENGINEER");
  const { module } = await ctx.params;
  const body = await req.json();

  if (!body.primaryModel || !body.fallbackModel) {
    return json({ error: "primaryModel and fallbackModel are required" }, { status: 400 });
  }

  const KINDS = ["CHEAP_MODEL", "HIGH_QUALITY_MODEL", "LOCAL", "DETERMINISTIC"];
  if (body.fallbackKind && !KINDS.includes(body.fallbackKind)) {
    return json({ error: "invalid fallbackKind" }, { status: 400 });
  }

  const row = await prisma.fallbackPolicy.upsert({
    where: { module },
    create: {
      module,
      primaryModel: body.primaryModel,
      fallbackModel: body.fallbackModel,
      fallbackKind: body.fallbackKind ?? "CHEAP_MODEL",
      triggerOnError: body.triggerOnError ?? true,
      triggerOnTimeout: body.triggerOnTimeout ?? false,
      triggerOnHighCost: body.triggerOnHighCost ?? false,
      triggerOnLowQuality: body.triggerOnLowQuality ?? false,
      maxRetries: body.maxRetries ?? 1,
      timeoutMs: body.timeoutMs ?? null,
      costThresholdUsd: body.costThresholdUsd ?? null,
      qualityThreshold: body.qualityThreshold ?? null,
      enabled: body.enabled ?? true,
      notes: body.notes ?? null,
    },
    update: {
      ...(body.primaryModel !== undefined ? { primaryModel: body.primaryModel } : {}),
      ...(body.fallbackModel !== undefined ? { fallbackModel: body.fallbackModel } : {}),
      ...(body.fallbackKind !== undefined ? { fallbackKind: body.fallbackKind } : {}),
      ...(body.triggerOnError !== undefined ? { triggerOnError: body.triggerOnError } : {}),
      ...(body.triggerOnTimeout !== undefined ? { triggerOnTimeout: body.triggerOnTimeout } : {}),
      ...(body.triggerOnHighCost !== undefined ? { triggerOnHighCost: body.triggerOnHighCost } : {}),
      ...(body.triggerOnLowQuality !== undefined ? { triggerOnLowQuality: body.triggerOnLowQuality } : {}),
      ...(body.maxRetries !== undefined ? { maxRetries: body.maxRetries } : {}),
      ...(body.timeoutMs !== undefined ? { timeoutMs: body.timeoutMs } : {}),
      ...(body.costThresholdUsd !== undefined ? { costThresholdUsd: body.costThresholdUsd } : {}),
      ...(body.qualityThreshold !== undefined ? { qualityThreshold: body.qualityThreshold } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    },
  });
  return json(row);
});

export const DELETE = handler(async (req: NextRequest, ctx: any) => {
  await requireRole(req, "ENGINEER");
  const { module } = await ctx.params;
  await prisma.fallbackPolicy.delete({ where: { module } }).catch(() => null);
  return json({ ok: true });
});
