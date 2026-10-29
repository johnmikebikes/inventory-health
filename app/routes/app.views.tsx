import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Saved views: save (personal or shared), delete your own, set or clear your default.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { sessionToken } = await authenticate.admin(request);
  const userId = sessionToken?.sub ? String(sessionToken.sub) : null;
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "save") {
    const name = String(form.get("name") ?? "").trim().slice(0, 60);
    if (!name) return { ok: false };
    const shared = form.get("shared") === "1" || !userId;
    const view = await prisma.savedView.create({
      data: { name, filters: String(form.get("filters") ?? "{}"), ownerUserId: shared ? null : userId },
    });
    return { ok: true, id: view.id };
  }
  if (intent === "delete") {
    const id = String(form.get("id"));
    await prisma.savedView.deleteMany({ where: { id, isSystem: false, ownerUserId: userId } });
    if (userId) await prisma.userPreference.updateMany({ where: { userId, defaultViewId: id }, data: { defaultViewId: null } });
    return { ok: true };
  }
  if (intent === "default" && userId) {
    const id = String(form.get("id") ?? "") || null;
    await prisma.userPreference.upsert({ where: { userId }, create: { userId, defaultViewId: id }, update: { defaultViewId: id } });
    return { ok: true };
  }
  return { ok: false };
};
