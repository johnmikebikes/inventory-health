import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { resolveContext } from "../lib/filters.server";
import { getProductRows } from "../lib/products.server";
import { sizeGrids } from "../lib/sizes.server";
import { getSettings } from "../lib/settings.server";
import { FilterBar } from "../components/FilterBar";
import { SizeGrid } from "../components/SizeGrid";
import { ProductTable } from "../components/ProductTable";
import { adminProductUrl, money, num, pct } from "../lib/format";

const SHOW = 100;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { sessionToken } = await authenticate.admin(request);
  const ctx = await resolveContext(request, sessionToken);
  const [all, settings] = await Promise.all([getProductRows(ctx.filters), getSettings()]);
  const broken = all.filter((r) => r.brokenRun).sort((a, b) => b.costCents - a.costCents);
  const top = broken.slice(0, SHOW);
  const grids = await sizeGrids(top.map((r) => r.id), ctx.filters.locationId);
  return { ctx, broken, top, grids, threshold: settings.brokenRunThreshold };
};

export default function Sizes() {
  const { ctx, broken, top, grids, threshold } = useLoaderData<typeof loader>();
  const cost = broken.reduce((a, r) => a + r.costCents, 0);
  return (
    <s-page heading="Size runs" inlineSize="large">
      <FilterBar ctx={ctx} />
      <s-section heading={`${num(broken.length)} broken runs · ${money(cost)} at cost`}>
        <s-stack direction="block" gap="base">
          <s-text color="subdued">
            {`A run is broken when fewer than ${pct(threshold)} of a style's sizes are in stock. Filled sizes are in stock (small number = units); outlined sizes are sold out.`}
          </s-text>
          {top.length === 0 ? (
            <s-text color="subdued">No broken runs for these filters.</s-text>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Style</s-table-header>
                <s-table-header>Sizes</s-table-header>
                <s-table-header format="numeric">In stock</s-table-header>
                <s-table-header format="numeric">Cost value</s-table-header>
                <s-table-header format="numeric">Sold 90d</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {top.map((r) => (
                  <s-table-row key={r.id}>
                    <s-table-cell>
                      <s-stack direction="block" gap="small-300">
                        <s-link href={adminProductUrl(r.id)} target="_blank">{r.title}</s-link>
                        <s-text color="subdued">{r.vendor}</s-text>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell><SizeGrid cells={grids[r.id] ?? []} /></s-table-cell>
                    <s-table-cell>{`${r.inStockSizes} of ${r.expectedSizes}`}</s-table-cell>
                    <s-table-cell>{money(r.costCents)}</s-table-cell>
                    <s-table-cell>{num(r.sold90)}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
          {broken.length > SHOW ? <s-text color="subdued">{`Showing the top ${SHOW} by cost value. Export below for all ${broken.length}.`}</s-text> : null}
        </s-stack>
      </s-section>
      {broken.length > 0 ? (
        <s-section heading="All broken runs">
          <ProductTable rows={broken} cols={["sizes", "onHand", "costCents", "sold90", "sellThrough90", "ageDays"]} defaultSort="costCents" csvName="broken-size-runs" />
        </s-section>
      ) : null}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
