import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalLabels, labelFor, nameKey } from "./names.ts";

test("case, spaces and punctuation variants group together", () => {
  assert.equal(nameKey("NIKE"), nameKey("nIke "));
  assert.equal(nameKey("KID'S CLOTHING"), nameKey("Kids Clothing"));
  assert.notEqual(nameKey("Adidas"), nameKey("Raf Simons Adidas"));
});

test("label = most-used spelling, ties prefer mixed case", () => {
  const labels = canonicalLabels(["NIKE", "NIKE", "Nike", "nike", "NIke", "Jordan", "JORDAN"]);
  assert.equal(labelFor(labels, "nike"), "NIKE"); // NIKE used twice
  assert.equal(labelFor(labels, "jordan"), "Jordan"); // tie -> mixed case
  assert.equal(labelFor(labels, "Unknown Brand "), "Unknown Brand");
});
