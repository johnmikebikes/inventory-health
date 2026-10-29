import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { adminForShop } from "../lib/admin.server";
import prisma from "../db.server";
import { isSyncRunning, runFullSync } from "../lib/sync/run.server";

/**
 * Nightly trigger (GitHub Actions, see .github/workflows/nightly-sync.yml):
 *   POST /jobs/sync  -> starts a sync, returns 202
 *   GET  /jobs/sync  -> {"running": true|false, "last": {...}}; polling it also keeps a free host awake
 * Both need:  Authorization: Bearer $JOB_TOKEN
 */
const authorized = (request: Request) => {
  const token = process.env.JOB_TOKEN;
  return !!token && request.headers.get("authorization") === `Bearer ${token}`;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  const last = await prisma.syncRun.findFirst({ orderBy: { startedAt: "desc" } });
  return Response.json({
    running: await isSyncRunning(),
    last: last && { status: last.status, startedAt: last.startedAt, finishedAt: last.finishedAt, error: last.error?.split("\n")[0] ?? null,
      progress: last.status === "running" ? ((JSON.parse(last.stats ?? "{}") as { progress?: string }).progress ?? null) : null },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  const shop = process.env.SHOP_DOMAIN;
  if (!shop) return new Response("SHOP_DOMAIN not set", { status: 500 });
  runFullSync(adminForShop(shop)).catch((e) => console.error("Nightly sync failed", e));
  return new Response("Sync started", { status: 202 });
};
