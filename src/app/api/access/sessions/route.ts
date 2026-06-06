import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: NextRequest) => {
  const u = await requireRole(req, "READONLY");

  // ADMINs see all users' sessions; others see only their own
  const where =
    u.role === "ADMIN" ? {} : { userId: u.id };

  const sessions = await prisma.session.findMany({
    where,
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { lastSeenAt: "desc" },
    take: 200,
  });

  return json(
    sessions.map((s) => ({
      id: s.id,
      tokenId: s.tokenId,
      userId: s.userId,
      userName: s.user.name,
      userEmail: s.user.email,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      expiresAt: s.expiresAt,
      ip: s.ip,
      userAgent: s.userAgent,
      revokedAt: s.revokedAt,
      isActive: !s.revokedAt && s.expiresAt > new Date(),
    }))
  );
});
