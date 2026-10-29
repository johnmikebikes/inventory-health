// Pure aging logic (no database), so it can be unit-tested.

/** Inventory adjustment history in this store starts in 2024. */
export const HISTORY_START = "2024-01-01";
const historyStart = new Date(`${HISTORY_START}T00:00:00.000Z`);
const DAY = 86_400_000;

export type Movement = { locationId: string; date: Date; kind: string; qty: number };

export function agingBucket(ageDays: number | null, hasStock: boolean, preRelease: boolean): string {
  if (preRelease) return "pre-release";
  if (!hasStock || ageDays === null) return "no-stock";
  if (ageDays <= 30) return "0-30";
  if (ageDays <= 60) return "31-60";
  if (ageDays <= 90) return "61-90";
  if (ageDays <= 180) return "91-180";
  return "180+";
}

/**
 * When did the current stock arrive? Walks the variant's movements across all
 * locations (transfers are not movements, so they never reset age).
 *
 * The opening balance at the start of history is back-calculated from today's
 * on-hand. If stock existed before our history begins, the age falls back to
 * the variant's created date and is flagged as estimated.
 */
export function stockCycleStart(
  movements: Movement[],
  onHandNow: number,
  variantCreatedAt: Date,
): { start: Date | null; estimated: boolean } {
  const byDay = new Map<number, { inQty: number; outQty: number; received: boolean }>();
  let net = 0;
  for (const m of movements) {
    const t = m.date.getTime();
    const d = byDay.get(t) ?? { inQty: 0, outQty: 0, received: false };
    if (m.kind === "initial" || m.kind === "stock_in") d.received = true;
    if (m.kind === "initial" || m.kind === "stock_in" || m.kind === "returned") d.inQty += m.qty;
    if (m.kind === "sold") d.outQty += m.qty;
    byDay.set(t, d);
    net += (m.kind === "sold" ? -1 : 1) * m.qty;
  }
  const opening = onHandNow - net;

  let start: Date | null = null;
  let estimated = false;
  if (opening > 0) {
    // Stock on hand before (or outside) recorded movements.
    // Exact when the variant was created inside our history window, estimated otherwise.
    start = variantCreatedAt;
    estimated = variantCreatedAt < historyStart;
  }

  let balance = opening;
  const days = [...byDay.keys()].sort((a, b) => a - b);
  for (const t of days) {
    const d = byDay.get(t)!;
    if (d.received && balance <= 0) {
      start = new Date(t); // sold through earlier, so this receipt starts a new cycle
      estimated = false;
    }
    balance += d.inQty - d.outQty;
  }
  if (onHandNow <= 0) return { start: null, estimated: false };
  if (!start) return { start: variantCreatedAt, estimated: true };
  return { start, estimated };
}

