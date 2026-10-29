import prisma from "../db.server";
import { getSettings, type HealthSettings } from "./settings.server";
import { agingBucket, stockCycleStart, type Movement } from "./aging";

const DAY = 86_400_000;
const ALL = "ALL";

const sumSold = (ms: Movement[], since: number) =>
  Math.max(
    0,
    ms.reduce((acc, m) => {
      if (m.date.getTime() < since) return acc;
      if (m.kind === "sold") return acc + m.qty;
      if (m.kind === "returned") return acc - m.qty;
      return acc;
    }, 0),
  );

const sellThrough = (sold: number, onHand: number) => {
  const denom = sold + Math.max(onHand, 0);
  return denom > 0 ? sold / denom : null;
};

export async function computeMetrics(
  now = new Date(),
  settingsIn?: HealthSettings,
) {
  const settings = settingsIn ?? (await getSettings());
  const today = new Date(Math.floor(now.getTime() / DAY) * DAY);
  const since = (days: number) => today.getTime() - (days - 1) * DAY;

  const locations = await prisma.location.findMany();
  const sellable = new Set(
    locations.filter((l) => l.countsAsSellable).map((l) => l.id),
  );

  let variantRows: any[] = [];
  let productRows: any[] = [];
  const snapshot = new Map<string, any>();
  let variantCount = 0;
  let productCount = 0;
  const chunks = <T>(xs: T[], n = 1000) =>
    Array.from({ length: Math.ceil(xs.length / n) }, (_, i) =>
      xs.slice(i * n, i * n + n),
    );

  // Rebuild the computed tables page by page so memory stays flat.
  await prisma.$transaction([
    prisma.variantMetric.deleteMany({}),
    prisma.productMetric.deleteMany({}),
  ]);

  // Styles are processed in pages so memory stays small on a 512 MB host.
  const PAGE = 250;
  let cursor: string | undefined;
  for (;;) {
    const products = await prisma.product.findMany({
      where: { isGiftCard: false },
      orderBy: { id: "asc" },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      include: {
        variants: {
          where: { tracked: true },
          include: { levels: true, movements: true },
        },
      },
    });
    if (!products.length) break;
    cursor = products[products.length - 1].id;

    for (const p of products) {
      const tags: string[] = JSON.parse(p.tags || "[]");
      if (tags.includes(settings.excludeTag)) continue;
      const preRelease = !p.publishedAt;
      const hasSizes = p.variants.some((v) => v.size);

      // Size-run bookkeeping
      const expected = new Set<string>();
      const inStockByLoc = new Map<string, Set<string>>();
      const onHandByLoc = new Map<string, number>();
      const costByLoc = new Map<string, number>();

      for (const v of p.variants) {
        const levels = v.levels;
        const onHandAll = levels
          .filter((l) => sellable.has(l.locationId))
          .reduce((a, l) => a + l.onHand, 0);
        const availAll = levels
          .filter((l) => sellable.has(l.locationId))
          .reduce((a, l) => a + l.available, 0);

        const { start, estimated } = stockCycleStart(
          v.movements,
          onHandAll,
          v.createdAt,
        );
        let ageStart = start;
        if (ageStart && p.publishedAt && p.publishedAt > ageStart)
          ageStart = p.publishedAt; // drafts age from publish
        const ageDays =
          preRelease || !ageStart
            ? null
            : Math.max(
                0,
                Math.floor((today.getTime() - ageStart.getTime()) / DAY),
              );

        // A size counts toward the run if it has a SKU/UPC, any stock or sales history, or stock now.
        const everStocked =
          v.movements.length > 0 || levels.some((l) => l.onHand > 0);
        if (hasSizes && (v.sku || v.barcode || everStocked)) expected.add(v.id);

        const scopes: {
          locationId: string;
          onHand: number;
          available: number;
          ms: Movement[];
        }[] = [
          {
            locationId: ALL,
            onHand: onHandAll,
            available: availAll,
            ms: v.movements,
          },
          ...levels.map((l) => ({
            locationId: l.locationId,
            onHand: l.onHand,
            available: l.available,
            ms: v.movements.filter((m) => m.locationId === l.locationId),
          })),
        ];

        for (const s of scopes) {
          const sold28 = sumSold(s.ms, since(28));
          const sold30 = sumSold(s.ms, since(30));
          const sold60 = sumSold(s.ms, since(60));
          const sold90 = sumSold(s.ms, since(90));
          const soldDead = sumSold(s.ms, since(settings.deadStockDays));
          if (s.onHand === 0 && s.available === 0 && sold90 === 0) continue; // nothing to report

          const units = Math.max(s.onHand, 0);
          const costCents = units * (v.unitCostCents ?? 0);
          const retailCents = units * v.priceCents;
          const weeksOfSupply = sold28 > 0 ? s.available / (sold28 / 4) : null;
          const bucket = agingBucket(
            ageDays,
            units > 0,
            preRelease && units > 0,
          );
          const isDead =
            units > 0 &&
            soldDead === 0 &&
            ageDays !== null &&
            ageDays > settings.deadStockMinAgeDays;

          variantRows.push({
            variantId: v.id,
            locationId: s.locationId,
            onHand: s.onHand,
            available: s.available,
            costCents,
            retailCents,
            sold28,
            sold30,
            sold60,
            sold90,
            soldDeadWindow: soldDead,
            sellThrough30: sellThrough(sold30, s.onHand),
            sellThrough60: sellThrough(sold60, s.onHand),
            sellThrough90: sellThrough(sold90, s.onHand),
            weeksOfSupply,
            stockCycleStart: units > 0 ? ageStart : null,
            ageDays: units > 0 ? ageDays : null,
            ageEstimated: units > 0 ? estimated : false,
            agingBucket: bucket,
            isDead,
            isStockout:
              s.available <= 0 && sold28 >= settings.stockoutMinSold28,
            isLowStock:
              s.available > 0 &&
              weeksOfSupply !== null &&
              weeksOfSupply < settings.lowStockWeeks,
            computedAt: now,
          });

          if (s.available > 0) {
            const set = inStockByLoc.get(s.locationId) ?? new Set<string>();
            set.add(v.id);
            inStockByLoc.set(s.locationId, set);
          }
          onHandByLoc.set(
            s.locationId,
            (onHandByLoc.get(s.locationId) ?? 0) + s.onHand,
          );
          costByLoc.set(
            s.locationId,
            (costByLoc.get(s.locationId) ?? 0) + costCents,
          );

          // Daily rollup for trend charts
          const key = `${s.locationId}|${p.vendor}|${p.productType}`;
          const snap = snapshot.get(key) ?? {
            date: today,
            locationId: s.locationId,
            vendor: p.vendor,
            productType: p.productType,
            onHand: 0,
            costCents: 0,
            retailCents: 0,
            agedCostCents: 0,
            deadCostCents: 0,
          };
          snap.onHand += units;
          snap.costCents += costCents;
          snap.retailCents += retailCents;
          if (ageDays !== null && ageDays > 90) snap.agedCostCents += costCents;
          if (isDead) snap.deadCostCents += costCents;
          snapshot.set(key, snap);
        }
      }

      for (const [locationId, onHand] of onHandByLoc) {
        const inStock = [...(inStockByLoc.get(locationId) ?? [])].filter((id) =>
          expected.has(id),
        ).length;
        const hasUnits = onHand > 0;
        productRows.push({
          productId: p.id,
          locationId,
          expectedSizes: expected.size,
          inStockSizes: inStock,
          brokenRun:
            hasSizes &&
            hasUnits &&
            expected.size >= settings.brokenRunMinSizes &&
            inStock / expected.size < settings.brokenRunThreshold,
          onHand,
          costCents: costByLoc.get(locationId) ?? 0,
          computedAt: now,
        });
      }
    }

    for (const data of chunks(variantRows))
      await prisma.variantMetric.createMany({ data });
    for (const data of chunks(productRows))
      await prisma.productMetric.createMany({ data });
    variantCount += variantRows.length;
    productCount += productRows.length;
    variantRows = [];
    productRows = [];
    if (products.length < PAGE) break;
  }

  await prisma.dailySnapshot.deleteMany({ where: { date: today } });
  for (const data of chunks([...snapshot.values()]))
    await prisma.dailySnapshot.createMany({ data });

  return {
    variantMetrics: variantCount,
    productMetrics: productCount,
    snapshotRows: snapshot.size,
  };
}
