import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { resolveContext } from "../lib/filters.server";
import { getProductRows, summarize } from "../lib/products.server";
import { getDataQuality } from "../lib/overview.server";
import { getSettings } from "../lib/settings.server";
import { isSyncRunning, runFullSync } from "../lib/sync/run.server";
import { adminForShop } from "../lib/admin.server";
import { FilterBar, useFilterQuery } from "../components/FilterBar";
import { Kpi } from "../components/Kpi";
import { AgeChart } from "../components/AgeChart";
import { money, moneyCompact, num, pct } from "../lib/format";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { sessionToken } = await authenticate.admin(request);
  const ctx = await resolveContext(request, sessionToken);
  const [rows, quality, lastRun, running, settings] = await Promise.all([
    getProductRows(ctx.filters),
    getDataQuality(),
    prisma.syncRun.findFirst({ orderBy: { startedAt: "desc" } }),
    isSyncRunning(),
    getSettings(),
  ]);
  return {
    ctx,
    summary: summarize(rows),
    quality,
    lowStockWeeks: settings.lowStockWeeks,
    deadStockDays: settings.deadStockDays,
    lastRun: lastRun && {
      status: lastRun.status,
      at: (lastRun.finishedAt ?? lastRun.startedAt).toISOString(),
      error: lastRun.error?.split("\n")[0] ?? null,
      progress: lastRun.status === "running" ? ((JSON.parse(lastRun.stats ?? "{}") as { progress?: string }).progress ?? null) : null,
    },
    running,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  // Background job: use a client that refreshes the stored token itself.
  runFullSync(adminForShop(session.shop)).catch((e) => console.error("Sync failed", e)); // runs in the background
  return { started: true };
};

export default function Overview() {
  const { ctx, summary, quality, lastRun, running, lowStockWeeks, deadStockDays } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const link = useFilterQuery();
  const k = summary.kpis;
  const syncing = running || fetcher.state !== "idle";

  // While a sync runs, refresh every 5 seconds (this also keeps a sleeping host awake).
  useEffect(() => {
    if (!syncing) return;
    const t = setInterval(() => revalidator.revalidate(), 5000);
    return () => clearInterval(t);
  }, [syncing, revalidator]);

  return (
    <s-page heading="Inventory health" inlineSize="large">
      <FilterBar ctx={ctx} />

      <s-section>
        <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
          <s-text color="subdued">
            {syncing
              ? `Sync running${lastRun?.progress ? ` · ${lastRun.progress}` : "…"} · keep this page open`
              : lastRun
                ? `Last sync ${lastRun.status}, ${new Date(lastRun.at).toLocaleString()}`
                : "Never synced"}
          </s-text>
          <s-button variant="primary" onClick={() => fetcher.submit({}, { method: "POST" })} {...(syncing ? { loading: true } : {})}>
            Sync now
          </s-button>
        </s-stack>
      </s-section>

      {!lastRun ? (
        <s-banner tone="info" heading="No data yet">
          Click Sync now. The first sync reads inventory history back to 2024 and takes about 10–15 minutes.
        </s-banner>
      ) : lastRun.status === "failed" && !syncing ? (
        <s-banner tone="critical" heading="Last sync failed">{lastRun.error}</s-banner>
      ) : null}

      <s-section heading="At a glance">
        <s-grid gridTemplateColumns="repeat(4, minmax(0, 1fr))" gap="base">
          <Kpi label="Inventory at cost" value={moneyCompact(k.costCents)} sub={`${num(k.units)} units`} href={link("/app/products")} />
          <Kpi label="Inventory at retail" value={moneyCompact(k.retailCents)} sub={k.retailCents ? `${pct(1 - k.costCents / k.retailCents)} margin at full price` : undefined} href={link("/app/products")} />
          <Kpi label="Sell-through, 90 days" value={pct(k.sellThrough90)} sub="units sold ÷ (sold + on hand)" href={link("/app/products")} />
          <Kpi label="Aged 90+ days" value={pct(k.agedShare)} sub={`${moneyCompact(k.agedCostCents)} at cost`} href={link("/app/aging", { flag: "aged" })} tone={k.agedShare !== null && k.agedShare > 0.3 ? "warning" : undefined} />
          <Kpi label="Dead stock" value={moneyCompact(k.deadCostCents)} sub={`no sales in ${deadStockDays} days`} href={link("/app/aging", { flag: "dead" })} />
          <Kpi label="Stockouts" value={num(k.stockouts)} sub="sizes out, still selling" href={link("/app/stockouts", { kind: "out" })} />
          <Kpi label="Low stock" value={num(k.lowStock)} sub={`sizes under ${lowStockWeeks} weeks of supply`} href={link("/app/stockouts", { kind: "low" })} />
          <Kpi label="Broken size runs" value={num(k.brokenRuns)} sub="styles with under half their sizes" href={link("/app/sizes")} />
        </s-grid>
      </s-section>

      <s-section heading="Cost value by age of oldest stock">
        <s-paragraph>
          <s-text color="subdued">Each style counts once, aged by its oldest units on hand. Click a bar to see the styles.</s-text>
        </s-paragraph>
        <AgeChart byBucket={summary.byBucket} linkFor={(b) => link("/app/products", { bucket: b })} />
      </s-section>

      <s-section heading="Top brands by cost value">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Brand</s-table-header>
            <s-table-header format="numeric">Styles</s-table-header>
            <s-table-header format="numeric">Units</s-table-header>
            <s-table-header format="numeric">Cost value</s-table-header>
            <s-table-header format="numeric">Sell-thru 90d</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {summary.topVendors.map((v) => (
              <s-table-row key={v.vendor}>
                <s-table-cell>
                  <s-link href={link("/app/products", { vendor: v.vendor, view: null, location: ctx.filters.locationId })}>
                    {v.vendor || "(no brand)"}
                  </s-link>
                </s-table-cell>
                <s-table-cell>{num(v.styles)}</s-table-cell>
                <s-table-cell>{num(v.units)}</s-table-cell>
                <s-table-cell>{money(v.cost)}</s-table-cell>
                <s-table-cell>{pct(v.sellThrough90)}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      <s-section heading="Data quality">
        <s-stack direction="inline" gap="large">
          <s-link href={link("/app/products", { flag: "missingcost" })}>{`${num(quality.inStockMissingCost)} in stock without a cost`}</s-link>
          <s-text color="subdued">{`${num(quality.negativeOnHandLevels)} negative quantities (counted as 0)`}</s-text>
          <s-text color="subdued">{`${num(quality.untrackedVariantsExcluded)} untracked items left out`}</s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
