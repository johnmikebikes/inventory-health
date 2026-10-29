import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStyleRows, type StyleVariantMetric } from "./styles.ts";

const product = { id: "P1", title: "AF1 Low White", vendor: "NIKE", productType: "Footwear", status: "ACTIVE", publishedAt: new Date("2025-01-01") };
const v = (o: Partial<StyleVariantMetric>): StyleVariantMetric => ({
  productId: "P1", locationId: "ALL", unitCostCents: 5000, onHand: 0, available: 0, costCents: 0, retailCents: 0,
  sold28: 0, sold30: 0, sold90: 0, soldDeadWindow: 0, ageDays: null, ageEstimated: false, isStockout: false, isLowStock: false, ...o,
});

test("rolls sizes up into one style row with the oldest age", () => {
  const [r] = buildStyleRows(
    [product],
    [
      v({ onHand: 3, available: 3, costCents: 15000, retailCents: 33000, sold28: 4, sold30: 4, sold90: 9, soldDeadWindow: 9, ageDays: 40 }),
      v({ onHand: 1, available: 1, costCents: 5000, retailCents: 11000, sold90: 1, soldDeadWindow: 1, ageDays: 120, ageEstimated: true }),
      v({ onHand: 0, available: 0, sold28: 3, sold30: 3, sold90: 5, soldDeadWindow: 5, isStockout: true }),
    ],
    [{ productId: "P1", locationId: "ALL", brokenRun: false, expectedSizes: 3, inStockSizes: 2 }],
    60,
  );
  assert.equal(r.onHand, 4);
  assert.equal(r.costCents, 20000);
  assert.equal(r.ageDays, 120);
  assert.equal(r.ageEstimated, true);
  assert.equal(r.bucket, "91-180");
  assert.equal(r.stockoutVariants, 1);
  assert.equal(r.sold90, 15);
  assert.ok(Math.abs((r.sellThrough90 ?? 0) - 15 / 19) < 1e-9);
  assert.equal(r.weeksOfSupply, 4 / (7 / 4));
  assert.equal(r.isDead, false);
  assert.equal(r.inStockSizes, 2);
});

test("no sales in the window and old enough = dead stock", () => {
  const [r] = buildStyleRows([product], [v({ onHand: 2, available: 2, costCents: 10000, ageDays: 200 })], [], 60);
  assert.equal(r.isDead, true);
  assert.equal(r.weeksOfSupply, null);
});

test("unpublished draft with stock = pre-release, never dead", () => {
  const [r] = buildStyleRows([{ ...product, status: "DRAFT", publishedAt: null }], [v({ onHand: 5, available: 5, costCents: 25000, ageDays: null })], [], 60);
  assert.equal(r.bucket, "pre-release");
  assert.equal(r.isDead, false);
});
