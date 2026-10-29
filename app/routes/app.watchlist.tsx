import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// GET ?q=  -> product search for the "Always in stock" watchlist
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().toLowerCase();
  if (q.length < 2) return { results: [] as { id: string; title: string; vendor: string }[] };
  // Filtered in code so it behaves the same on SQLite (dev) and Postgres (production).
  const products = await prisma.product.findMany({
    where: { status: { in: ["ACTIVE", "DRAFT"] } },
    select: { id: true, title: true, vendor: true },
  });
  const words = q.split(/\s+/);
  const results = products
    .filter((p) => words.every((w) => `${p.title} ${p.vendor}`.toLowerCase().includes(w)))
    .slice(0, 15);
  return { results };
};

// POST intent=add|remove, productId
export const action = async ({ request }: ActionFunctionArgs) => {
  const { sessionToken } = await authenticate.admin(request);
  const form = await request.formData();
  const productId = String(form.get("productId") ?? "");
  if (!productId) return { ok: false };
  if (form.get("intent") === "remove") {
    await prisma.watchlistItem.deleteMany({ where: { productId } });
  } else {
    await prisma.watchlistItem.upsert({
      where: { productId },
      create: { productId, addedBy: sessionToken?.sub ? String(sessionToken.sub) : null },
      update: {},
    });
  }
  return { ok: true };
};
