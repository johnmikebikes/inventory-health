import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { resolveContext } from "../lib/filters.server";
import { getProductRows } from "../lib/products.server";
import { getSettings } from "../lib/settings.server";
import { FilterBar, useFilterQuery } from "../components/FilterBar";
import { ProductTable } from "../components/ProductTable";
import { money, num } from "../lib/format";

type Tab = "aged" | "dead" | "all";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { sessionToken } = await authenticate.admin(request);
  const ctx = await resolveContext(request, sessionToken);
  const tab = (new URL(request.url).searchParams.get("flag") as Tab) || "aged";
  const [all, settings] = await Promise.all([getProductRows(ctx.filters), getSettings()]);
  const stocked = all.filter((r) => r.onHand > 0);
  const aged = stocked.filter((r) => r.ageDays !== null && r.ageDays > 90);
  const dead = stocked.filter((r) => r.isDead);
  const rows = tab === "dead" ? dead : tab === "all" ? stocked : aged;
  const sum = (xs: typeof rows) => xs.reduce((a, r) => a + r.costCents, 0);
  return {
    ctx, tab, rows,
    counts: { aged: aged.length, dead: dead.length, all: stocked.length },
    costs: { aged: sum(aged), dead: sum(dead), all: sum(stocked) },
    deadStockDays: settings.deadStockDays,
  };
};

export default function Aging() {
  const { ctx, tab, rows, counts, costs, deadStockDays } = useLoaderData<typeof loader>();
  const link = useFilterQuery();
  const tabs: { key: Tab; label: string }[] = [
    { key: "aged", label: `Aged 90+ days (${num(counts.aged)})` },
    { key: "dead", label: `Dead stock (${num(counts.dead)})` },
    { key: "all", label: `Everything in stock (${num(counts.all)})` },
  ];
  const blurb =
    tab === "dead"
      ? `No sales in ${deadStockDays} days and older than the minimum age. ${money(costs.dead)} at cost.`
      : tab === "aged"
        ? `Oldest units on hand are more than 90 days old. ${money(costs.aged)} at cost.`
        : `${money(costs.all)} at cost across all styles in stock.`;

  return (
    <s-page heading="Aging & dead stock" inlineSize="large">
      <FilterBar ctx={ctx} />
      <s-section>
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small-200">
            {tabs.map((t) => (
              <s-button key={t.key} variant={t.key === tab ? "secondary" : "tertiary"} href={link("/app/aging", { flag: t.key })}>
                {t.label}
              </s-button>
            ))}
          </s-stack>
          <s-text color="subdued">{blurb} “~” marks an estimated age (stock older than our 2024 history).</s-text>
          <ProductTable
            rows={rows}
            cols={["ageDays", "onHand", "costCents", "sold90", "sellThrough90", "weeksOfSupply", "sizes"]}
            defaultSort={tab === "all" ? "ageDays" : "costCents"}
            csvName={`aging-${tab}`}
            selectable
            actions={(selected) => (
              <s-button disabled icon="discount">
                {selected.length ? `Mark down ${selected.length} (Module 2)` : "Mark down (Module 2)"}
              </s-button>
            )}
            empty="Nothing aged for these filters. Nice."
          />
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
