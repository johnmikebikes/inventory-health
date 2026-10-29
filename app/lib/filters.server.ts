import prisma from "../db.server";
import { cached } from "./cache.server";
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
    // Filter options only change with the catalog, so they're cached until the next recalculation.
    cached("filter-options", async () => {
      const [locations, vendorRows, typeRows] = await Promise.all([
        prisma.location.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
        prisma.product.findMany({ distinct: ["vendor"], select: { vendor: true }, orderBy: { vendor: "asc" } }),
        prisma.product.findMany({ distinct: ["productType"], select: { productType: true }, orderBy: { productType: "asc" } }),
      ]);
      return { locations, vendorRows, typeRows };
    }),
  ]);

  const hasExplicit = ["view", "location", "vendor", "type", "archived"].some((k) => p.has(k));
  const viewId = p.get("view") ?? (hasExplicit ? null : pref?.defaultViewId ?? null);
  const view = views.find((v) => v.id === viewId) ?? null;
  const base: ViewFilters = parseFilters(view?.filters);

  const filters: Filters = {
    locationId: p.get("location") ?? base.locationId ?? "ALL",
    vendor: p.has("vendor") ? p.get("vendor") || null : base.vendors?.[0] ?? null,
    productType: p.has("type") ? p.get("type") || null : base.productTypes?.[0] ?? null,
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
