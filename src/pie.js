import { nuanceColor, nuanceLabel } from "./nuances.js";

// Construit un camembert SVG (chaîne HTML) + une légende à partir d'une liste de
// résultats [{nuance, voix, pct, elu}], et le html d'une légende associée.
export function renderPie(results, { size = 120 } = {}) {
  const total = results.reduce((s, r) => s + r.voix, 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2;

  if (total === 0) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${cx}" cy="${cy}" r="${r - 2}" fill="#eee" stroke="#ccc" />
    </svg>`;
  }

  let angleStart = -Math.PI / 2;
  const slices = [];
  for (const res of results) {
    const frac = res.voix / total;
    if (frac <= 0) continue;
    const angleEnd = angleStart + frac * 2 * Math.PI;
    slices.push(sliceSvg(cx, cy, r - 1, angleStart, angleEnd, nuanceColor(res.nuance), res.elu));
    angleStart = angleEnd;
  }

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${slices.join("")}</svg>`;
}

function sliceSvg(cx, cy, r, a0, a1, color, elu) {
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const largeArc = a1 - a0 > Math.PI ? 1 : 0;
  const d = `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${largeArc} 1 ${x1} ${y1} Z`;
  const stroke = elu ? 'stroke="#111" stroke-width="1.5"' : 'stroke="#fff" stroke-width="0.5"';
  return `<path d="${d}" fill="${color}" ${stroke} />`;
}

export function renderLegend(results) {
  const total = results.reduce((s, r) => s + r.voix, 0);
  return results
    .slice(0, 8)
    .map((r) => {
      const pct = total > 0 ? ((r.voix / total) * 100).toFixed(1) : "0.0";
      const elu = r.elu ? " • élu(e)" : "";
      return `<div><span class="swatch" style="background:${nuanceColor(r.nuance)}"></span>${nuanceLabel(r.nuance)} — ${pct}%${elu}</div>`;
    })
    .join("");
}
