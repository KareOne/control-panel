import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const PATCH = handler(async (req: NextRequest, ctx: any) => {
  await requireRole(req, "ENGINEER");
  const { id } = await ctx.params;
  const body = await req.json();

  const data: Record<string, unknown> = {};
  if (body.notes !== undefined) data.notes = body.notes;
  if (body.testResults !== undefined) data.testResults = body.testResults;
  if (body.deployedAt !== undefined)
    data.deployedAt = body.deployedAt ? new Date(body.deployedAt) : null;
  if (body.archive === true) data.archivedAt = new Date();
  if (body.archive === false) data.archivedAt = null;

  const row = await prisma.promptVersion.update({ where: { id }, data });
  return json(row);
});

export const DELETE = handler(async (req: NextRequest, ctx: any) => {
  await requireRole(req, "ADMIN");
  const { id } = await ctx.params;
  await prisma.promptVersion.delete({ where: { id } });
  return json({ ok: true });
});
