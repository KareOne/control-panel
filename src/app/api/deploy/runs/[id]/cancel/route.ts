import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const POST = handler(
  async (req: NextRequest, ctx: { params: { id: string } }) => {
    await requireRole(req, "ENGINEER");
    const run = await prisma.deployRun.findUnique({ where: { id: ctx.params.id } });
    if (!run) return json({ error: "not found" }, { status: 404 });
    if (run.state !== "QUEUED" && run.state !== "RUNNING") {
      return json(
        { error: `Cannot cancel a run that is already ${run.state}` },
        { status: 409 }
      );
    }
    await prisma.deployRun.update({
      where: { id: run.id },
      data: { state: "CANCELLED", finishedAt: new Date() },
    });
    return json({ ok: true, state: "CANCELLED" });
  }
);
