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

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  category: z.enum(CATEGORIES).default("GENERAL"),
  steps: z.array(stepSchema).min(1),
  tags: z.array(z.string()).default([]),
});

export const GET = handler(async (req: NextRequest) => {
  await requireRole(req, "READONLY");
  const url = new URL(req.url);
  const category = url.searchParams.get("category");

  const rows = await prisma.runbook.findMany({
    where:
      category && CATEGORIES.includes(category as (typeof CATEGORIES)[number])
        ? { category: category as (typeof CATEGORIES)[number] }
        : undefined,
    orderBy: [{ category: "asc" }, { title: "asc" }],
    include: {
      _count: { select: { runs: true } },
    },
  });
  return json(rows);
});

export const POST = handler(async (req: NextRequest) => {
  const user = await requireRole(req, "ENGINEER");
  const body = createSchema.parse(await req.json());

  const runbook = await prisma.runbook.create({
    data: {
      title: body.title,
      description: body.description ?? null,
      category: body.category,
      steps: body.steps,
      tags: body.tags,
      createdById: user.id,
    },
  });
  return json(runbook, { status: 201 });
});
