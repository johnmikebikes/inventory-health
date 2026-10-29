import prisma from "../db.server";
import { agingBucket } from "./aging";
import { getSettings } from "./settings.server";
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


export async function getProductRows(filters: Filters): Promise<ProductRow[]> {
  const settings = await getSettings();
  const products = await prisma.product.findMany({
    where: {
      status: { in: statusesFor(filters) },
      ...(filters.vendor ? { vendor: filters.vendor } : {}),
      ...(filters.productType ? { productType: filters.productType } : {}),
    },
    select: { id: true, title: true, vendor: true, productType: true, status: true, publishedAt: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const [metrics, productMetrics] = await Promise.all([
    prisma.variantMetric.findMany({
      where: { locationId: filters.locationId },
      select: {
        onHand: true, available: true, costCents: true, retailCents: true, sold28: true, sold30: true, sold90: true,
        soldDeadWindow: true, ageDays: true, ageEstimated: true, isStockout: true, isLowStock: true,
        variant: { select: { productId: true, unitCostCents: true } },
      },
    }),
    prisma.productMetric.findMany({ where: { locationId: filters.locationId } }),
  ]);
  const pm = new Map(productMetrics.map((m) => [m.productId, m]));

  const rows = new Map<string, ProductRow & { soldDead: number; sold28: number }>();
  for (const m of metrics) {
    const p = byId.get(m.variant.productId);
    if (!p) continue;
    let r = rows.get(p.id);
    if (!r) {
      const sizes = pm.get(p.id);
      r = {
        id: p.id, title: p.title, vendor: p.vendor, productType: p.productType, status: p.status,
        onHand: 0, available: 0, costCents: 0, retailCents: 0, sold28: 0, sold30: 0, sold90: 0, soldDead: 0,
        sellThrough30: null, sellThrough90: null, weeksOfSupply: null,
        ageDays: null, ageEstimated: false, bucket: "no-stock", isDead: false,
        stockoutVariants: 0, lowStockVariants: 0,
        brokenRun: sizes?.brokenRun ?? false, expectedSizes: sizes?.expectedSizes ?? 0, inStockSizes: sizes?.inStockSizes ?? 0,
        missingCost: false,
      };
      rows.set(p.id, r);
    }
    const units = Math.max(m.onHand, 0);
    r.onHand += units;
    r.available += Math.max(m.available, 0);
    r.costCents += m.costCents;
    r.retailCents += m.retailCents;
    r.sold28 += m.sold28;
    r.sold30 += m.sold30;
    r.sold90 += m.sold90;
    r.soldDead += m.soldDeadWindow;
    if (m.isStockout) r.stockoutVariants++;
    if (m.isLowStock) r.lowStockVariants++;
    if (units > 0 && m.variant.unitCostCents === null) r.missingCost = true;
    if (units > 0 && m.ageDays !== null && (r.ageDays === null || m.ageDays > r.ageDays)) {
      r.ageDays = m.ageDays;
      r.ageEstimated = m.ageEstimated;
    }
  }

  const out: ProductRow[] = [];
  for (const r of rows.values()) {
    const p = byId.get(r.id)!;
    const st = (sold: number) => (sold + r.onHand > 0 ? sold / (sold + r.onHand) : null);
    r.sellThrough30 = st(r.sold30);
    r.sellThrough90 = st(r.sold90);
    r.weeksOfSupply = r.sold28 > 0 ? r.available / (r.sold28 / 4) : null;
    r.bucket = agingBucket(r.ageDays, r.onHand > 0, !p.publishedAt && r.onHand > 0);
    r.isDead = r.onHand > 0 && r.soldDead === 0 && r.ageDays !== null && r.ageDays > settings.deadStockMinAgeDays;
    const { soldDead: _sd, sold28: _s28, ...row } = r;
    out.push(row);
  }
  return out;
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
