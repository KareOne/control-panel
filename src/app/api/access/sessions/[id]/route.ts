import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole, revokeSession, audit } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const DELETE = handler(
  async (req: NextRequest, ctx: { params: { id: string } }) => {
    const u = await requireRole(req, "READONLY");
    const { id } = ctx.params;

    const session = await prisma.session.findUnique({ where: { id } });
    if (!session) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Users can only revoke their own sessions; ADMINs can revoke anyone's
    if (session.userId !== u.id && u.role !== "ADMIN") {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    await revokeSession(session.tokenId);
    await audit(u.id, "SESSION_REVOKED", id, { targetUser: session.userId });

    return json({ ok: true });
  }
);
