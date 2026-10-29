import prisma from "../db.server";

export type SizeCell = { size: string; available: number; sold90: number; expected: boolean };

/** Size grid for a set of products at one location ("ALL" = sellable locations combined). */
export async function sizeGrids(productIds: string[], locationId: string) {
  if (!productIds.length) return {} as Record<string, SizeCell[]>;
  const sellable = new Set((await prisma.location.findMany({ where: { countsAsSellable: true } })).map((l) => l.id));
  const variants = await prisma.variant.findMany({
    where: { productId: { in: productIds }, tracked: true },
    orderBy: { position: "asc" },
    select: {
      id: true, productId: true, size: true, title: true, sku: true, barcode: true,
      levels: { select: { locationId: true, available: true, onHand: true } },
      metrics: { where: { locationId }, select: { sold90: true } },
      _count: { select: { movements: true } },
    },
  });
  const out: Record<string, SizeCell[]> = {};
  for (const v of variants) {
    const levels = locationId === "ALL" ? v.levels.filter((l) => sellable.has(l.locationId)) : v.levels.filter((l) => l.locationId === locationId);
    const available = levels.reduce((a, l) => a + Math.max(l.available, 0), 0);
    const expected = !!(v.sku || v.barcode || v._count.movements > 0 || v.levels.some((l) => l.onHand > 0));
    (out[v.productId] ??= []).push({ size: v.size ?? v.title, available, sold90: v.metrics[0]?.sold90 ?? 0, expected });
  }
  return out;
}
