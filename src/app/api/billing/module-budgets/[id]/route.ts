import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const DELETE = handler(async (req: NextRequest, ctx: any) => {
  await requireRole(req, "ADMIN");
  const { id } = await ctx.params;
  await prisma.moduleBudget.delete({ where: { id } }).catch(() => null);
  return json({ ok: true });
});
