import { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { readScrapersConfig, writeScrapersConfig } from "@/lib/scrapers";

export const dynamic = "force-dynamic";

const svcSchema = z.object({
  url: z.string(),
  healthPath: z.string(),
});

const schema = z.object({
  orchestratorUrl: z.string(),
  services: z.record(z.string(), svcSchema),
});

export const GET = handler(async (req: NextRequest) => {
  await requireRole(req, "READONLY");
  const cfg = await readScrapersConfig();
  return json(cfg);
});

export const PUT = handler(async (req: NextRequest) => {
  await requireRole(req, "ENGINEER");
  const body = schema.parse(await req.json());
  await writeScrapersConfig(body);
  return json({ ok: true });
});
