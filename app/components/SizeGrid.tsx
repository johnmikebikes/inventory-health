/** In-stock sizes are filled, sold-out sizes are outlined. Placeholder sizes (never stocked, no SKU) are hidden. */
export function SizeGrid({ cells }: { cells: { size: string; available: number; sold90: number; expected: boolean }[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {cells
        .filter((c) => c.expected)
        .map((c, i) => {
          const inStock = c.available > 0;
          return (
            <span
              key={`${c.size}-${i}`}
              title={`${c.size}: ${c.available} available · ${c.sold90} sold in 90 days`}
              style={{
                minWidth: 34, textAlign: "center", padding: "2px 6px", borderRadius: 6, fontSize: 12, lineHeight: "18px",
                background: inStock ? "#1c5cab" : "transparent",
                color: inStock ? "#fff" : "#616161",
                border: inStock ? "1px solid #1c5cab" : "1px dashed #b5b4ae",
                textDecoration: inStock ? "none" : "line-through",
              }}
            >
              {c.size}
              {inStock ? <sup style={{ marginLeft: 2, fontSize: 9 }}>{c.available}</sup> : null}
            </span>
          );
        })}
    </div>
  );
}
