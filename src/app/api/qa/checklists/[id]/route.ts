import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: NextRequest, ctx: any) => {
  await requireRole(req, "READONLY");
  const { id } = await ctx.params;
  const checklist = await prisma.releaseChecklist.findUnique({
    where: { id },
    include: { items: { orderBy: [{ priority: "asc" }, { createdAt: "asc" }] } },
  });
  if (!checklist) return json({ error: "not found" }, { status: 404 });
  return json(checklist);
});

export const PATCH = handler(async (req: NextRequest, ctx: any) => {
  await requireRole(req, "ENGINEER");
  const { id } = await ctx.params;
  const body = await req.json();
  const checklist = await prisma.releaseChecklist.update({
    where: { id },
    data: {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.version !== undefined ? { version: body.version } : {}),
    },
    include: { items: true },
  });
  return json(checklist);
});

export const DELETE = handler(async (req: NextRequest, ctx: any) => {
  await requireRole(req, "ADMIN");
  const { id } = await ctx.params;
  await prisma.releaseChecklist.delete({ where: { id } });
  return json({ ok: true });
});
