import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { jobStreamResponse } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export const GET = handler(
  async (req: NextRequest, ctx: { params: { id: string } }) => {
    await requireRole(req, "READONLY");
    const job = await import("@/lib/prisma").then((m) =>
      m.prisma.backgroundJob.findUnique({ where: { id: ctx.params.id } })
    );
    if (!job) return json({ error: "job not found" }, { status: 404 });
    return jobStreamResponse(ctx.params.id);
  }
);
