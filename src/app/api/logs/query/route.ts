import { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import {
  readElkConfig,
  buildAuthHeaders,
  intervalForRange,
} from "@/lib/elk";

export const dynamic = "force-dynamic";

const schema = z.object({
  indexPattern: z.string().optional(),
  from: z.string(),
  to: z.string(),
  search: z.string().optional(),
  phases: z.array(z.string()).optional(),
  scraper: z.string().optional(),
  size: z.number().int().min(1).max(1000).default(200),
  sortDir: z.enum(["desc", "asc"]).default("desc"),
  includeSessions: z.boolean().default(true),
});

export const POST = handler(async (req: NextRequest) => {
  await requireRole(req, "READONLY");
  const body = schema.parse(await req.json());
  const cfg = await readElkConfig();

  const esUrl = cfg.url?.replace(/\/$/, "");
  if (!esUrl) {
    return json({ ok: false, error: "Elasticsearch URL not configured." }, { status: 400 });
  }

  const indexPattern = body.indexPattern || cfg.indexPattern || "*";
  const authHeaders = buildAuthHeaders(cfg);

  const fromMs = new Date(body.from).getTime();
  const toMs = new Date(body.to).getTime();
  const interval = intervalForRange(fromMs, toMs);

  const filters: unknown[] = [
    { range: { "@timestamp": { gte: body.from, lte: body.to } } },
  ];
  if (body.phases?.length) {
    filters.push({ terms: { "phase.keyword": body.phases } });
  }
  if (body.scraper) {
    filters.push({ term: { "scraper.keyword": body.scraper } });
  }

  const must: unknown[] = [];
  if (body.search?.trim()) {
    must.push({ query_string: { query: body.search.trim(), lenient: true } });
  }

  const esQuery = {
    size: body.size,
    sort: [{ "@timestamp": { order: body.sortDir } }],
    query: {
      bool: {
        filter: filters,
        ...(must.length ? { must } : {}),
      },
    },
    aggs: {
      over_time: {
        date_histogram: {
          field: "@timestamp",
          fixed_interval: interval,
          extended_bounds: { min: body.from, max: body.to },
        },
      },
      phases: { terms: { field: "phase.keyword", size: 50 } },
      scrapers: { terms: { field: "scraper.keyword", size: 30 } },
      levels: { terms: { field: "level.keyword", size: 10 } },
      ...(body.includeSessions
        ? {
            sessions: {
              terms: {
                field: "session_id.keyword",
                size: 100,
                order: { latest_ts: "desc" },
              },
              aggs: {
                latest_ts: { max: { field: "@timestamp" } },
                latest: {
                  top_hits: {
                    size: 1,
                    sort: [{ "@timestamp": { order: "desc" } }],
                    _source: [
                      "@timestamp",
                      "phase",
                      "message",
                      "session_id",
                      "scraper",
                      "level",
                    ],
                  },
                },
              },
            },
          }
        : {}),
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
      { ok: false, error: `Cannot reach Elasticsearch at ${esUrl}: ${err instanceof Error ? err.message : err}` },
      { status: 502 }
    );
  }

  const hits = (esResult as any).hits?.hits?.map((h: any) => ({
    _id: h._id,
    _index: h._index,
    ...h._source,
  })) ?? [];

  const histogram = ((esResult as any).aggregations?.over_time?.buckets ?? []).map(
    (b: any) => ({
      ts: b.key_as_string ?? new Date(b.key).toISOString(),
      count: b.doc_count,
    })
  );

  const phaseCounts: Record<string, number> = {};
  for (const b of (esResult as any).aggregations?.phases?.buckets ?? []) {
    phaseCounts[b.key] = b.doc_count;
  }

  const scrapers: string[] = ((esResult as any).aggregations?.scrapers?.buckets ?? []).map(
    (b: any) => b.key
  );

  const levels: string[] = ((esResult as any).aggregations?.levels?.buckets ?? []).map(
    (b: any) => b.key
  );

  const sessions = ((esResult as any).aggregations?.sessions?.buckets ?? []).map(
    (b: any) => {
      const src = b.aggregations?.latest?.hits?.hits?.[0]?._source ?? {};
      return {
        sessionId: b.key as string,
        count: b.doc_count as number,
        latestTs: src["@timestamp"] as string | undefined,
        phase: src.phase as string | undefined,
        message: src.message as string | undefined,
        scraper: src.scraper as string | undefined,
        level: src.level as string | undefined,
      };
    }
  );

  const totalHits = (esResult as any).hits?.total;
  const total = typeof totalHits === "object" ? totalHits.value : totalHits ?? 0;

  return json({
    ok: true,
    total,
    hits,
    histogram,
    phaseCounts,
    scrapers,
    levels,
    sessions,
    interval,
  });
});
