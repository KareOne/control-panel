import { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json, maskSecrets } from "@/lib/api";
import { requireRole, audit } from "@/lib/auth";
import {
  readElkConfig,
  writeElkConfig,
  ELK_SETTING_KEY,
  type ElkConfig,
} from "@/lib/elk";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: NextRequest) => {
  await requireRole(req, "READONLY");
  const cfg = await readElkConfig();
  return json(maskSecrets(cfg as unknown as Record<string, unknown>));
});

const schema = z.object({
  url: z.string().optional().nullable(),
  indexPattern: z.string().optional().nullable(),
  authType: z.enum(["none", "basic", "apikey"]).optional().nullable(),
  username: z.string().optional().nullable(),
  password: z.string().optional().nullable(),
  apiKey: z.string().optional().nullable(),
});

function keepUnmasked(incoming: string | null | undefined, stored: string | undefined) {
  if (!incoming) return undefined;
  if (incoming.includes("••••")) return stored;
  return incoming.trim() || undefined;
}

export const PUT = handler(async (req: NextRequest) => {
  const user = await requireRole(req, "ENGINEER");
  const body = schema.parse(await req.json());
  const prev = await readElkConfig();

  const next: ElkConfig = {
    url: body.url?.trim() || prev.url,
    indexPattern: body.indexPattern?.trim() || prev.indexPattern,
    authType: body.authType ?? prev.authType ?? "none",
    username: body.username?.trim() || prev.username,
    password: keepUnmasked(body.password, prev.password),
    apiKey: keepUnmasked(body.apiKey, prev.apiKey),
  };

  await writeElkConfig(next);
  await audit(user.id, "elk.config.update", ELK_SETTING_KEY, {
    url: next.url,
    indexPattern: next.indexPattern,
  });
  return json(maskSecrets(next as unknown as Record<string, unknown>));
});
