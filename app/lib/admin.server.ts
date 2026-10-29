// Minimal shape of the Admin GraphQL client we use, so sync code works from
// both request handlers (authenticate.admin) and background jobs (unauthenticated.admin).
export type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export async function gql<T = any>(
  admin: AdminClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await admin.graphql(query, variables ? { variables } : undefined);
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
