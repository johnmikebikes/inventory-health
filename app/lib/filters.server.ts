import prisma from "../db.server";
import { cached } from "./cache.server";
import { nameKey } from "./names";
import { DEFAULT_STATUSES, listViews, parseFilters, type ViewFilters } from "./views.server";

export type Filters = {
  locationId: string; // Location.id or "ALL"
  vendor: string | null;
  productType: string | null;
  includeArchived: boolean;
};

/**
 * Works out which filters apply to a screen: URL params win, then the chosen
 * saved view, then the user's default view, then "all locations".
 */
export async function resolveContext(request: Request, sessionToken: { sub?: unknown } | undefined) {
  const userId = sessionToken?.sub ? String(sessionToken.sub) : null;
  const url = new URL(request.url);
  const p = url.searchParams;

  const [views, pref, { locations, vendorRows, typeRows }] = await Promise.all([
    listViews(userId),
    userId ? prisma.userPreference.findUnique({ where: { userId } }) : null,
    // Filter options: grouped brand/type names that have stock or recent sales. Cached until the next recalculation.
    cached("filter-options", async () => {
      const [locations, styles] = await Promise.all([
        prisma.location.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
        prisma.styleRow.findMany({
          where: { locationId: "ALL", OR: [{ onHand: { gt: 0 } }, { sold90: { gt: 0 } }] },
          select: { vendor: true, productType: true },
        }),
      ]);
      const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b));
      return {
        locations,
        vendorRows: uniq(styles.map((r) => r.vendor)).map((vendor) => ({ vendor })),
        typeRows: uniq(styles.map((r) => r.productType)).map((productType) => ({ productType })),
      };
    }),
  ]);

  const hasExplicit = ["view", "location", "vendor", "type", "archived"].some((k) => p.has(k));
  const viewId = p.get("view") ?? (hasExplicit ? null : pref?.defaultViewId ?? null);
  const view = views.find((v) => v.id === viewId) ?? null;
  const base: ViewFilters = parseFilters(view?.filters);

  // Snap a saved/old spelling ("NIKE") to the grouped label shown in the dropdown ("Nike").
  const snap = (v: string | null, options: string[]) => (v ? options.find((o) => nameKey(o) === nameKey(v)) ?? v : null);

  const filters: Filters = {
    locationId: p.get("location") ?? base.locationId ?? "ALL",
    vendor: snap(p.has("vendor") ? p.get("vendor") || null : base.vendors?.[0] ?? null, vendorRows.map((r) => r.vendor)),
    productType: snap(p.has("type") ? p.get("type") || null : base.productTypes?.[0] ?? null, typeRows.map((r) => r.productType)),
    includeArchived: p.has("archived") ? p.get("archived") === "1" : !!base.statuses?.includes("ARCHIVED"),
  };

  return {
    userId,
    filters,
    activeViewId: view?.id ?? null,
    defaultViewId: pref?.defaultViewId ?? null,
    views: views.map((v) => ({
      id: v.id,
      name: v.name,
      isSystem: v.isSystem,
      mine: !!userId && v.ownerUserId === userId,
      shared: v.ownerUserId === null,
    })),
    options: {
      locations: locations.map((l) => ({ id: l.id, name: l.name, sellable: l.countsAsSellable })),
      vendors: vendorRows.map((r) => r.vendor).filter(Boolean),
      productTypes: typeRows.map((r) => r.productType).filter(Boolean),
    },
  };
}

export type Context = Awaited<ReturnType<typeof resolveContext>>;

export const statusesFor = (f: Filters) => (f.includeArchived ? [...DEFAULT_STATUSES, "ARCHIVED"] : DEFAULT_STATUSES);

/** Saved-view JSON for the current filters. */
export const filtersToView = (f: Filters): ViewFilters => ({
  locationId: f.locationId,
  vendors: f.vendor ? [f.vendor] : [],
  productTypes: f.productType ? [f.productType] : [],
  statuses: statusesFor(f),
});

/** Every raw spelling in the catalog that belongs to a grouped brand/type label (for database filters). */
export async function rawSpellings(field: "vendor" | "productType", label: string): Promise<string[]> {
  const all = await cached(`raw-${field}`, async () =>
    field === "vendor"
      ? (await prisma.product.findMany({ distinct: ["vendor"], select: { vendor: true } })).map((r) => r.vendor)
      : (await prisma.product.findMany({ distinct: ["productType"], select: { productType: true } })).map((r) => r.productType),
  );
  const k = nameKey(label);
  return all.filter((v) => nameKey(v) === k);
}
