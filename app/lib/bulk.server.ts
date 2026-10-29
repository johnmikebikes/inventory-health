import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { gql, type AdminClient } from "./admin.server";

const RUN = `#graphql
  mutation RunBulk($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }`;

const STATUS = `#graphql
  query BulkStatus($id: ID!) {
    node(id: $id) {
      ... on BulkOperation { id status errorCode objectCount url partialDataUrl }
    }
  }`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs a bulk query and yields each JSONL object. Child objects (for example
 * inventory levels under a variant) arrive as separate lines with __parentId.
 */
export async function* runBulkQuery(
  admin: AdminClient,
  query: string,
  { pollMs = 5000, timeoutMs = 30 * 60 * 1000 } = {},
): AsyncGenerator<Record<string, any>> {
  const started = await gql<any>(admin, RUN, { query });
  const errs = started.bulkOperationRunQuery.userErrors;
  if (errs?.length) throw new Error(`Bulk start failed: ${JSON.stringify(errs)}`);
  const id: string = started.bulkOperationRunQuery.bulkOperation.id;

  const deadline = Date.now() + timeoutMs;
  let op: any;
  for (;;) {
    await sleep(pollMs);
    op = (await gql<any>(admin, STATUS, { id })).node;
    if (op.status === "COMPLETED") break;
    if (["FAILED", "CANCELED", "EXPIRED"].includes(op.status)) {
      throw new Error(`Bulk operation ${id} ${op.status}: ${op.errorCode ?? ""}`);
    }
    if (Date.now() > deadline) throw new Error(`Bulk operation ${id} timed out`);
  }
  if (!op.url) return; // completed with no results

  const res = await fetch(op.url);
  if (!res.ok || !res.body) throw new Error(`Bulk download failed: HTTP ${res.status}`);
  const lines = createInterface({ input: Readable.fromWeb(res.body as any), crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim()) yield JSON.parse(line);
  }
}
