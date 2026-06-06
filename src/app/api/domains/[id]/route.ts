import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const GET = handler(async (_req: NextRequest, { params }: { params: { id: string } }) => {
  await requireRole(_req, "READONLY");
  const row = await prisma.domain.findUniqueOrThrow({ where: { id: params.id } });
  return json(row);
});

export const PUT = handler(async (req: NextRequest, { params }: { params: { id: string } }) => {
  await requireRole(req, "ENGINEER");
  const body = await req.json();
  const row = await prisma.domain.update({
    where: { id: params.id },
    data: {
      name: body.name?.trim(),
      service: body.service ?? undefined,
      proxyTarget: body.proxyTarget ?? undefined,
      sslAutoRenew: body.sslAutoRenew ?? undefined,
      notes: body.notes ?? undefined,
    },
  });
  return json(row);
});

export const DELETE = handler(async (req: NextRequest, { params }: { params: { id: string } }) => {
  await requireRole(req, "ADMIN");
  await prisma.domain.delete({ where: { id: params.id } });
  return json({ ok: true });
});
