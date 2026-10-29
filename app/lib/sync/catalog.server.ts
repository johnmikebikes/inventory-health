import prisma from "../../db.server";
import { gql, toCents, type AdminClient } from "../admin.server";
import { runBulkQuery } from "../bulk.server";
import { getSettings } from "../settings.server";

const QUANTITY_NAMES = [
  "available", "committed", "incoming", "on_hand",
  "reserved", "damaged", "safety_stock", "quality_control",
] as const;

const PRODUCTS_BULK = `{
  products {
    edges { node {
      id title handle vendor productType status tags isGiftCard
      createdAt publishedAt updatedAt
    } }
  }
}`;

// productVariants -> inventoryLevels keeps us within the bulk nesting limit
// (products -> variants -> levels would be one level too deep).
const VARIANTS_BULK = `{
  productVariants {
    edges { node {
      id legacyResourceId title sku barcode position price compareAtPrice createdAt
      selectedOptions { name value }
      product { id }
      inventoryItem {
        id tracked unitCost { amount }
        inventoryLevels {
          edges { node {
            updatedAt
            location { id }
            quantities(names: ${JSON.stringify(QUANTITY_NAMES)}) { name quantity }
          } }
        }
      }
    } }
  }
}`;

const LOCATIONS = `#graphql
  query Locations { locations(first: 50, includeInactive: true) { nodes { id name isActive } } }`;

const BATCH = 500;

async function flush(ops: any[]) {
  if (ops.length) await prisma.$transaction(ops.splice(0, ops.length));
}

export async function syncLocations(admin: AdminClient, now = new Date()) {
  const settings = await getSettings();
  const data = await gql<any>(admin, LOCATIONS);
  for (const l of data.locations.nodes) {
    const countsAsSellable = !settings.nonSellableLocationNames.includes(l.name);
    await prisma.location.upsert({
      where: { id: l.id },
      create: { id: l.id, name: l.name, isActive: l.isActive, countsAsSellable, syncedAt: now },
      update: { name: l.name, isActive: l.isActive, countsAsSellable, syncedAt: now },
    });
  }
  return data.locations.nodes.length as number;
}

export async function syncProducts(admin: AdminClient, now = new Date()) {
  const ops: any[] = [];
  let n = 0;
  for await (const p of runBulkQuery(admin, PRODUCTS_BULK)) {
    const row = {
      title: p.title,
      handle: p.handle,
      vendor: p.vendor ?? "",
      productType: p.productType ?? "",
      status: p.status,
      tags: JSON.stringify(p.tags ?? []),
      isGiftCard: !!p.isGiftCard,
      createdAt: new Date(p.createdAt),
      publishedAt: p.publishedAt ? new Date(p.publishedAt) : null,
      updatedAt: new Date(p.updatedAt),
      syncedAt: now,
    };
    ops.push(prisma.product.upsert({ where: { id: p.id }, create: { id: p.id, ...row }, update: row }));
    n++;
    if (ops.length >= BATCH) await flush(ops);
  }
  await flush(ops);
  // Products deleted in Shopify since the last run (cascades to variants and levels).
  const removed = await prisma.product.deleteMany({ where: { syncedAt: { lt: now } } });
  return { products: n, productsRemoved: removed.count };
}

function quantitiesToRow(quantities: { name: string; quantity: number }[]) {
  const q = Object.fromEntries(quantities.map((x) => [x.name, x.quantity]));
  return {
    available: q.available ?? 0,
    committed: q.committed ?? 0,
    incoming: q.incoming ?? 0,
    onHand: q.on_hand ?? 0,
    reserved: q.reserved ?? 0,
    damaged: q.damaged ?? 0,
    safetyStock: q.safety_stock ?? 0,
    qualityControl: q.quality_control ?? 0,
  };
}

