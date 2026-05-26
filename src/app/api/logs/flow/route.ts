import { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { readElkConfig, buildAuthHeaders } from "@/lib/elk";

export const dynamic = "force-dynamic";

const schema = z.object({
  from: z.string().default(() => new Date(Date.now() - 30 * 60_000).toISOString()),
  to: z.string().default(() => new Date().toISOString()),
  services: z.array(z.string()).optional(),
  size: z.number().int().min(1).max(50).default(30),
});

function deriveService(src: Record<string, unknown>, index: string): string {
  if (src.service && typeof src.service === "string") return src.service;
  if (src.logger_name && typeof src.logger_name === "string") return src.logger_name as string;
  const m = index.match(/^([a-z][a-z-]+?)-(?:scraper-)?logs/);
  return m?.[1] ?? "unknown";
}

export const POST = handler(async (req: NextRequest) => {
  await requireRole(req, "READONLY");
  const body = schema.parse(await req.json());
  const cfg = await readElkConfig();

  const esUrl = cfg.url?.replace(/\/$/, "");
  if (!esUrl)
    return json({ ok: false, error: "Elasticsearch URL not configured." }, { status: 400 });

  const indexPattern = cfg.indexPattern || "*";
  const authHeaders = buildAuthHeaders(cfg);

  const filters: unknown[] = [
    { range: { "@timestamp": { gte: body.from, lte: body.to } } },
  ];
  if (body.services?.length) {
    filters.push({
      bool: {
        should: [
          { terms: { "service.keyword": body.services } },
          { terms: { "logger_name.keyword": body.services } },
        ],
      },
    });
  }

  const esQuery = {
    size: 0,
    query: { bool: { filter: filters } },
    aggs: {
      sessions: {
        terms: {
          field: "session_id.keyword",
          size: body.size,
          order: { latest_ts: "desc" },
        },
        aggs: {
          latest_ts: { max: { field: "@timestamp" } },
          first_ts:  { min: { field: "@timestamp" } },
          latest_hit: {
            top_hits: {
              size: 1,
              sort: [{ "@timestamp": { order: "desc" } }],
              _source: ["@timestamp", "phase", "step", "message", "service", "logger_name", "level"],
            },
          },
          first_hit: {
            top_hits: {
              size: 1,
              sort: [{ "@timestamp": { order: "asc" } }],
              _source: ["service", "logger_name"],
            },
          },
          phases: {
            terms: { field: "phase.keyword", size: 50, order: { first_seen: "asc" } },
            aggs: {
              first_seen: { min: { field: "@timestamp" } },
              latest: {
                top_hits: {
                  size: 1,
                  sort: [{ "@timestamp": { order: "desc" } }],
                  _source: ["step", "message", "@timestamp"],
                },
              },
            },
          },
        },
      },
    },
  };

  let esResult: Record<string, unknown>;
  try {
    const res = await fetch(`${esUrl}/${indexPattern}/_search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(esQuery),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return json(
        { ok: false, error: `Elasticsearch returned HTTP ${res.status}: ${text.slice(0, 300)}` },
        { status: 502 }
      );
    }
    esResult = await res.json();
  } catch (err) {
    return json(
      { ok: false, error: `Cannot reach Elasticsearch: ${err instanceof Error ? err.message : err}` },
      { status: 502 }
    );
  }

  const buckets = (esResult as any).aggregations?.sessions?.buckets ?? [];

  const sessions = buckets.map((b: any) => {
    const latestHit = b.latest_hit?.hits?.hits?.[0];
    const firstHit  = b.first_hit?.hits?.hits?.[0];
    const latestSrc: Record<string, unknown> = latestHit?._source ?? {};
    const firstSrc:  Record<string, unknown> = firstHit?._source  ?? {};
    const latestIdx: string = latestHit?._index ?? "";
    const firstIdx:  string = firstHit?._index  ?? "";

    const service =
      deriveService(latestSrc, latestIdx) ||
      deriveService(firstSrc, firstIdx) ||
      "unknown";

    const latestTs: string = b.latest_ts?.value_as_string ?? (latestSrc["@timestamp"] as string) ?? "";
    const firstTs:  string = b.first_ts?.value_as_string  ?? (firstSrc["@timestamp"]  as string) ?? "";

    const seenPhases = (b.phases?.buckets ?? []).map((pb: any) => {
      const pSrc = pb.latest?.hits?.hits?.[0]?._source ?? {};
      return {
        phase:   pb.key as string,
        step:    (pSrc.step    as string) ?? "",
        ts:      (pSrc["@timestamp"] as string) ?? "",
        message: (pSrc.message as string) ?? "",
      };
    });

    const currentPhase:   string = (latestSrc.phase   as string) ?? "";
    const currentStep:    string = (latestSrc.step     as string) ?? "";
    const currentMessage: string = (latestSrc.message  as string) ?? "";
    const level:          string = (latestSrc.level    as string) ?? "";

    let status: "running" | "completed" | "failed" = "running";
    if (currentPhase === "completed" || currentStep === "completed") status = "completed";
    if (
      level === "ERROR" ||
      currentStep === "failed" ||
      currentStep === "error" ||
      seenPhases.some((p: any) =>
        p.step === "failed" || p.step === "error" || p.step === "all_failed"
      )
    )
      status = "failed";

    return {
      sessionId: b.key as string,
      service,
      startedAt: firstTs,
      lastSeenAt: latestTs,
      durationMs:
        latestTs && firstTs
          ? new Date(latestTs).getTime() - new Date(firstTs).getTime()
          : 0,
      currentPhase,
      currentStep,
      currentMessage,
      status,
      seenPhases,
    };
  });

  return json({ ok: true, sessions });
});
