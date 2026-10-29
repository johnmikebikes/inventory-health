import { useCallback, useRef, useState } from "react";
import { useFetcher, useLocation, useNavigate } from "react-router";
import { useWcEvent } from "../lib/useWcEvent";

type View = { id: string; name: string; isSystem: boolean; mine: boolean; shared: boolean };
type Ctx = {
  filters: { locationId: string; vendor: string | null; productType: string | null; includeArchived: boolean };
  activeViewId: string | null;
  defaultViewId: string | null;
  views: View[];
  options: { locations: { id: string; name: string }[]; vendors: string[]; productTypes: string[] };
};

const SCREENS = [
  { href: "/app", label: "Overview" },
  { href: "/app/aging", label: "Aging & dead stock" },
  { href: "/app/sizes", label: "Size runs" },
  { href: "/app/stockouts", label: "Stockouts" },
  { href: "/app/products", label: "All styles" },
];

/** Keeps the current filters (and view) when moving between screens. */
export function useFilterQuery() {
  const { search } = useLocation();
  const p = new URLSearchParams(search);
  const keep = new URLSearchParams();
  for (const k of ["view", "location", "vendor", "type", "archived"]) {
    const v = p.get(k);
    if (v !== null) keep.set(k, v);
  }
  return (path: string, extra: Record<string, string | null> = {}) => {
    const q = new URLSearchParams(keep);
    for (const [k, v] of Object.entries(extra)) (v === null ? q.delete(k) : q.set(k, v));
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
}

export function FilterBar({ ctx }: { ctx: Ctx }) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const link = useFilterQuery();
  const fetcher = useFetcher();
  const [saving, setSaving] = useState(false);
  const f = ctx.filters;

  // Changing a filter keeps you on this screen; drill-down params (flag, bucket) are dropped.
  const setParam = useCallback(
    (key: string, value: string | null) => {
      const q = new URLSearchParams(search);
      q.delete("flag");
      q.delete("bucket");
      q.delete("view");
      // Carry the other filters from the active view so only this one changes.
      q.set("location", f.locationId);
      if (f.vendor) q.set("vendor", f.vendor); else q.delete("vendor");
      if (f.productType) q.set("type", f.productType); else q.delete("type");
      q.set("archived", f.includeArchived ? "1" : "0");
      if (value === null || value === "") q.set(key, key === "location" ? "ALL" : ""); else q.set(key, value);
      navigate(`${pathname}?${q.toString()}`);
    },
    [search, pathname, navigate, f],
  );

  const locRef = useRef<HTMLElementTagNameMap["s-select"]>(null);
  const vendorRef = useRef<HTMLElementTagNameMap["s-select"]>(null);
  const typeRef = useRef<HTMLElementTagNameMap["s-select"]>(null);
  const archRef = useRef<HTMLElementTagNameMap["s-checkbox"]>(null);
  const nameRef = useRef<HTMLElementTagNameMap["s-text-field"]>(null);
  const sharedRef = useRef<HTMLElementTagNameMap["s-checkbox"]>(null);
  useWcEvent(locRef, "change", useCallback((el: HTMLElementTagNameMap["s-select"]) => setParam("location", el.value), [setParam]));
  useWcEvent(vendorRef, "change", useCallback((el: HTMLElementTagNameMap["s-select"]) => setParam("vendor", el.value), [setParam]));
  useWcEvent(typeRef, "change", useCallback((el: HTMLElementTagNameMap["s-select"]) => setParam("type", el.value), [setParam]));
  useWcEvent(archRef, "change", useCallback((el: HTMLElementTagNameMap["s-checkbox"]) => setParam("archived", el.checked ? "1" : "0"), [setParam]));

  const active = ctx.views.find((v) => v.id === ctx.activeViewId) ?? null;
  const saveView = () => {
    const name = String(nameRef.current?.value ?? "").trim();
    if (!name) return;
    fetcher.submit(
      { intent: "save", name, shared: sharedRef.current?.checked ? "1" : "0", filters: JSON.stringify({
        locationId: f.locationId, vendors: f.vendor ? [f.vendor] : [], productTypes: f.productType ? [f.productType] : [],
        statuses: f.includeArchived ? ["ACTIVE", "DRAFT", "ARCHIVED"] : ["ACTIVE", "DRAFT"],
      }) },
      { method: "POST", action: "/app/views" },
    );
    setSaving(false);
  };

  return (
    <s-section padding="base">
      <s-stack direction="block" gap="base">
        {/* Screens */}
        <s-stack direction="inline" gap="small-200">
          {SCREENS.map((s) => (
            <s-button key={s.href} href={link(s.href)} variant={pathname === s.href ? "primary" : "tertiary"}>
              {s.label}
            </s-button>
          ))}
        </s-stack>

        <s-divider />

        {/* Saved views */}
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-text color="subdued">Views</s-text>
          <s-button
            variant={!active && f.locationId === "ALL" && !f.vendor && !f.productType ? "secondary" : "tertiary"}
            href={`${pathname}?location=ALL&archived=0`}
          >
            All locations
          </s-button>
          {ctx.views.map((v) => (
            <s-button key={v.id} variant={v.id === ctx.activeViewId ? "secondary" : "tertiary"} href={`${pathname}?view=${v.id}`}>
              {v.name}
              {v.id === ctx.defaultViewId ? " ★" : ""}
            </s-button>
          ))}
          <s-button variant="tertiary" icon="plus" onClick={() => setSaving((x) => !x)}>Save view</s-button>
          {active ? (
            <s-button
              variant="tertiary"
              onClick={() =>
                fetcher.submit(
                  { intent: "default", id: ctx.defaultViewId === active.id ? "" : active.id },
                  { method: "POST", action: "/app/views" },
                )
              }
            >
              {ctx.defaultViewId === active.id ? "Unset my default" : "Make my default"}
            </s-button>
          ) : null}
          {active?.mine ? (
            <s-button
              variant="tertiary"
              tone="critical"
              onClick={() => fetcher.submit({ intent: "delete", id: active.id }, { method: "POST", action: "/app/views" })}
            >
              Delete view
            </s-button>
          ) : null}
        </s-stack>

        {saving ? (
          <s-stack direction="inline" gap="base" alignItems="end">
            <s-text-field ref={nameRef} label="View name" placeholder="e.g. Indy footwear" />
            <s-checkbox ref={sharedRef} label="Share with everyone" />
            <s-button variant="primary" onClick={saveView}>Save</s-button>
            <s-button variant="tertiary" onClick={() => setSaving(false)}>Cancel</s-button>
          </s-stack>
        ) : null}

        {/* Filters */}
        <s-grid gridTemplateColumns="repeat(4, minmax(0, 1fr))" gap="base" alignItems="end">
          <s-select ref={locRef} label="Location" value={f.locationId}>
            <s-option value="ALL">All sellable locations</s-option>
            {ctx.options.locations.map((l) => (
              <s-option key={l.id} value={l.id}>{l.name}</s-option>
            ))}
          </s-select>
          <s-select ref={vendorRef} label="Brand" value={f.vendor ?? ""}>
            <s-option value="">All brands</s-option>
            {ctx.options.vendors.map((v) => (
              <s-option key={v} value={v}>{v}</s-option>
            ))}
          </s-select>
          <s-select ref={typeRef} label="Product type" value={f.productType ?? ""}>
            <s-option value="">All types</s-option>
            {ctx.options.productTypes.map((t) => (
              <s-option key={t} value={t}>{t}</s-option>
            ))}
          </s-select>
          <s-checkbox ref={archRef} label="Include archived" checked={f.includeArchived} />
        </s-grid>
      </s-stack>
    </s-section>
  );
}
