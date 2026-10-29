import { useState } from "react";
import { useNavigate } from "react-router";
import { BUCKETS, BUCKET_COLOR, BUCKET_LABEL, money, moneyCompact } from "../lib/format";

/** Cost value by age of oldest stock. Click a bar to see the styles in it. */
export function AgeChart({ byBucket, linkFor }: { byBucket: Record<string, number>; linkFor: (bucket: string) => string }) {
  const navigate = useNavigate();
  const [hover, setHover] = useState<string | null>(null);
  const W = 640, H = 250, padL = 8, padR = 8, top = 28, bottom = 44;
  const plotH = H - top - bottom;
  const max = Math.max(1, ...BUCKETS.map((b) => byBucket[b] ?? 0));
  const total = BUCKETS.reduce((a, b) => a + (byBucket[b] ?? 0), 0);
  const slot = (W - padL - padR) / BUCKETS.length;
  const barW = Math.min(64, slot * 0.56);

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Cost value by age of oldest stock">
        {[0.5, 1].map((g) => (
          <line key={g} x1={padL} x2={W - padR} y1={top + plotH * (1 - g)} y2={top + plotH * (1 - g)} stroke="#e3e3e3" strokeWidth={1} />
        ))}
        <line x1={padL} x2={W - padR} y1={top + plotH} y2={top + plotH} stroke="#8a8a8a" strokeWidth={1} />
        {BUCKETS.map((b, i) => {
          const v = byBucket[b] ?? 0;
          const h = v > 0 ? Math.max(3, (v / max) * plotH) : 0;
          const x = padL + slot * i + (slot - barW) / 2;
          const y = top + plotH - h;
          const share = total > 0 ? Math.round((v / total) * 100) : 0;
          return (
            <g
              key={b}
              style={{ cursor: v > 0 ? "pointer" : "default" }}
              onMouseEnter={() => setHover(b)}
              onMouseLeave={() => setHover(null)}
              onClick={() => v > 0 && navigate(linkFor(b))}
            >
              {/* generous hit target */}
              <rect x={padL + slot * i} y={top} width={slot} height={plotH + bottom} fill="transparent" />
              {h > 0 ? (
                <path
                  d={`M${x},${y + plotH * 0 + Math.min(4, h)} q0,-4 4,-4 h${barW - 8} q4,0 4,4 v${h - Math.min(4, h)} h${-barW} z`}
                  fill={BUCKET_COLOR[b]}
                  opacity={hover && hover !== b ? 0.45 : 1}
                />
              ) : null}
              <text x={x + barW / 2} y={y - 8} textAnchor="middle" fontSize={13} fontWeight={600} fill="#303030">
                {v > 0 ? moneyCompact(v) : ""}
              </text>
              <text x={x + barW / 2} y={top + plotH + 20} textAnchor="middle" fontSize={12} fill="#303030">
                {BUCKET_LABEL[b]}
              </text>
              <text x={x + barW / 2} y={top + plotH + 36} textAnchor="middle" fontSize={11} fill="#616161">
                {v > 0 ? `${share}%` : ""}
              </text>
            </g>
          );
        })}
      </svg>
      {hover && (byBucket[hover] ?? 0) > 0 ? (
        <div
          style={{
            position: "absolute", top: 4, right: 8, background: "#303030", color: "#fff", borderRadius: 8,
            padding: "6px 10px", fontSize: 12, pointerEvents: "none",
          }}
        >
          {BUCKET_LABEL[hover]}: {money(byBucket[hover] ?? 0)} at cost · click to see styles
        </div>
      ) : null}
    </div>
  );
}
