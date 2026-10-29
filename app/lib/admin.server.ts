// Minimal shape of the Admin GraphQL client we use, so sync code works from
// both request handlers (authenticate.admin) and background jobs (unauthenticated.admin).
export type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

/**
 * An Admin client for long background jobs. Every call loads the shop's stored
 * (offline) session, refreshing the token when Shopify has expired it, instead
 * of reusing the short-lived token from the request that started the job.
 */
export function adminForShop(shop: string): AdminClient {
  return {
    graphql: async (query, options) => {
      const { unauthenticated } = await import("../shopify.server");
      const { admin } = await unauthenticated.admin(shop);
      return admin.graphql(query, options as any);
    },
  };
}

/** Turns a thrown Response (how the Shopify library reports auth/HTTP failures) into a readable Error. */
export async function readableError(e: unknown): Promise<Error> {
  if (e instanceof Response) {
    let body = "";
    try { body = (await e.text()).slice(0, 300); } catch { /* ignore */ }
    return new Error(`Shopify request failed: HTTP ${e.status}${e.headers.get("location") ? ` (redirect to ${e.headers.get("location")})` : ""} ${body}`.trim());
  }
  return e instanceof Error ? e : new Error(String(e));
}

export async function gql<T = any>(
  admin: AdminClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  let res: Response;
  try {
    res = await admin.graphql(query, variables ? { variables } : undefined);
  } catch (e) {
    throw await readableError(e);
  }
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors) throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
  if (!json.data) throw new Error("GraphQL returned no data");
  return json.data;
}

export const toCents = (amount: string | number | null | undefined): number | null => {
  if (amount === null || amount === undefined || amount === "") return null;
  const n = typeof amount === "number" ? amount : Number(amount);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

export const legacyId = (gid: string) => gid.split("/").pop() ?? gid;
