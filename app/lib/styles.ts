// Builds one row per style (product) per location from variant metrics.
// Pure (no database) so the nightly calculation and tests share it.
import { agingBucket } from "./aging.ts";
import type { ProductRow } from "./types";

export type StyleProduct = {
  id: string; title: string; vendor: string; productType: string; status: string; publishedAt: Date | null;
};
export type StyleVariantMetric = {
  productId: string; locationId: string; unitCostCents: number | null;
  onHand: number; available: number; costCents: number; retailCents: number;
  sold28: number; sold30: number; sold90: number; soldDeadWindow: number;
  ageDays: number | null; ageEstimated: boolean; isStockout: boolean; isLowStock: boolean;
};
export type StyleSizes = { productId: string; locationId: string; brokenRun: boolean; expectedSizes: number; inStockSizes: number };

export type StyleRow = ProductRow & { locationId: string };

export function buildStyleRows(
  products: StyleProduct[],
  metrics: StyleVariantMetric[],
  sizes: StyleSizes[],
  deadStockMinAgeDays: number,
): StyleRow[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const sizeBy = new Map(sizes.map((s) => [`${s.productId}|${s.locationId}`, s]));
  const rows = new Map<string, StyleRow & { soldDead: number; sold28: number }>();

  for (const m of metrics) {
    const p = byId.get(m.productId);
    if (!p) continue;
    const key = `${p.id}|${m.locationId}`;
    let r = rows.get(key);
    if (!r) {
      const s = sizeBy.get(key);
      r = {
        id: p.id, locationId: m.locationId, title: p.title, vendor: p.vendor, productType: p.productType, status: p.status,
        onHand: 0, available: 0, costCents: 0, retailCents: 0, sold28: 0, sold30: 0, sold90: 0, soldDead: 0,
        sellThrough30: null, sellThrough90: null, weeksOfSupply: null,
        ageDays: null, ageEstimated: false, bucket: "no-stock", isDead: false,
        stockoutVariants: 0, lowStockVariants: 0,
        brokenRun: s?.brokenRun ?? false, expectedSizes: s?.expectedSizes ?? 0, inStockSizes: s?.inStockSizes ?? 0,
        missingCost: false,
      };
      rows.set(key, r);
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
    if (units > 0 && m.unitCostCents === null) r.missingCost = true;
    if (units > 0 && m.ageDays !== null && (r.ageDays === null || m.ageDays > r.ageDays)) {
      r.ageDays = m.ageDays;
      r.ageEstimated = m.ageEstimated;
    }
  }

  const out: StyleRow[] = [];
  for (const r of rows.values()) {
    const p = byId.get(r.id)!;
    const st = (sold: number) => (sold + r.onHand > 0 ? sold / (sold + r.onHand) : null);
    r.sellThrough30 = st(r.sold30);
    r.sellThrough90 = st(r.sold90);
    r.weeksOfSupply = r.sold28 > 0 ? r.available / (r.sold28 / 4) : null;
    r.bucket = agingBucket(r.ageDays, r.onHand > 0, !p.publishedAt && r.onHand > 0);
    r.isDead = r.onHand > 0 && r.soldDead === 0 && r.ageDays !== null && r.ageDays > deadStockMinAgeDays;
    const { soldDead: _sd, sold28: _s28, ...row } = r;
    out.push(row);
  }
  return out;
}
