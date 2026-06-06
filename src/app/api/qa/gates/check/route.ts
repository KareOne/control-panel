import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { checkQualityGate } from "@/lib/qualitygates";

export const dynamic = "force-dynamic";

export const POST = handler(async (req: NextRequest) => {
  await requireRole(req, "READONLY");
  const body = await req.json();
  if (!body.environment) {
    return json({ error: "environment required" }, { status: 400 });
  }
  const result = await checkQualityGate(body.environment, body.commitSha ?? null);
  return json(result);
});
