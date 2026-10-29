import prisma from "../db.server";
import { DEFAULT_STATUSES, type ViewFilters } from "./views.server";

import { BUCKETS } from "./buckets";

export { BUCKETS };

export async function getOverview(filters: ViewFilters) {
  const locationId = filters.locationId ?? "ALL";
  const statuses = filters.statuses?.length ? filters.statuses : DEFAULT_STATUSES;
  const rows = await prisma.variantMetric.findMany({
    where: {
      locationId,
      variant: {
        product: {
          status: { in: statuses },
          ...(filters.vendors?.length ? { vendor: { in: filters.vendors } } : {}),
          ...(filters.productTypes?.length ? { productType: { in: filters.productTypes } } : {}),
        },
      },
    },
    select: {
      onHand: true, costCents: true, retailCents: true, sold90: true, ageDays: true,
      agingBucket: true, isDead: true, isStockout: true, isLowStock: true,
      variant: { select: { product: { select: { vendor: true, tags: true } } } },
    },
  });
  const tagFilter = filters.tags?.length ? new Set(filters.tags) : null;
  const scoped = tagFilter
    ? rows.filter((r) => (JSON.parse(r.variant.product.tags) as string[]).some((t) => tagFilter.has(t)))
    : rows;

  let cost = 0, retail = 0, units = 0, sold90 = 0, aged = 0, dead = 0, stockouts = 0, lowStock = 0;
  const byBucket = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<string, number>;
  const byVendor = new Map<string, { cost: number; units: number; sold90: number }>();
  for (const r of scoped) {
    const u = Math.max(r.onHand, 0);
    cost += r.costCents; retail += r.retailCents; units += u; sold90 += r.sold90;
    if (r.ageDays !== null && r.ageDays > 90) aged += r.costCents;
    if (r.isDead) dead += r.costCents;
    if (r.isStockout) stockouts++;
    if (r.isLowStock) lowStock++;
    if (r.agingBucket in byBucket) byBucket[r.agingBucket] += r.costCents;
    const v = byVendor.get(r.variant.product.vendor) ?? { cost: 0, units: 0, sold90: 0 };
    v.cost += r.costCents; v.units += u; v.sold90 += r.sold90;
    byVendor.set(r.variant.product.vendor, v);
  }
  const topVendors = [...byVendor.entries()]
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 10)
    .map(([vendor, v]) => ({ vendor, ...v, sellThrough90: v.sold90 + v.units > 0 ? v.sold90 / (v.sold90 + v.units) : null }));

  return {
    kpis: {
      costCents: cost,
      retailCents: retail,
      units,
      sellThrough90: sold90 + units > 0 ? sold90 / (sold90 + units) : null,
      agedShare: cost > 0 ? aged / cost : null,
      deadCostCents: dead,
      stockouts,
      lowStock,
    },
    byBucket,
    topVendors,
  };
}

export async function getDataQuality() {
  const [negative, missingCost, untracked] = await Promise.all([
    prisma.inventoryLevel.count({ where: { onHand: { lt: 0 }, variant: { tracked: true } } }),
    prisma.variant.count({ where: { tracked: true, unitCostCents: null, levels: { some: { onHand: { gt: 0 } } } } }),
    prisma.variant.count({ where: { tracked: false } }),
  ]);
  return { negativeOnHandLevels: negative, inStockMissingCost: missingCost, untrackedVariantsExcluded: untracked };
}