export async function syncVariantsAndLevels(admin: AdminClient, now = new Date()) {
  const knownProducts = new Set((await prisma.product.findMany({ select: { id: true } })).map((p) => p.id));
  const knownLocations = new Set((await prisma.location.findMany({ select: { id: true } })).map((l) => l.id));
  // Bulk JSONL lists each child line after its parent, so we remember which
  // inventory item belongs to which variant as variants stream past.
  const seenVariants = new Map<string, string>(); // variant id -> variant id (levels carry the variant as __parentId)
  const ops: any[] = [];
  let variants = 0;
  let levels = 0;

  for await (const obj of runBulkQuery(admin, VARIANTS_BULK)) {
    if (obj.__parentId === undefined) {
      // Variant line
      if (!knownProducts.has(obj.product?.id)) continue;
      const size = (obj.selectedOptions ?? []).find((o: any) => /size/i.test(o.name))?.value ?? null;
      const row = {
        legacyId: String(obj.legacyResourceId),
        productId: obj.product.id,
        inventoryItemId: obj.inventoryItem.id,
        title: obj.title,
        sku: obj.sku || null,
        barcode: obj.barcode || null,
        size,
        position: obj.position ?? 0,
        priceCents: toCents(obj.price) ?? 0,
        compareAtCents: toCents(obj.compareAtPrice),
        unitCostCents: toCents(obj.inventoryItem.unitCost?.amount),
        tracked: !!obj.inventoryItem.tracked,
        createdAt: new Date(obj.createdAt),
        syncedAt: now,
      };
      seenVariants.set(obj.id, obj.id);
      ops.push(prisma.variant.upsert({ where: { id: obj.id }, create: { id: obj.id, ...row }, update: row }));
      variants++;
    } else if (obj.location) {
      // InventoryLevel line; __parentId is the variant id
      const variantId = seenVariants.get(obj.__parentId);
      if (!variantId || !knownLocations.has(obj.location.id)) continue;
      const row = { ...quantitiesToRow(obj.quantities ?? []), updatedAt: new Date(obj.updatedAt), syncedAt: now };
      ops.push(
        prisma.inventoryLevel.upsert({
          where: { variantId_locationId: { variantId, locationId: obj.location.id } },
          create: { variantId, locationId: obj.location.id, ...row },
          update: row,
        }),
      );
      levels++;
    }
    if (ops.length >= BATCH) await flush(ops);
  }
  await flush(ops);
  const removedVariants = await prisma.variant.deleteMany({ where: { syncedAt: { lt: now } } });
  const removedLevels = await prisma.inventoryLevel.deleteMany({ where: { syncedAt: { lt: now } } });
  return { variants, levels, variantsRemoved: removedVariants.count, levelsRemoved: removedLevels.count };
}

/** Refreshes one inventory item's levels (used by the inventory_levels/update webhook). */
export async function refreshInventoryItem(admin: AdminClient, inventoryItemGid: string) {
  const data = await gql<any>(
    admin,
    `#graphql
    query OneItem($id: ID!) {
      inventoryItem(id: $id) {
        id tracked unitCost { amount }
        variant { id }
        inventoryLevels(first: 50) {
          nodes { updatedAt location { id } quantities(names: ${JSON.stringify(QUANTITY_NAMES)}) { name quantity } }
        }
      }
    }`,
    { id: inventoryItemGid },
  );
  const item = data.inventoryItem;
  if (!item?.variant?.id) return 0;
  const variant = await prisma.variant.findUnique({ where: { id: item.variant.id } });
  if (!variant) return 0; // new variant; the nightly sync will pick it up
  const now = new Date();
  await prisma.variant.update({
    where: { id: variant.id },
    data: { tracked: !!item.tracked, unitCostCents: toCents(item.unitCost?.amount) },
  });
  let n = 0;
  for (const lvl of item.inventoryLevels.nodes) {
    const loc = await prisma.location.findUnique({ where: { id: lvl.location.id } });
    if (!loc) continue;
    const row = { ...quantitiesToRow(lvl.quantities), updatedAt: new Date(lvl.updatedAt), syncedAt: now };
    await prisma.inventoryLevel.upsert({
      where: { variantId_locationId: { variantId: variant.id, locationId: loc.id } },
      create: { variantId: variant.id, locationId: loc.id, ...row },
      update: row,
    });
    n++;
  }
  return n;
}
