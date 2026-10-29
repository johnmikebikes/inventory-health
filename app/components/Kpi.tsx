export function Kpi({ label, value, sub, href, tone }: { label: string; value: string; sub?: string; href?: string; tone?: "warning" }) {
  const body = (
    <s-box padding="base" borderWidth="base" borderRadius="large-100" background="base">
      <s-stack direction="block" gap="small-300">
        <s-text color="subdued">{label}</s-text>
        <s-text type="strong">
          <span style={{ fontSize: 24, lineHeight: "32px", fontWeight: 650, color: tone === "warning" ? "#8a4b00" : undefined }}>
            {value}
          </span>
        </s-text>
        <s-text color="subdued">{sub ?? " "}</s-text>
      </s-stack>
    </s-box>
  );
  return href ? <s-clickable href={href} borderRadius="large-100">{body}</s-clickable> : body;
}
