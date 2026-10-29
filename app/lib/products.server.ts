import prisma from "../db.server";
import { cached } from "./cache.server";
import { statusesFor, type Filters } from "./filters.server";

/**
 * One row per product (style) for the chosen location. Every screen and every
 * drill-down reads from this, so a number on the Overview always matches the
 * list behind it.
 *
 * A style's age = the age of its oldest stock still on hand.
 */
export type { ProductRow, Flag } from "./types";
import type { ProductRow, Flag } from "./types";


/** All style rows for a location, cached in memory until the next recalculation. */
async function styleRowsFor(locationId: string): Promise<ProductRow[]> {
  return cached(`styles:${locationId}`, async () => {
    const rows = await prisma.styleRow.findMany({ where: { locationId } });
    return rows.map(({ productId, locationId: _l, computedAt: _c, ...r }) => ({ id: productId, ...r }));
  });
}

export async function getProductRows(filters: Filters): Promise<ProductRow[]> {
  const statuses = new Set(statusesFor(filters));
  const rows = await styleRowsFor(filters.locationId);
  return rows.filter(
    (r) =>
      statuses.has(r.status) &&
      (!filters.vendor || r.vendor === filters.vendor) &&
      (!filters.productType || r.productType === filters.productType),
  );
}

export function applyDrilldown(rows: ProductRow[], q: URLSearchParams) {
  const flag = q.get("flag") as Flag | null;
  const bucket = q.get("bucket");
  return rows.filter((r) => {
    if (bucket && r.bucket !== bucket) return false;
    switch (flag) {
      case "dead": return r.isDead;
      case "aged": return r.ageDays !== null && r.ageDays > 90;
      case "stockout": return r.stockoutVariants > 0;
      case "low": return r.lowStockVariants > 0;
      case "broken": return r.brokenRun;
      case "missingcost": return r.missingCost;
      default: return flag ? true : r.onHand > 0 || r.stockoutVariants > 0;
    }
  });
}

export function summarize(rows: ProductRow[]) {
  let cost = 0, retail = 0, units = 0, sold90 = 0, aged = 0, dead = 0, stockouts = 0, low = 0, broken = 0;
  const byBucket: Record<string, number> = {};
  const byVendor = new Map<string, { cost: number; units: number; sold90: number; styles: number }>();
  for (const r of rows) {
    cost += r.costCents; retail += r.retailCents; units += r.onHand; sold90 += r.sold90;
    if (r.ageDays !== null && r.ageDays > 90) aged += r.costCents;
    if (r.isDead) dead += r.costCents;
    stockouts += r.stockoutVariants;
    low += r.lowStockVariants;
    if (r.brokenRun) broken++;
    byBucket[r.bucket] = (byBucket[r.bucket] ?? 0) + r.costCents;
    if (r.onHand > 0) {
      const v = byVendor.get(r.vendor) ?? { cost: 0, units: 0, sold90: 0, styles: 0 };
      v.cost += r.costCents; v.units += r.onHand; v.sold90 += r.sold90; v.styles++;
      byVendor.set(r.vendor, v);
    }
  }
  const topVendors = [...byVendor.entries()]
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 10)
    .map(([vendor, v]) => ({ vendor, ...v, sellThrough90: v.sold90 + v.units > 0 ? v.sold90 / (v.sold90 + v.units) : null }));
  return {
    kpis: {
      costCents: cost, retailCents: retail, units,
      sellThrough90: sold90 + units > 0 ? sold90 / (sold90 + units) : null,
      agedShare: cost > 0 ? aged / cost : null,
      agedCostCents: aged, deadCostCents: dead, stockouts, lowStock: low, brokenRuns: broken,
    },
    byBucket,
    topVendors,
  };
}
