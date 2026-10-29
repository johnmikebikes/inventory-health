import prisma from "../../db.server";
import type { AdminClient } from "../admin.server";
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
  try {
    const now = new Date();
    stats.locations = await syncLocations(admin, now);
    await ensureLocationViews();
    Object.assign(stats, await syncProducts(admin, now));
    Object.assign(stats, await syncVariantsAndLevels(admin, now));
    const { since, until } = await movementWindow(now);
    stats.movementWindow = `${since.toISOString().slice(0, 10)}..${until.toISOString().slice(0, 10)}`;
    Object.assign(stats, await syncMovements(admin, since, until));
    Object.assign(stats, await computeMetrics(now));
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { status: "succeeded", finishedAt: new Date(), stats: JSON.stringify(stats) },
    });
    activeRunId = null;
    return { skipped: false, stats };
  } catch (e: any) {
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { status: "failed", finishedAt: new Date(), stats: JSON.stringify(stats), error: String(e?.stack ?? e) },
    });
    activeRunId = null;
    throw e;
  }
}
