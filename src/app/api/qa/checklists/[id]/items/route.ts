import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const POST = handler(async (req: NextRequest, ctx: any) => {
  await requireRole(req, "ENGINEER");
  const { id } = await ctx.params;
  const body = await req.json();
  if (!body.title) return json({ error: "title required" }, { status: 400 });

  const checklist = await prisma.releaseChecklist.findUnique({ where: { id } });
  if (!checklist) return json({ error: "checklist not found" }, { status: 404 });

  const item = await prisma.releaseChecklistItem.create({
    data: {
      checklistId: id,
      title: body.title,
      description: body.description ?? null,
      kind: body.kind ?? "MANUAL",
      priority: body.priority ?? "P1",
      owner: body.owner ?? null,
      reviewer: body.reviewer ?? null,
    },
  });
  return json(item, { status: 201 });
});
