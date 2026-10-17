// The geometry of a three-column flow chart (a Sankey diagram): sources on the left all flow
// into one total in the middle, which flows out to uses on the right. Every band is as thick
// as the money in it. Kept apart from the drawing so it can be tested without a browser.

export type SankeyNode = { key: string; name: string; color: string; value: number };

export type SankeyData = {
  sources: readonly SankeyNode[];
  total: { name: string; value: number };
  uses: readonly SankeyNode[];
};

export type PlacedNode = SankeyNode & { side: "source" | "total" | "use"; x: number; y: number; height: number };
export type PlacedLink = { key: string; color: string; path: string };
export type PlacedLabel = {
  key: string;
  name: string;
  value: number;
  x: number;
  /** The middle of its two lines: level with the middle of its bar. */
  y: number;
  /** About how many characters of name fit before the label runs into something. */
  maxChars: number;
};

export const NODE_WIDTH = 10;
export const NODE_GAP = 6;
/** Two lines of text and a little air: the closest two bars' middles in a column may be. */
export const LABEL_SPACING = 36;
/** How tall the whole total is drawn. Columns with many small bars spread taller than this. */
const TOTAL_HEIGHT = 280;
const LABEL_INSET = 6;
/** Roughly the width of one character of 12px text. */
const CHAR_WIDTH = 6.6;
/** Narrower than this, the total is named above the chart rather than beside its bar. */
const MIN_TOTAL_LABEL_ROOM = 110;

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** A band of constant thickness from one edge to another, curving between them. */
function ribbon(x0: number, y0: number, x1: number, y1: number, thickness: number): string {
  const mid = (x0 + x1) / 2;
  return [
    `M${x0},${y0}`,
    `C${mid},${y0} ${mid},${y1} ${x1},${y1}`,
    `L${x1},${y1 + thickness}`,
    `C${mid},${y1 + thickness} ${mid},${y0 + thickness} ${x0},${y0 + thickness}`,
    "Z",
  ].join(" ");
}

/**
 * Bars one under another, as tall as their money. Small ones are moved apart until their
 * middles leave room for a label each, so every label sits level with its own bar. Measured
 * from 0, with room for half a label above the first and below the last.
 */
function stack(heights: readonly number[]): { tops: number[]; extent: number } {
  const half = LABEL_SPACING / 2;
  const tops: number[] = [];
  let bottom = 0;
  let middle = -Infinity;
  for (const [i, height] of heights.entries()) {
    const centre = i === 0 ? Math.max(half, height / 2) : Math.max(bottom + NODE_GAP + height / 2, middle + LABEL_SPACING);
    tops.push(centre - height / 2);
    bottom = centre + height / 2;
    middle = centre;
  }
  return { tops, extent: Math.max(bottom, middle + half) };
}

export function layoutSankey(data: SankeyData, width: number) {
  const sources = data.sources.filter((node) => node.value > 0);
  const uses = data.uses.filter((node) => node.value > 0);
  const scale = data.total.value > 0 ? TOTAL_HEIGHT / data.total.value : 0;

  // Room for the labels each side of the middle bar; the bands get what is left.
  const leftRoom = clamp(width * 0.28, 100, 220);
  const rightRoom = clamp(width * 0.28, 120, 240);
  const x = { source: 0, total: NODE_WIDTH + leftRoom, use: Math.max(NODE_WIDTH + leftRoom + 50, width - rightRoom - NODE_WIDTH) };

  const left = stack(sources.map((node) => node.value * scale));
  const right = stack(uses.map((node) => node.value * scale));
  const middle = stack([data.total.value * scale]);
  const height = Math.max(left.extent, right.extent, middle.extent);

  // Each column is centred in the height of the tallest.
  const place = (nodes: readonly SankeyNode[], side: PlacedNode["side"], column: ReturnType<typeof stack>): PlacedNode[] => {
    const offset = (height - column.extent) / 2;
    return nodes.map((node, i) => ({ ...node, side, x: x[side], y: offset + column.tops[i]!, height: node.value * scale }));
  };
  const placedLeft = place(sources, "source", left);
  const placedRight = place(uses, "use", right);
  const [placedTotal] = place([{ key: "total", name: data.total.name, color: "var(--color-primary)", value: data.total.value }], "total", middle);
  const total = placedTotal!;

  // Each band enters and leaves the middle bar in the order of its column, top to bottom.
  const links: PlacedLink[] = [];
  let into = total.y;
  for (const node of placedLeft) {
    links.push({ key: node.key, color: node.color, path: ribbon(node.x + NODE_WIDTH, node.y, total.x, into, node.height) });
    into += node.height;
  }
  let outOf = total.y;
  for (const node of placedRight) {
    links.push({ key: node.key, color: node.color, path: ribbon(total.x + NODE_WIDTH, outOf, node.x, node.y, node.height) });
    outOf += node.height;
  }

  const labelsFor = (nodes: readonly PlacedNode[], room: number): PlacedLabel[] =>
    nodes.map((node) => ({
      key: node.key,
      name: node.name,
      value: node.value,
      x: node.x + NODE_WIDTH + LABEL_INSET,
      y: node.y + node.height / 2,
      maxChars: Math.max(4, Math.floor(room / CHAR_WIDTH)),
    }));
  const totalRoom = x.use - (x.total + NODE_WIDTH + LABEL_INSET) - LABEL_INSET;
  const totalLabelled = totalRoom >= MIN_TOTAL_LABEL_ROOM;
  const labels = [
    ...labelsFor(placedLeft, leftRoom - LABEL_INSET * 2),
    ...(totalLabelled ? labelsFor([total], totalRoom) : []),
    ...labelsFor(placedRight, width - (x.use + NODE_WIDTH + LABEL_INSET)),
  ];

  return { height, nodes: [...placedLeft, total, ...placedRight], links, labels, totalLabelled };
}

/** `name`, cut short with an ellipsis when it has more than `max` characters. */
export const fitName = (name: string, max: number) => (name.length <= max ? name : `${name.slice(0, Math.max(1, max - 1))}…`);
