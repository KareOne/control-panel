import { NextRequest } from "next/server";
import { handler, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: NextRequest) => {
  await requireRole(req, "READONLY");
  const rows = await prisma.moduleBudget.findMany({
    orderBy: [{ module: "asc" }, { period: "asc" }],
  });

  // Join with actual spend
  const now = new Date();
  const budgetsWithSpend = await Promise.all(
    rows.map(async (b) => {
      const from = periodStart(b.period, now);
      const agg = await prisma.billingEvent.aggregate({
        where: { module: b.module, requestAt: { gte: from }, isFreeTier: false },
        _sum: { totalCost: true },
      });
      const spend = agg._sum.totalCost ?? 0;
      return {
        ...b,
        spend,
        pct: b.limitAmount > 0 ? Math.round((spend / b.limitAmount) * 100) : 0,
        breached: spend >= b.limitAmount,
      };
    })
  );

  return json({ budgets: budgetsWithSpend });
});

function periodStart(period: string, now: Date): Date {
  if (period === "daily") return new Date(now.getTime() - 86400_000);
  if (period === "weekly") return new Date(now.getTime() - 7 * 86400_000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export const POST = handler(async (req: NextRequest) => {
  await requireRole(req, "ADMIN");
  const body = await req.json();
  if (!body.module || !body.period || !body.limitAmount) {
    return json({ error: "module, period, and limitAmount are required" }, { status: 400 });
  }
  const row = await prisma.moduleBudget.upsert({
    where: { module_period: { module: body.module, period: body.period } },
    create: {
      module: body.module,
      period: body.period,
      limitAmount: Number(body.limitAmount),
      enabled: body.enabled ?? true,
    },
    update: {
      limitAmount: Number(body.limitAmount),
      enabled: body.enabled ?? true,
    },
  });
  return json(row, { status: 201 });
});
