import { useMemo, useState, type ReactNode } from "react";
import type { ProductRow } from "../lib/types";
import { adminProductUrl, BUCKET_LABEL, money, num, pct, weeks } from "../lib/format";

export type ColKey =
  | "onHand" | "costCents" | "retailCents" | "sold30" | "sold90" | "sellThrough30" | "sellThrough90"
  | "weeksOfSupply" | "ageDays" | "sizes" | "stockoutVariants" | "lowStockVariants";

type Row = ProductRow; // serialized from the loader (same shape)

const COLS: Record<ColKey, { label: string; value: (r: Row) => number | null; render: (r: Row) => ReactNode; csv: (r: Row) => string }> = {
  onHand: { label: "On hand", value: (r) => r.onHand, render: (r) => num(r.onHand), csv: (r) => String(r.onHand) },
  costCents: { label: "Cost value", value: (r) => r.costCents, render: (r) => money(r.costCents), csv: (r) => (r.costCents / 100).toFixed(2) },
  retailCents: { label: "Retail value", value: (r) => r.retailCents, render: (r) => money(r.retailCents), csv: (r) => (r.retailCents / 100).toFixed(2) },
  sold30: { label: "Sold 30d", value: (r) => r.sold30, render: (r) => num(r.sold30), csv: (r) => String(r.sold30) },
  sold90: { label: "Sold 90d", value: (r) => r.sold90, render: (r) => num(r.sold90), csv: (r) => String(r.sold90) },
  sellThrough30: { label: "Sell-thru 30d", value: (r) => r.sellThrough30, render: (r) => pct(r.sellThrough30), csv: (r) => pct(r.sellThrough30) },
  sellThrough90: { label: "Sell-thru 90d", value: (r) => r.sellThrough90, render: (r) => pct(r.sellThrough90), csv: (r) => pct(r.sellThrough90) },
  weeksOfSupply: { label: "Weeks of supply", value: (r) => r.weeksOfSupply ?? (r.onHand > 0 ? 9999 : null), render: (r) => (r.weeksOfSupply === null && r.onHand > 0 ? "No sales" : weeks(r.weeksOfSupply)), csv: (r) => (r.weeksOfSupply === null ? "" : r.weeksOfSupply.toFixed(1)) },
  ageDays: {
    label: "Age (days)",
    value: (r) => r.ageDays,
    render: (r) => (r.bucket === "pre-release" ? "Pre-release" : r.ageDays === null ? "—" : `${r.ageEstimated ? "~" : ""}${num(r.ageDays)}`),
    csv: (r) => (r.ageDays === null ? "" : String(r.ageDays)),
  },
  sizes: {
    label: "Sizes in stock",
    value: (r) => (r.expectedSizes ? r.inStockSizes / r.expectedSizes : null),
    render: (r) => (r.expectedSizes ? `${r.inStockSizes} of ${r.expectedSizes}` : "—"),
    csv: (r) => (r.expectedSizes ? `${r.inStockSizes}/${r.expectedSizes}` : ""),
  },
  stockoutVariants: { label: "Sizes out", value: (r) => r.stockoutVariants, render: (r) => num(r.stockoutVariants), csv: (r) => String(r.stockoutVariants) },
  lowStockVariants: { label: "Sizes low", value: (r) => r.lowStockVariants, render: (r) => num(r.lowStockVariants), csv: (r) => String(r.lowStockVariants) },
};

const PAGE = 50;

function Flags({ r }: { r: Row }) {
  return (
    <s-stack direction="inline" gap="small-300">
      {r.isDead ? <s-badge tone="critical">Dead stock</s-badge> : null}
      {r.ageDays !== null && r.ageDays > 90 && !r.isDead ? <s-badge tone="warning">Aged</s-badge> : null}
      {r.brokenRun ? <s-badge tone="warning">Broken run</s-badge> : null}
      {r.stockoutVariants > 0 ? <s-badge tone="info">{`${r.stockoutVariants} out`}</s-badge> : null}
      {r.status !== "ACTIVE" ? <s-badge>{r.status === "DRAFT" ? "Draft" : "Archived"}</s-badge> : null}
      {r.missingCost ? <s-badge tone="warning">No cost</s-badge> : null}
    </s-stack>
  );
}

