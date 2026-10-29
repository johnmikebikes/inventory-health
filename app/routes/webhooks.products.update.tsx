import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Keeps status, publish date, vendor, type and tags current between nightly syncs.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload } = await authenticate.webhook(request);
  const id = payload?.admin_graphql_api_id as string | undefined;
  if (id) {
    const tags = typeof payload.tags === "string" ? payload.tags.split(",").map((t: string) => t.trim()).filter(Boolean) : [];
    await prisma.product
      .update({
        where: { id },
        data: {
          title: payload.title,
          vendor: payload.vendor ?? "",
          productType: payload.product_type ?? "",
          status: String(payload.status ?? "").toUpperCase() || undefined,
          tags: JSON.stringify(tags),
          publishedAt: payload.published_at ? new Date(payload.published_at) : null,
          updatedAt: new Date(payload.updated_at ?? Date.now()),
        },
      })
      .catch(() => null); // new product: the nightly sync adds it
  }
  return new Response(null, { status: 200 });
};
