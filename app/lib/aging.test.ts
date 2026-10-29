import { test } from "node:test";
import assert from "node:assert/strict";
import { agingBucket, stockCycleStart, type Movement } from "./aging.ts";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const m = (date: string, kind: string, qty: number, locationId = "L1"): Movement => ({ locationId, date: d(date), kind, qty });
const iso = (x: Date | null) => x?.toISOString().slice(0, 10) ?? null;

test("new style: ages from its first receipt", () => {
  const r = stockCycleStart([m("2025-06-01", "initial", 10), m("2025-06-20", "sold", 4)], 6, d("2025-06-01"));
  assert.equal(iso(r.start), "2025-06-01");
  assert.equal(r.estimated, false);
});

test("sold through then restocked: age restarts at the restock", () => {
  const r = stockCycleStart(
    [m("2025-01-01", "initial", 5), m("2025-02-01", "sold", 5), m("2025-03-01", "stock_in", 6)],
    6, d("2025-01-01"));
  assert.equal(iso(r.start), "2025-03-01");
});

test("restocked while still in stock: oldest stock keeps the clock running", () => {
  const r = stockCycleStart(
    [m("2025-01-01", "initial", 5), m("2025-02-01", "sold", 2), m("2025-03-01", "stock_in", 5)],
    8, d("2025-01-01"));
  assert.equal(iso(r.start), "2025-01-01");
});

test("transfers between stores are not movements, so they don't reset age", () => {
  // Received at the warehouse, later moved to a store: only the receipt is a movement.
  const r = stockCycleStart([m("2025-04-01", "stock_in", 12, "WH")], 12, d("2025-03-15"));
  assert.equal(iso(r.start), "2025-04-01");
});

test("stock from before history (2020): falls back to created date, flagged estimated", () => {
  const r = stockCycleStart([], 3, d("2020-01-04"));
  assert.equal(iso(r.start), "2020-01-04");
  assert.equal(r.estimated, true);
});

test("old style sold out in 2024 and restocked: exact age from the restock", () => {
  const r = stockCycleStart([m("2024-03-01", "sold", 3), m("2024-05-01", "stock_in", 4)], 4, d("2020-01-04"));
  assert.equal(iso(r.start), "2024-05-01");
  assert.equal(r.estimated, false);
});

test("out of stock: no age", () => {
  assert.equal(stockCycleStart([m("2025-01-01", "initial", 2), m("2025-01-05", "sold", 2)], 0, d("2025-01-01")).start, null);
});

test("aging buckets", () => {
  assert.equal(agingBucket(30, true, false), "0-30");
  assert.equal(agingBucket(91, true, false), "91-180");
  assert.equal(agingBucket(400, true, false), "180+");
  assert.equal(agingBucket(null, true, true), "pre-release");
  assert.equal(agingBucket(null, false, false), "no-stock");
});
