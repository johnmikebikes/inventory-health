import prisma from "../../db.server";
import type { AdminClient } from "../admin.server";
import { shopifyql } from "../shopifyql.server";

import { HISTORY_START } from "../aging";

export { HISTORY_START };
const ROW_LIMIT = 5000;
const DAY = 86_400_000;

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const parseDay = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00.000Z`);

type Kind = "initial" | "stock_in" | "sold" | "returned";

/** Maps one ShopifyQL row to a movement, or null if it isn't one we track. */
function classify(reason: string, state: string, change: number): { kind: Kind; qty: number } | null {
  if (reason === "initial_adjustment" && state === "available" && change > 0) return { kind: "initial", qty: change };
  if (reason === "correction" && state === "available" && change > 0) return { kind: "stock_in", qty: change };
  if (reason === "order_fulfilled" && state === "committed" && change < 0) return { kind: "sold", qty: -change };
  if (reason === "restock" && state === "available" && change > 0) return { kind: "returned", qty: change };
  return null;
}

function query(since: string, until: string) {
  return `FROM inventory_adjustment_history
    SHOW inventory_adjustment_change
    WHERE inventory_change_reason IN ('initial_adjustment', 'correction', 'order_fulfilled', 'restock')
      AND inventory_state IN ('available', 'committed')
    GROUP BY day, product_variant_id, inventory_location_name, inventory_change_reason, inventory_state
    SINCE ${since} UNTIL ${until}
    ORDER BY day
    LIMIT ${ROW_LIMIT}`;
}

async function fetchWindow(admin: AdminClient, since: Date, until: Date): Promise<Record<string, string | number | null>[]> {
  const rows = await shopifyql(admin, query(ymd(since), ymd(until)));
  if (rows.length < ROW_LIMIT) return rows;
  // Hit the cap: split the window so nothing is dropped.
  if (ymd(since) === ymd(until)) throw new Error(`More than ${ROW_LIMIT} adjustment rows on ${ymd(since)}`);
  const mid = new Date(Math.floor((since.getTime() + until.getTime()) / 2 / DAY) * DAY);
  const left = await fetchWindow(admin, since, mid);
  const right = await fetchWindow(admin, addDays(mid, 1), until);
  return [...left, ...right];
}

/**
 * Re-pulls movements for [since, until] (inclusive) and replaces what we had for those days.
 * Nightly runs re-pull the last 7 days to catch late edits; the first run backfills from 2024.
 */
export async function syncMovements(admin: AdminClient, since: Date, until: Date, onProgress?: (label: string) => unknown) {
  const variants = new Map(
    (await prisma.variant.findMany({ select: { id: true, legacyId: true } })).map((v) => [v.legacyId, v.id]),
  );
  const locations = new Map((await prisma.location.findMany()).map((l) => [l.name, l.id]));
  let written = 0;
  let skipped = 0;

  for (let start = since; start <= until; start = addDays(start, 7)) {
    const end = new Date(Math.min(addDays(start, 6).getTime(), until.getTime()));
    await onProgress?.(start.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }));
    const rows = await fetchWindow(admin, start, end);

    const merged = new Map<string, { variantId: string; locationId: string; date: Date; kind: Kind; qty: number }>();
    for (const r of rows) {
      const m = classify(String(r.inventory_change_reason), String(r.inventory_state), Number(r.inventory_adjustment_change));
      const variantId = variants.get(String(r.product_variant_id));
      const locationId = locations.get(String(r.inventory_location_name));
      if (!m || !variantId || !locationId) { skipped++; continue; }
      const date = parseDay(String(r.day));
      const key = `${variantId}|${locationId}|${date.toISOString()}|${m.kind}`;
      const prev = merged.get(key);
      if (prev) prev.qty += m.qty;
      else merged.set(key, { variantId, locationId, date, kind: m.kind, qty: m.qty });
    }

    await prisma.$transaction([
      prisma.inventoryMovementDaily.deleteMany({ where: { date: { gte: start, lte: end } } }),
      prisma.inventoryMovementDaily.createMany({ data: [...merged.values()] }),
    ]);
    written += merged.size;
  }
  return { movements: written, movementRowsSkipped: skipped };
}

/** Decides the window: full backfill on first run, otherwise the last 7 days. */
export async function movementWindow(today = new Date()) {
  const until = parseDay(ymd(today));
  const any = await prisma.inventoryMovementDaily.findFirst({ select: { date: true } });
  const since = any ? addDays(until, -7) : parseDay(HISTORY_START);
  return { since, until };
}
