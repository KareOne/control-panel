import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { anomalies, anomaliesByDimension } from "@/lib/billing";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: NextRequest) => {
  await requireRole(req, "READONLY");
  const u = new URL(req.url);
  const groupBy = u.searchParams.get("groupBy") as "module" | "provider" | "model" | null;

  if (groupBy && ["module", "provider", "model"].includes(groupBy)) {
    return json({ byDimension: await anomaliesByDimension(groupBy) });
  }
  return json({ anomalies: await anomalies() });
});