function downloadCsv(name: string, rows: Row[], cols: ColKey[]) {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const header = ["Product", "Brand", "Type", "Status", "Age bucket", ...cols.map((c) => COLS[c].label)];
  const lines = rows.map((r) =>
    [r.title, r.vendor, r.productType, r.status, BUCKET_LABEL[r.bucket] ?? r.bucket, ...cols.map((c) => COLS[c].csv(r))].map(esc).join(","),
  );
  const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function ProductTable({
  rows, cols, defaultSort, defaultDir = "desc", csvName, selectable = false, actions, empty = "Nothing here for these filters.",
}: {
  rows: Row[];
  cols: ColKey[];
  defaultSort: ColKey;
  defaultDir?: "asc" | "desc";
  csvName: string;
  selectable?: boolean;
  actions?: (selected: Row[]) => ReactNode;
  empty?: string;
}) {
  const [sort, setSort] = useState<ColKey>(defaultSort);
  const [dir, setDir] = useState<"asc" | "desc">(defaultDir);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const sorted = useMemo(() => {
    const v = COLS[sort].value;
    return [...rows].sort((a, b) => {
      const x = v(a), y = v(b);
      if (x === null && y === null) return 0;
      if (x === null) return 1; // blanks last
      if (y === null) return -1;
      return dir === "asc" ? x - y : y - x;
    });
  }, [rows, sort, dir]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const shown = sorted.slice(page * PAGE, page * PAGE + PAGE);
  const toggleSort = (c: ColKey) => {
    if (c === sort) setDir(dir === "asc" ? "desc" : "asc");
    else { setSort(c); setDir("desc"); }
    setPage(0);
  };
  const allOnPage = shown.length > 0 && shown.every((r) => selected.has(r.id));
  const selectedRows = sorted.filter((r) => selected.has(r.id));

  return (
    <s-stack direction="block" gap="base">
      <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
        <s-text color="subdued">
          {num(rows.length)} styles{selectable && selected.size ? ` · ${selected.size} selected` : ""}
        </s-text>
        <s-stack direction="inline" gap="small-200">
          {actions ? actions(selectedRows) : null}
          <s-button icon="export" onClick={() => downloadCsv(csvName, sorted, cols)} {...(rows.length ? {} : { disabled: true })}>
            Export CSV
          </s-button>
        </s-stack>
      </s-stack>

      {rows.length === 0 ? (
        <s-box padding="large-200"><s-text color="subdued">{empty}</s-text></s-box>
      ) : (
        <s-table>
          <s-table-header-row>
            {selectable ? (
              <s-table-header>
                <input
                  type="checkbox"
                  aria-label="Select page"
                  checked={allOnPage}
                  onChange={() => {
                    const next = new Set(selected);
                    shown.forEach((r) => (allOnPage ? next.delete(r.id) : next.add(r.id)));
                    setSelected(next);
                  }}
                />
              </s-table-header>
            ) : null}
            <s-table-header listSlot="primary">Style</s-table-header>
            {cols.map((c) => (
              <s-table-header key={c} format="numeric">
                <button
                  type="button"
                  onClick={() => toggleSort(c)}
                  style={{ all: "unset", cursor: "pointer", fontWeight: sort === c ? 650 : 450, whiteSpace: "nowrap" }}
                >
                  {COLS[c].label}
                  {sort === c ? (dir === "desc" ? " ↓" : " ↑") : ""}
                </button>
              </s-table-header>
            ))}
          </s-table-header-row>
          <s-table-body>
            {shown.map((r) => (
              <s-table-row key={r.id}>
                {selectable ? (
                  <s-table-cell>
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.title}`}
                      checked={selected.has(r.id)}
                      onChange={() => {
                        const next = new Set(selected);
                        next.has(r.id) ? next.delete(r.id) : next.add(r.id);
                        setSelected(next);
                      }}
                    />
                  </s-table-cell>
                ) : null}
                <s-table-cell>
                  <s-stack direction="block" gap="small-300">
                    <s-link href={adminProductUrl(r.id)} target="_blank">{r.title}</s-link>
                    <s-text color="subdued">{[r.vendor, r.productType].filter(Boolean).join(" · ")}</s-text>
                    <Flags r={r} />
                  </s-stack>
                </s-table-cell>
                {cols.map((c) => (
                  <s-table-cell key={c}>{COLS[c].render(r)}</s-table-cell>
                ))}
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      )}

      {pages > 1 ? (
        <s-stack direction="inline" gap="base" alignItems="center" justifyContent="center">
          <s-button variant="tertiary" icon="chevron-left" onClick={() => setPage(Math.max(0, page - 1))} {...(page === 0 ? { disabled: true } : {})}>
            Previous
          </s-button>
          <s-text color="subdued">Page {page + 1} of {pages}</s-text>
          <s-button variant="tertiary" icon="chevron-right" onClick={() => setPage(Math.min(pages - 1, page + 1))} {...(page >= pages - 1 ? { disabled: true } : {})}>
            Next
          </s-button>
        </s-stack>
      ) : null}
    </s-stack>
  );
}
