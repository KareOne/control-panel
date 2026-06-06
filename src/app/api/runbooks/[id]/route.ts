import { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const CATEGORIES = [
  "INCIDENT",
  "DEPLOY",
  "MAINTENANCE",
  "SECURITY",
  "DATABASE",
  "NETWORK",
  "GENERAL",
] as const;

const stepSchema = z.object({
  order: z.number().int().min(0),
  title: z.string().min(1),
  description: z.string().default(""),
  isAutomated: z.boolean().default(false),
  command: z.string().optional(),
});

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  category: z.enum(CATEGORIES).optional(),
  steps: z.array(stepSchema).min(1).optional(),
  tags: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

export const GET = handler(
  async (req: NextRequest, ctx: { params: { id: string } }) => {
    await requireRole(req, "READONLY");
    const runbook = await prisma.runbook.findUnique({
      where: { id: ctx.params.id },
      include: {
        runs: {
          orderBy: { startedAt: "desc" },
          take: 5,
        },
      },
    });
    if (!runbook) throw new Response("Not found", { status: 404 });
    return json(runbook);
  }
);

export const PUT = handler(
  async (req: NextRequest, ctx: { params: { id: string } }) => {
    await requireRole(req, "ENGINEER");
    const existing = await prisma.runbook.findUnique({
      where: { id: ctx.params.id },
      select: { id: true },
    });
    if (!existing) throw new Response("Not found", { status: 404 });

    const body = updateSchema.parse(await req.json());
    const runbook = await prisma.runbook.update({
      where: { id: ctx.params.id },
      data: {
        ...(body.title !== undefined && { title: body.title }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.category !== undefined && { category: body.category }),
        ...(body.steps !== undefined && { steps: body.steps }),
        ...(body.tags !== undefined && { tags: body.tags }),
        ...(body.enabled !== undefined && { enabled: body.enabled }),
      },
    });
    return json(runbook);
  }
);

export const DELETE = handler(
  async (req: NextRequest, ctx: { params: { id: string } }) => {
    await requireRole(req, "ADMIN");
    const existing = await prisma.runbook.findUnique({
      where: { id: ctx.params.id },
      select: { id: true },
    });
    if (!existing) throw new Response("Not found", { status: 404 });
    await prisma.runbook.delete({ where: { id: ctx.params.id } });
    return json({ ok: true });
  }
);
