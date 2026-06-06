import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const ENVS = ["DEV", "STAGING", "DEMO", "OPERATIONAL", "PROD"] as const;

export const GET = handler(async (req: NextRequest) => {
  await requireRole(req, "READONLY");
  const u = new URL(req.url);
  const env = u.searchParams.get("environment");
  const version = u.searchParams.get("version");

  const checklists = await prisma.releaseChecklist.findMany({
    where: {
      ...(env && ENVS.includes(env as any) ? { environment: env as any } : {}),
      ...(version ? { version } : {}),
    },
    include: {
      items: { orderBy: [{ priority: "asc" }, { createdAt: "asc" }] },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return json(checklists);
});

export const POST = handler(async (req: NextRequest) => {
  await requireRole(req, "ENGINEER");
  const body = await req.json();
  if (!body.version || !body.environment) {
    return json({ error: "version and environment required" }, { status: 400 });
  }
  if (!ENVS.includes(body.environment)) {
    return json({ error: "invalid environment" }, { status: 400 });
  }
  const checklist = await prisma.releaseChecklist.create({
    data: {
      version: body.version,
      environment: body.environment,
      title: body.title ?? null,
    },
    include: { items: true },
  });
  return json(checklist, { status: 201 });
});
