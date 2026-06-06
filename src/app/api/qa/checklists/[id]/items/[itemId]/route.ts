import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const PATCH = handler(async (req: NextRequest, ctx: any) => {
  await requireRole(req, "ENGINEER");
  const { itemId } = await ctx.params;
  const body = await req.json();

  const data: Record<string, unknown> = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.description !== undefined) data.description = body.description;
  if (body.kind !== undefined) data.kind = body.kind;
  if (body.priority !== undefined) data.priority = body.priority;
  if (body.status !== undefined) data.status = body.status;
  if (body.owner !== undefined) data.owner = body.owner;
  if (body.reviewer !== undefined) data.reviewer = body.reviewer;
  if (body.notes !== undefined) data.notes = body.notes;
  if (body.status === "PASSING") data.verifiedAt = new Date();

  const item = await prisma.releaseChecklistItem.update({
    where: { id: itemId },
    data,
  });
  return json(item);
});

export const DELETE = handler(async (req: NextRequest, ctx: any) => {
  await requireRole(req, "ENGINEER");
  const { itemId } = await ctx.params;
  await prisma.releaseChecklistItem.delete({ where: { id: itemId } });
  return json({ ok: true });
});
