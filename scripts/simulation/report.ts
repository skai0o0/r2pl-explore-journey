import type { BotSchool } from "../../shared/simulation/schoolBots.ts";
import { tileCoordinates } from "../../shared/world/coordinates.ts";
export function latencySummary(values: readonly number[]): {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
} {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) =>
    Number(
      (sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0).toFixed(3),
    );
  return {
    count: values.length,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: at(1),
  };
}
export function mapCoverage(masks: ReadonlyMap<number, number>): {
  uniqueTiles: number;
  overlapTiles: number;
  pairCounts: Record<string, number>;
  schoolTiles: number[];
} {
  const schoolTiles = Array<number>(8).fill(0);
  const pairCounts: Record<string, number> = {};
  let overlapTiles = 0;
  for (const mask of masks.values()) {
    const schools: number[] = [];
    for (let slot = 0; slot < 8; slot++)
      if (mask & (1 << slot)) {
        schoolTiles[slot]!++;
        schools.push(slot);
      }
    if (schools.length > 1) overlapTiles++;
    for (let a = 0; a < schools.length; a++)
      for (let b = a + 1; b < schools.length; b++) {
        const pair = `${schools[a]}:${schools[b]}`;
        pairCounts[pair] = (pairCounts[pair] ?? 0) + 1;
      }
  }
  return { uniqueTiles: masks.size, overlapTiles, pairCounts, schoolTiles };
}
function escapeSvg(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
}
/** Local synthetic admin artifact. Never passed to a bot or served as a public world snapshot. */
export function botMapSvg(
  schools: readonly BotSchool[],
  masks: ReadonlyMap<number, number>,
): string {
  const minX = Math.min(...schools.map((s) => s.region.x)) - 4;
  const minZ = Math.min(...schools.map((s) => s.region.z)) - 4;
  const maxX = Math.max(...schools.map((s) => s.region.x + s.region.size)) + 4;
  const maxZ = Math.max(...schools.map((s) => s.region.z + s.region.size)) + 4;
  const width = maxX - minX;
  const height = maxZ - minZ;
  const groups = new Map<number, string[]>();
  for (const [tile, mask] of masks) {
    const { x, z } = tileCoordinates(tile);
    const list = groups.get(mask) ?? [];
    list.push(`M${x - minX},${z - minZ}h1v1h-1z`);
    groups.set(mask, list);
  }
  const paths = [...groups]
    .map(([mask, paths]) => {
      const colors = schools
        .filter((s) => mask & (1 << s.slot))
        .map((s) => s.color);
      let rgb = [0, 0, 0];
      for (const color of colors)
        rgb = rgb.map(
          (sum, i) => sum + parseInt(color.slice(1 + i * 2, 3 + i * 2), 16),
        );
      const color = `#${rgb
        .map((v) =>
          Math.round(v / colors.length)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")}`;
      return `<path fill="${color}" d="${paths.join("")}"/>`;
    })
    .join("");
  const starts = schools
    .map((s) => {
      const { x, z } = tileCoordinates(s.home);
      return `<circle cx="${x - minX + 0.5}" cy="${z - minZ + 0.5}" r="1.4" stroke="${s.color}" fill="#101925" stroke-width="0.4"/>`;
    })
    .join("");
  const legend = schools
    .map(
      (s, i) =>
        `<rect x="${20 + (i % 4) * 220}" y="${595 + Math.floor(i / 4) * 27}" width="12" height="12" fill="${s.color}"/><text x="${38 + (i % 4) * 220}" y="${606 + Math.floor(i / 4) * 27}">${escapeSvg(s.label)} (synthetic)</text>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="920" height="665" viewBox="0 0 920 665"><rect width="920" height="665" fill="#101925"/><g fill="#dce8f0" font-family="sans-serif"><text x="20" y="29" font-size="19">8-school bot simulation — synthetic admin view</text><text x="20" y="51" font-size="12">Confirmed ACKs · mixed colors = overlapping presence, not live contest · circles = fixture starts</text></g><svg x="20" y="70" width="880" height="505" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet"><rect width="${width}" height="${height}" fill="#172233"/>${paths}${starts}</svg><g fill="#dce8f0" font-family="sans-serif" font-size="12">${legend}</g></svg>`;
}
