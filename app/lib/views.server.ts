import prisma from "../db.server";

export type ViewFilters = {
  locationId?: string; // Location.id or "ALL"
  vendors?: string[];
  productTypes?: string[];
  tags?: string[];
  statuses?: string[]; // defaults to ACTIVE + DRAFT
};

export const DEFAULT_STATUSES = ["ACTIVE", "DRAFT"];

/** One shared view per location, named exactly as the location is named in Shopify. */
export async function ensureLocationViews() {
  const locations = await prisma.location.findMany({ where: { isActive: true } });
  for (const l of locations) {
    const filters = JSON.stringify({ locationId: l.id } satisfies ViewFilters);
    await prisma.savedView.upsert({
      where: { locationId: l.id },
      create: { name: l.name, filters, isSystem: true, locationId: l.id },
      update: { name: l.name, filters },
    });
  }
}

export async function listViews(userId: string | null) {
  return prisma.savedView.findMany({
    where: { OR: [{ ownerUserId: null }, ...(userId ? [{ ownerUserId: userId }] : [])] },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
  });
}

export function parseFilters(json: string | null | undefined): ViewFilters {
  try {
    return json ? (JSON.parse(json) as ViewFilters) : {};
  } catch {
    return {};
  }
}
