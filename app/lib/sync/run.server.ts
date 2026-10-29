import prisma from "../../db.server";
import { readableError, type AdminClient } from "../admin.server";
import { computeMetrics } from "../metrics.server";
import { syncLocations, syncProducts, syncVariantsAndLevels } from "./catalog.server";
import { movementWindow, syncMovements } from "./movements.server";
import { ensureLocationViews } from "../views.server";

const STALE_MS = 2 * 60 * 60 * 1000;

// The sync this server process is running right now (if any). A "running" row
// in the database that isn't ours was cut off by a restart or redeploy.
let activeRunId: string | null = null;

export async function isSyncRunning() {
  const running = await prisma.syncRun.findMany({ where: { status: "running" } });
  let alive = false;
  for (const r of running) {
    if (r.id === activeRunId && r.startedAt.getTime() > Date.now() - STALE_MS) {
      alive = true;
    } else {
      await prisma.syncRun.update({
        where: { id: r.id },
        data: { status: "failed", finishedAt: new Date(), error: "Interrupted (the server restarted or redeployed). Click Sync now to run it again." },
      });
    }
  }
  return alive;
}

/** Full nightly sync: catalog + stock, movements, then metrics. Safe to call twice; the second call is skipped. */
export async function runFullSync(admin: AdminClient) {
  if (await isSyncRunning()) return { skipped: true };
  const run = await prisma.syncRun.create({ data: { kind: "full", status: "running" } });
  activeRunId = run.id;
  const stats: Record<string, unknown> = {};
  // Progress shown in the app's Sync bar, e.g. "Step 4 of 5: Inventory history, Mar 2025".
  let lastWrite = 0;
  const progress = async (step: number, label: string, force = false) => {
    stats.progress = `Step ${step} of 5: ${label}`;
    if (!force && Date.now() - lastWrite < 3000) return;
    lastWrite = Date.now();
    await prisma.syncRun.update({ where: { id: run.id }, data: { stats: JSON.stringify(stats) } }).catch(() => null);
  };
  try {
    const now = new Date();
    await progress(1, "Locations", true);
    stats.locations = await syncLocations(admin, now);
    await ensureLocationViews();
    await progress(2, "Products (Shopify is preparing the export)", true);
    Object.assign(stats, await syncProducts(admin, now, (n) => progress(2, `Products, ${n.toLocaleString("en-US")} so far`)));
    await progress(3, "Sizes and stock levels (Shopify is preparing the export)", true);
    Object.assign(stats, await syncVariantsAndLevels(admin, now, (n) => progress(3, `Sizes and stock levels, ${n.toLocaleString("en-US")} so far`)));
    const { since, until } = await movementWindow(now);
    stats.movementWindow = `${since.toISOString().slice(0, 10)}..${until.toISOString().slice(0, 10)}`;
    await progress(4, "Inventory history", true);
    Object.assign(stats, await syncMovements(admin, since, until, (label) => progress(4, `Inventory history, ${label}`)));
    await progress(5, "Calculating age, sell-through and size runs", true);
    Object.assign(stats, await computeMetrics(now));
    delete stats.progress;
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { status: "succeeded", finishedAt: new Date(), stats: JSON.stringify(stats) },
    });
    activeRunId = null;
    return { skipped: false, stats };
  } catch (raw: any) {
    const e: any = await readableError(raw);
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { status: "failed", finishedAt: new Date(), stats: JSON.stringify(stats), error: String(e?.stack ?? e) },
    });
    activeRunId = null;
    throw e;
  }
}
