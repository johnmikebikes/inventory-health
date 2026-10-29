// Formatting shared by server and browser code.
import { BUCKETS } from "./buckets";

export { BUCKETS };

export const BUCKET_LABEL: Record<string, string> = {
  "0-30": "0–30 days",
  "31-60": "31–60",
  "61-90": "61–90",
  "91-180": "91–180",
  "180+": "180+",
  "pre-release": "Pre-release",
};

// Ordinal blue ramp (validated): young stock light, older stock darker. Pre-release is neutral.
export const BUCKET_COLOR: Record<string, string> = {
  "0-30": "#86b6ef",
  "31-60": "#5598e7",
  "61-90": "#2a78d6",
  "91-180": "#1c5cab",
  "180+": "#104281",
  "pre-release": "#b5b4ae",
};

export const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const moneyCompact = (cents: number) => {
  const d = cents / 100;
  if (Math.abs(d) >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (Math.abs(d) >= 10_000) return `$${Math.round(d / 1000)}K`;
  if (Math.abs(d) >= 1_000) return `$${(d / 1000).toFixed(1)}K`;
  return `$${Math.round(d)}`;
};

export const pct = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `${Math.round(x * 100)}%`);
export const num = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-US"));
export const weeks = (w: number | null | undefined) =>
  w === null || w === undefined ? "—" : w >= 52 ? "52+" : w < 1 ? "<1" : w.toFixed(1);

export const legacyFromGid = (gid: string) => gid.split("/").pop() ?? gid;
/** Opens the product in the Shopify admin (App Bridge admin link). */
export const adminProductUrl = (gid: string) => `shopify://admin/products/${legacyFromGid(gid)}`;
