import prisma from "../db.server";

export type HealthSettings = {
  deadStockDays: number; // no sales in this many days...
  deadStockMinAgeDays: number; // ...and older than this = dead stock
  lowStockWeeks: number; // weeks of supply below this = low stock
  stockoutMinSold28: number; // out of stock and sold at least this many in 28 days = stockout
  brokenRunThreshold: number; // in-stock share of expected sizes below this = broken run
  brokenRunMinSizes: number; // only judge runs for products with at least this many sizes
  excludeTag: string; // products with this tag are hidden from health views
  nonSellableLocationNames: string[]; // left out of "ALL" totals
};

export const DEFAULT_SETTINGS: HealthSettings = {
  deadStockDays: 90,
  deadStockMinAgeDays: 60,
  lowStockWeeks: 2,
  stockoutMinSold28: 2,
  brokenRunThreshold: 0.5,
  brokenRunMinSizes: 3,
  excludeTag: "no-health",
  nonSellableLocationNames: ["Warehouse Returns"],
};

const KEY = "health";

export async function getSettings(): Promise<HealthSettings> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  if (!row) return DEFAULT_SETTINGS;
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(row.value) as Partial<HealthSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(patch: Partial<HealthSettings>): Promise<HealthSettings> {
  const next = { ...(await getSettings()), ...patch };
  await prisma.setting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: JSON.stringify(next) },
    update: { value: JSON.stringify(next) },
  });
  return next;
}
