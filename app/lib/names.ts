// Groups brand / product-type spellings that only differ by case, spaces or
// punctuation ("NIKE", "Nike", "nike", "NIke" -> one brand; "KID'S CLOTHING" = "KIDS CLOTHING").

/** Comparison key: lowercase letters and digits only. */
export const nameKey = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Picks one display label per group: the spelling used by the most products.
 * Ties go to a mixed-case spelling ("Nike" over "NIKE"), then alphabetical.
 */
export function canonicalLabels(values: string[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const raw of values) {
    const v = raw.trim();
    if (!v) continue;
    const k = nameKey(v);
    const m = counts.get(k) ?? new Map<string, number>();
    m.set(v, (m.get(v) ?? 0) + 1);
    counts.set(k, m);
  }
  const mixed = (s: string) => (s !== s.toUpperCase() && s !== s.toLowerCase() ? 1 : 0);
  const out = new Map<string, string>();
  for (const [k, m] of counts) {
    const best = [...m.entries()].sort((a, b) => b[1] - a[1] || mixed(b[0]) - mixed(a[0]) || a[0].localeCompare(b[0]))[0][0];
    out.set(k, best);
  }
  return out;
}

/** Label for a raw value using a canonical map (falls back to the trimmed value). */
export const labelFor = (labels: Map<string, string>, raw: string | null | undefined) =>
  labels.get(nameKey(raw)) ?? (raw ?? "").trim();
