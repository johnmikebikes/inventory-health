import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { resolveContext } from "../lib/filters.server";
import { applyDrilldown, getProductRows } from "../lib/products.server";
import { FilterBar, useFilterQuery } from "../components/FilterBar";
import { ProductTable } from "../components/ProductTable";
import { BUCKET_LABEL, money } from "../lib/format";

const FLAG_LABEL: Record<string, string> = {
  dead: "Dead stock",
  aged: "Aged 90+ days",
  stockout: "Styles with stockouts",
  low: "Styles with low stock",
  broken: "Broken size runs",
  missingcost: "In stock without a cost",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { sessionToken } = await authenticate.admin(request);
  const ctx = await resolveContext(request, sessionToken);
  const q = new URL(request.url).searchParams;
  const rows = applyDrilldown(await getProductRows(ctx.filters), q);
  return { ctx, rows, flag: q.get("flag"), bucket: q.get("bucket") };
};

export default function Products() {
  const { ctx, rows, flag, bucket } = useLoaderData<typeof loader>();
  const link = useFilterQuery();
  const scope = [flag ? FLAG_LABEL[flag] : null, bucket ? `Age ${BUCKET_LABEL[bucket] ?? bucket}` : null].filter(Boolean).join(" · ");
  const cost = rows.reduce((a, r) => a + r.costCents, 0);

  return (
    <s-page heading={scope ? `Styles: ${scope}` : "All styles"} inlineSize="large">
      <FilterBar ctx={ctx} />
      <s-section>
        <s-stack direction="block" gap="base">
          {scope ? (
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text>{`${scope} · ${money(cost)} at cost`}</s-text>
              <s-button variant="tertiary" href={link("/app/products")}>Clear</s-button>
            </s-stack>
          ) : null}
          <ProductTable
            rows={rows}
            cols={["ageDays", "onHand", "costCents", "sold30", "sold90", "sellThrough90", "weeksOfSupply", "sizes"]}
            defaultSort="costCents"
            csvName={`styles${flag ? `-${flag}` : ""}${bucket ? `-age-${bucket}` : ""}`}
          />
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
