import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { refreshInventoryItem } from "../lib/sync/catalog.server";

// Payload only carries "available", so we re-read every state for the item.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, admin } = await authenticate.webhook(request);
  if (admin && payload?.inventory_item_id) {
    await refreshInventoryItem(admin as any, `gid://shopify/InventoryItem/${payload.inventory_item_id}`).catch((e) =>
      console.error("inventory_levels/update failed", e),
    );
  }
  return new Response(null, { status: 200 });
};
