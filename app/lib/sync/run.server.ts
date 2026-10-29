import prisma from "../../db.server";
import type { AdminClient } from "../admin.server";
import { computeMetrics } from "../metrics.server";
import { syncLocations, syncProducts, syncVariantsAndLevels } from "./catalog.server";
import { movementWindow, syncMovements } from "./movements.server";
import { ensureLocationViews } from "../views.server";

const STALE_MS = 2 * 60 * 60 * 1000;

export async function isSyncRunning() {
  const running = await prisma.syncRun.findFirst({
    where: { status: "running", startedAt: { gt: new Date(Date.now() - STALE_MS) } },
  });
  return !!running;
}

/** Full nightly sync: catalog + stock, movements, then metrics. Safe to call twice; the second call is skipped. */
export async function runFullSync(admin: AdminClient) {
  if (await isSyncRunning()) return { skipped: true };
  const run = await prisma.syncRun.create({ data: { kind: "full", status: "running" } });
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
    return { skipped: false, stats };
  } catch (e: any) {
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { status: "failed", finishedAt: new Date(), stats: JSON.stringify(stats), error: String(e?.stack ?? e) },
    });
    throw e;
  }
}
