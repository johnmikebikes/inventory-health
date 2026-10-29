import { useCallback, useRef, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { resolveContext, statusesFor } from "../lib/filters.server";
import { sizeGrids } from "../lib/sizes.server";
import { getSettings } from "../lib/settings.server";
import { FilterBar, useFilterQuery } from "../components/FilterBar";
import { SizeGrid } from "../components/SizeGrid";
import { useWcEvent } from "../lib/useWcEvent";
import { adminProductUrl, num, weeks } from "../lib/format";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { sessionToken } = await authenticate.admin(request);
  const ctx = await resolveContext(request, sessionToken);
  const kind = new URL(request.url).searchParams.get("kind") === "low" ? "low" : "out";
  const f = ctx.filters;
  const productWhere = {
    status: { in: statusesFor(f) },
    ...(f.vendor ? { vendor: f.vendor } : {}),
    ...(f.productType ? { productType: f.productType } : {}),
  };

  const [metrics, counts, watch, settings] = await Promise.all([
    prisma.variantMetric.findMany({
      where: { locationId: f.locationId, ...(kind === "low" ? { isLowStock: true } : { isStockout: true }), variant: { product: productWhere } },
      orderBy: { sold28: "desc" },
      take: 500,
      select: {
        available: true, sold28: true, weeksOfSupply: true,
        variant: { select: { id: true, size: true, title: true, product: { select: { id: true, title: true, vendor: true } } } },
      },
    }),
    Promise.all([
      prisma.variantMetric.count({ where: { locationId: f.locationId, isStockout: true, variant: { product: productWhere } } }),
      prisma.variantMetric.count({ where: { locationId: f.locationId, isLowStock: true, variant: { product: productWhere } } }),
    ]),
    prisma.watchlistItem.findMany({ orderBy: { addedAt: "asc" } }),
    getSettings(),
  ]);

  const watchProducts = await prisma.product.findMany({
    where: { id: { in: watch.map((w) => w.productId) } },
    select: { id: true, title: true, vendor: true },
  });
  const grids = await sizeGrids(watchProducts.map((p) => p.id), f.locationId);

  return {
    ctx, kind, settings: { lowStockWeeks: settings.lowStockWeeks, stockoutMinSold28: settings.stockoutMinSold28 },
    counts: { out: counts[0], low: counts[1] },
    rows: metrics.map((m) => ({
      key: m.variant.id, productId: m.variant.product.id, title: m.variant.product.title, vendor: m.variant.product.vendor,
      size: m.variant.size ?? m.variant.title, available: m.available, sold28: m.sold28, weeksOfSupply: m.weeksOfSupply,
    })),
    watch: watchProducts.map((p) => {
      const cells = (grids[p.id] ?? []).filter((c) => c.expected);
      return { ...p, cells, out: cells.filter((c) => c.available <= 0).length };
    }),
  };
};

function WatchlistSearch() {
  const search = useFetcher<{ results: { id: string; title: string; vendor: string }[] }>();
  const add = useFetcher();
  const ref = useRef<HTMLElementTagNameMap["s-search-field"]>(null);
  const [q, setQ] = useState("");
  const onInput = useCallback(
    (el: HTMLElementTagNameMap["s-search-field"]) => {
      setQ(el.value);
      if (el.value.trim().length >= 2) search.load(`/app/watchlist?q=${encodeURIComponent(el.value)}`);
    },
    [search],
  );
  useWcEvent(ref, "input", onInput);
  const results = q.trim().length >= 2 ? search.data?.results ?? [] : [];
  return (
    <s-stack direction="block" gap="small-200">
      <s-search-field ref={ref} label="Add a product to the watchlist" labelAccessibilityVisibility="exclusive" placeholder="Search by name or brand, e.g. Air Force 1 white" />
      {results.length ? (
        <s-box borderWidth="base" borderRadius="base" padding="small-200">
          <s-stack direction="block" gap="small-300">
            {results.map((r) => (
              <s-stack key={r.id} direction="inline" gap="base" alignItems="center" justifyContent="space-between">
                <s-text>{`${r.title} · ${r.vendor}`}</s-text>
                <s-button
                  variant="tertiary"
                  icon="plus"
                  onClick={() => add.submit({ intent: "add", productId: r.id }, { method: "POST", action: "/app/watchlist" })}
                >
                  Add
                </s-button>
              </s-stack>
            ))}
          </s-stack>
        </s-box>
      ) : null}
    </s-stack>
  );
}

export default function Stockouts() {
  const { ctx, kind, rows, counts, watch, settings } = useLoaderData<typeof loader>();
  const link = useFilterQuery();
  const remove = useFetcher();
  return (
    <s-page heading="Stockouts & low stock" inlineSize="large">
      <FilterBar ctx={ctx} />

      <s-section heading="Always in stock">
        <s-stack direction="block" gap="base">
          <s-text color="subdued">Core styles that should never run out. Outlined sizes are sold out at this location.</s-text>
          {watch.length === 0 ? <s-text color="subdued">No products yet. Search below to add your forever styles.</s-text> : null}
          {watch.map((p) => (
            <s-box key={p.id} padding="small-200" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="small-200">
                <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-link href={adminProductUrl(p.id)} target="_blank">{p.title}</s-link>
                    {p.out > 0 ? <s-badge tone="critical">{`${p.out} sizes out`}</s-badge> : <s-badge tone="success">Full run</s-badge>}
                  </s-stack>
                  <s-button
                    variant="tertiary"
                    tone="critical"
                    onClick={() => remove.submit({ intent: "remove", productId: p.id }, { method: "POST", action: "/app/watchlist" })}
                  >
                    Remove
                  </s-button>
                </s-stack>
                <SizeGrid cells={p.cells} />
              </s-stack>
            </s-box>
          ))}
          <WatchlistSearch />
        </s-stack>
      </s-section>

      <s-section heading={kind === "low" ? "Low stock" : "Out of stock, still selling"}>
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small-200">
            <s-button variant={kind === "out" ? "secondary" : "tertiary"} href={link("/app/stockouts", { kind: "out" })}>
              {`Out of stock (${num(counts.out)})`}
            </s-button>
            <s-button variant={kind === "low" ? "secondary" : "tertiary"} href={link("/app/stockouts", { kind: "low" })}>
              {`Low stock (${num(counts.low)})`}
            </s-button>
          </s-stack>
          <s-text color="subdued">
            {kind === "low"
              ? `Sizes with under ${settings.lowStockWeeks} weeks of supply at the last 28 days' pace.`
              : `Sizes at 0 available that sold at least ${settings.stockoutMinSold28} in the last 28 days.`}
          </s-text>
          {rows.length === 0 ? (
            <s-text color="subdued">Nothing here for these filters.</s-text>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Style</s-table-header>
                <s-table-header>Size</s-table-header>
                <s-table-header format="numeric">Available</s-table-header>
                <s-table-header format="numeric">Sold 28d</s-table-header>
                <s-table-header format="numeric">Weeks of supply</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {rows.map((r) => (
                  <s-table-row key={r.key}>
                    <s-table-cell>
                      <s-stack direction="block" gap="small-300">
                        <s-link href={adminProductUrl(r.productId)} target="_blank">{r.title}</s-link>
                        <s-text color="subdued">{r.vendor}</s-text>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>{r.size}</s-table-cell>
                    <s-table-cell>{num(Math.max(r.available, 0))}</s-table-cell>
                    <s-table-cell>{num(r.sold28)}</s-table-cell>
                    <s-table-cell>{kind === "low" ? weeks(r.weeksOfSupply) : "0"}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
