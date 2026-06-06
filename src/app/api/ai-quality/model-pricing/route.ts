import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { getSetting } from "@/lib/api";
import { AI_PROVIDERS_SETTING_KEY, type AiProvidersConfig } from "@/lib/aiquality";

export const dynamic = "force-dynamic";

/**
 * Fetch pricing for a model from the provider's /models endpoint.
 * OpenRouter: GET {baseUrl}/models (public, no auth needed).
 * Returns pricePer1kIn and pricePer1kOut in USD.
 */
export const GET = handler(async (req: NextRequest) => {
  await requireRole(req, "READONLY");
  const u = new URL(req.url);
  const providerKey = (u.searchParams.get("provider") ?? "openrouter") as "openrouter" | "gemini" | "custom";
  const modelId = u.searchParams.get("model");
  if (!modelId) return json({ error: "model is required" }, { status: 400 });

  // Allow caller to pass baseUrl/apiKey directly (e.g. before saving the form)
  const paramBaseUrl = u.searchParams.get("baseUrl");
  const paramApiKey = u.searchParams.get("apiKey");

  let resolvedBaseUrl: string;
  let resolvedApiKey: string | undefined;

  if (paramBaseUrl) {
    resolvedBaseUrl = paramBaseUrl;
    resolvedApiKey = paramApiKey ?? undefined;
  } else {
    const cfg = await getSetting<AiProvidersConfig>(AI_PROVIDERS_SETTING_KEY, { providers: {} });
    const entry = cfg.providers?.[providerKey];
    if (!entry?.baseUrl) return json({ error: "provider not configured" }, { status: 409 });
    resolvedBaseUrl = entry.baseUrl;
    resolvedApiKey = entry.apiKey ?? undefined;
  }

  const base = resolvedBaseUrl.replace(/\/+$/, "");
  const modelsUrl = `${base}/models`;

  let res: Response;
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (resolvedApiKey) headers["authorization"] = `Bearer ${resolvedApiKey}`;
    res = await fetch(modelsUrl, { headers, signal: AbortSignal.timeout(10000) });
  } catch (e) {
    return json({ error: `Failed to reach ${modelsUrl}: ${e instanceof Error ? e.message : e}` }, { status: 502 });
  }

  if (!res.ok) {
    return json({ error: `Provider returned HTTP ${res.status}` }, { status: 502 });
  }

  let body: any;
  try {
    body = await res.json();
  } catch {
    return json({ error: "Non-JSON response from provider" }, { status: 502 });
  }

  // OpenRouter / OpenAI-compatible shape: { data: [{ id, pricing: { prompt, completion } }] }
  const models: any[] = body?.data ?? body?.models ?? [];
  const found = models.find(
    (m: any) => m.id === modelId || m.name === modelId
  );

  if (!found) {
    return json({ error: `Model "${modelId}" not found in provider's model list`, available: models.slice(0, 20).map((m: any) => m.id ?? m.name) }, { status: 404 });
  }

  // OpenRouter: pricing.prompt/completion are per-token strings
  const promptPrice = parseFloat(found.pricing?.prompt ?? found.pricing?.input ?? "0");
  const completionPrice = parseFloat(found.pricing?.completion ?? found.pricing?.output ?? "0");

  if (!promptPrice && !completionPrice) {
    return json({ error: "Model found but pricing is zero or unavailable", raw: found.pricing ?? null }, { status: 404 });
  }

  return json({
    model: found.id ?? found.name,
    pricePer1kIn: Math.round(promptPrice * 1000 * 1e8) / 1e8,
    pricePer1kOut: Math.round(completionPrice * 1000 * 1e8) / 1e8,
    contextLength: found.context_length ?? null,
    source: modelsUrl,
  });
});
