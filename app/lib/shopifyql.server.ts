import { gql, type AdminClient } from "./admin.server";

const QUERY = `#graphql
  query RunShopifyQL($q: String!) {
    shopifyqlQuery(query: $q) {
      parseErrors
      tableData { columns { name dataType } rows }
    }
  }`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PACE_MS = 750; // gap between ShopifyQL calls, so a backfill doesn't trip the rate limit
let lastCall = 0;

const isRateLimit = (e: unknown) => /rate limit|throttl|429/i.test(String((e as any)?.message ?? e));

/** Runs ShopifyQL and returns rows as objects keyed by column name. Paces calls and retries when throttled. */
export async function shopifyql(
  admin: AdminClient,
  q: string,
): Promise<Record<string, string | number | null>[]> {
  let data: any;
  for (let attempt = 0; ; attempt++) {
    const wait = lastCall + PACE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    try {
      data = await gql<any>(admin, QUERY, { q });
      break;
    } catch (e) {
      if (!isRateLimit(e) || attempt >= 7) throw e;
      await sleep(Math.min(60_000, 2000 * 2 ** attempt)); // 2s, 4s, 8s ... up to 60s
    }
  }
  const r = data.shopifyqlQuery;
  if (r.parseErrors?.length) throw new Error(`ShopifyQL error: ${r.parseErrors.join("; ")}\n${q}`);
  const cols: string[] = (r.tableData?.columns ?? []).map((c: any) => c.name);
  const rows: unknown[] = r.tableData?.rows ?? [];
  return rows.map((row) => {
    if (Array.isArray(row)) return Object.fromEntries(cols.map((c, i) => [c, row[i] as any]));
    return row as Record<string, any>;
  });
}
