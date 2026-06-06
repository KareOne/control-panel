import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: NextRequest) => {
  await requireRole(req, "READONLY");
  const u = new URL(req.url);
  const moduleFilter = u.searchParams.get("module");
  const includeArchived = u.searchParams.get("archived") === "true";

  const rows = await prisma.promptVersion.findMany({
    where: {
      ...(moduleFilter ? { module: moduleFilter } : {}),
      ...(includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: [{ module: "asc" }, { name: "asc" }, { version: "desc" }],
    take: 200,
  });
  return json(rows);
});

export const POST = handler(async (req: NextRequest) => {
  const user = await requireRole(req, "ENGINEER");
  const body = await req.json();
  if (!body.module || !body.name || !body.template) {
    return json({ error: "module, name, and template are required" }, { status: 400 });
  }

  // Auto-increment version for same module+name
  const latest = await prisma.promptVersion.findFirst({
    where: { module: body.module, name: body.name },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const version = (latest?.version ?? 0) + 1;

  const row = await prisma.promptVersion.create({
    data: {
      module: body.module,
      name: body.name,
      version,
      template: body.template,
      variables: body.variables ?? [],
      notes: body.notes ?? null,
      deployedAt: body.deployedAt ? new Date(body.deployedAt) : null,
      testResults: body.testResults ?? null,
      createdById: user.id,
    },
  });
  return json(row, { status: 201 });
});
