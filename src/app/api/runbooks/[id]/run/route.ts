import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const POST = handler(
  async (req: NextRequest, ctx: { params: { id: string } }) => {
    const user = await requireRole(req, "READONLY");

    const runbook = await prisma.runbook.findUnique({
      where: { id: ctx.params.id },
      select: { id: true },
    });
    if (!runbook) throw new Response("Not found", { status: 404 });

    const run = await prisma.$transaction(async (tx) => {
      await tx.runbook.update({
        where: { id: ctx.params.id },
        data: { lastUsedAt: new Date() },
      });
      return tx.runbookRun.create({
        data: {
          runbookId: ctx.params.id,
          status: "RUNNING",
          triggeredById: user.id,
          stepProgress: 0,
        },
      });
    });

    return json(run, { status: 201 });
  }
);
