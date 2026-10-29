// Shapes shared by server loaders and browser components.

/** One row per product (style); age = age of its oldest stock on hand. */
export type ProductRow = {
  id: string;
  title: string;
  vendor: string;
  productType: string;
  status: string;
  onHand: number;
  available: number;
  costCents: number;
  retailCents: number;
  sold30: number;
  sold90: number;
  sellThrough30: number | null;
  sellThrough90: number | null;
  weeksOfSupply: number | null;
  ageDays: number | null;
  ageEstimated: boolean;
  bucket: string;
  isDead: boolean;
  stockoutVariants: number;
  lowStockVariants: number;
  brokenRun: boolean;
  expectedSizes: number;
  inStockSizes: number;
  missingCost: boolean;
};

export type Flag = "dead" | "aged" | "stockout" | "low" | "broken" | "missingcost";
