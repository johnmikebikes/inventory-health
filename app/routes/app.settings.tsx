import { useEffect, useRef } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getSettings, saveSettings, type HealthSettings } from "../lib/settings.server";
import { computeMetrics } from "../lib/metrics.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const [settings, locations] = await Promise.all([
    getSettings(),
    prisma.location.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);
  return { settings, locations: locations.map((l) => ({ id: l.id, name: l.name, sellable: l.countsAsSellable })) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const form = await request.formData();
  const n = (k: string, min: number, max: number, fallback: number) => {
    const v = Number(form.get(k));
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  };
  const current = await getSettings();
  const locations = await prisma.location.findMany();
  const sellableIds = new Set(String(form.get("sellable") ?? "").split(",").filter(Boolean));
  const patch: Partial<HealthSettings> = {
    deadStockDays: n("deadStockDays", 14, 365, current.deadStockDays),
    deadStockMinAgeDays: n("deadStockMinAgeDays", 0, 365, current.deadStockMinAgeDays),
    lowStockWeeks: n("lowStockWeeks", 0.5, 26, current.lowStockWeeks),
    stockoutMinSold28: n("stockoutMinSold28", 1, 100, current.stockoutMinSold28),
    brokenRunThreshold: n("brokenRunThreshold", 10, 100, current.brokenRunThreshold * 100) / 100,
    brokenRunMinSizes: n("brokenRunMinSizes", 2, 20, current.brokenRunMinSizes),
    excludeTag: String(form.get("excludeTag") ?? current.excludeTag).trim() || current.excludeTag,
    nonSellableLocationNames: locations.filter((l) => !sellableIds.has(l.id)).map((l) => l.name),
  };
  const saved = await saveSettings(patch);
  for (const l of locations) {
    await prisma.location.update({ where: { id: l.id }, data: { countsAsSellable: sellableIds.has(l.id) } });
  }
  // Recalculate with the new rules (no Shopify calls needed).
  computeMetrics(new Date(), saved).catch((e) => console.error("Recompute failed", e));
  return { ok: true };
};

const FIELDS: { key: keyof HealthSettings; label: string; help: string; suffix?: string; step?: number }[] = [
  { key: "deadStockDays", label: "Dead stock: no sales in", suffix: "days", help: "A style is dead stock when it hasn't sold in this many days…" },
  { key: "deadStockMinAgeDays", label: "…and is older than", suffix: "days", help: "…so brand-new arrivals aren't flagged." },
  { key: "lowStockWeeks", label: "Low stock: under", suffix: "weeks of supply", step: 0.5, help: "Based on the last 28 days of sales." },
  { key: "stockoutMinSold28", label: "Stockout: sold at least", suffix: "in 28 days", help: "Out-of-stock sizes only count if they were still selling." },
  { key: "brokenRunThreshold", label: "Broken run: under", suffix: "% of sizes in stock", help: "Share of a style's sizes that must be in stock." },
  { key: "brokenRunMinSizes", label: "Only judge runs with at least", suffix: "sizes", help: "Skips one-size items like hats and socks." },
];

export default function Settings() {
  const { settings, locations } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) shopify.toast.show("Saved. Recalculating…");
  }, [fetcher.state, fetcher.data, shopify]);

  const save = () => {
    const root = box.current;
    if (!root) return;
    const data: Record<string, string> = {};
    root.querySelectorAll<HTMLElement & { value: string }>("[data-setting]").forEach((el) => {
      data[el.dataset.setting!] = String(el.value);
    });
    const sellable: string[] = [];
    root.querySelectorAll<HTMLElement & { checked: boolean }>("[data-location]").forEach((el) => {
      if (el.checked) sellable.push(el.dataset.location!);
    });
    data.sellable = sellable.join(",");
    fetcher.submit(data, { method: "POST" });
  };

  const valueOf = (k: keyof HealthSettings) =>
    k === "brokenRunThreshold" ? String(Math.round(settings.brokenRunThreshold * 100)) : String(settings[k]);

  return (
    <s-page heading="Settings">
      <div ref={box}>
        <s-section heading="Thresholds">
          <s-stack direction="block" gap="base">
            {FIELDS.map((f) => (
              <s-number-field
                key={f.key}
                data-setting={f.key}
                label={f.label}
                suffix={f.suffix}
                details={f.help}
                step={f.step ?? 1}
                defaultValue={valueOf(f.key)}
              />
            ))}
            <s-text-field data-setting="excludeTag" label="Hide products tagged" details="Use for display pairs, consignment, and anything that shouldn't count." defaultValue={settings.excludeTag} />
          </s-stack>
        </s-section>
        <s-section heading="Locations that count as sellable">
          <s-stack direction="block" gap="small-200">
            <s-text color="subdued">Unchecked locations still have their own view, but stay out of the “All sellable locations” totals.</s-text>
            {locations.map((l) => (
              <s-checkbox key={l.id} data-location={l.id} label={l.name} defaultChecked={l.sellable} />
            ))}
          </s-stack>
        </s-section>
        <s-section>
          <s-button variant="primary" onClick={save} {...(fetcher.state !== "idle" ? { loading: true } : {})}>
            Save settings
          </s-button>
        </s-section>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
