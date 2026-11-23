// Course 3 practical exercise: a seeded, deliberately messy "Boztik Café" sales sheet.
//
// * The SAME generator produces (a) the public practice file used in the lessons (fixed seed) and
//   (b) each learner's private assessment dataset (seed derived from the attempt id).
// * Nothing is stored: the CSV is regenerated on demand, so a practical costs zero storage and every
//   attempt works on different numbers (answers cannot be copied between learners).
// * Expected answers are computed here, on the server, from the cleaned data. They are never sent out.
//
// Cleaning rules the learner is taught (and that the answers assume):
//   1. delete fully blank rows
//   2. an OrderID that appears more than once is ONE order (keep it once)
//   3. region names differ only by letter case / stray spaces — treat them as the same region
//   4. revenue = Quantity × UnitPrice per order

export type PracticalKind = "integer" | "money" | "percent" | "text";

export interface PracticalTask {
  id: string;
  kind: PracticalKind;
  prompt: string;
  hint: string;
}

export interface PracticalBuild {
  csv: string;
  tasks: PracticalTask[];
  /** Canonical answers. SERVER ONLY. */
  answers: Record<string, number | string>;
}

const REGIONS = ["Cape Town", "Johannesburg", "Durban", "Gqeberha"] as const;
const REGION_WEIGHTS = [34, 30, 22, 14];
const REPS = ["Ayanda", "Pieter", "Naledi", "Thabo", "Fatima", "Liam"] as const;
const MONTHS = ["January", "February", "March"] as const;

interface Product { name: string; category: string; cents: number; weight: number }
const PRODUCTS: Product[] = [
  { name: "Flat white", category: "Coffee", cents: 3800, weight: 18 },
  { name: "Cappuccino", category: "Coffee", cents: 3600, weight: 14 },
  { name: "Filter coffee", category: "Coffee", cents: 2800, weight: 9 },
  { name: "Americano", category: "Coffee", cents: 3000, weight: 7 },
  { name: "Rooibos latte", category: "Tea", cents: 3400, weight: 8 },
  { name: "Earl Grey", category: "Tea", cents: 2600, weight: 5 },
  { name: "Chai latte", category: "Tea", cents: 3800, weight: 5 },
  { name: "Blueberry muffin", category: "Bakery", cents: 3200, weight: 9 },
  { name: "Croissant", category: "Bakery", cents: 3000, weight: 8 },
  { name: "Bran muffin", category: "Bakery", cents: 2800, weight: 4 },
  { name: "Cheese toastie", category: "Light meals", cents: 5200, weight: 7 },
  { name: "Chicken wrap", category: "Light meals", cents: 6800, weight: 6 },
  { name: "Soup of the day", category: "Light meals", cents: 5500, weight: 4 },
];
const CATEGORIES = ["Coffee", "Tea", "Bakery", "Light meals"] as const;

// --- deterministic randomness -------------------------------------------------------------
function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pickWeighted<T>(rand: () => number, items: readonly T[], weights: readonly number[]): T {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i] ?? 0;
    if (r < 0) return items[i] as T;
  }
  return items[items.length - 1] as T;
}

// --- dataset -------------------------------------------------------------------------------
interface Order {
  id: string;
  date: string; // ISO yyyy-mm-dd
  month: number; // 0..2
  region: string;
  product: Product;
  qty: number;
  rep: string;
}

/** The number of orders varies per seed (100–140) so task 1 cannot be answered without doing the cleaning. */
function generateOrders(rand: () => number): Order[] {
  const monthDays = [31, 28, 31];
  const orders: Order[] = [];
  const count = 100 + Math.floor(rand() * 41);
  for (let i = 0; i < count; i++) {
    const month = Math.min(2, Math.floor((i / count) * 3 + rand() * 0.25));
    const day = 1 + Math.floor(rand() * (monthDays[month] ?? 28));
    const region = pickWeighted(rand, REGIONS, REGION_WEIGHTS);
    const product = pickWeighted(rand, PRODUCTS, PRODUCTS.map((p) => p.weight));
    const qty = 1 + Math.floor(rand() * rand() * 6); // skewed small, 1–6
    const rep = REPS[Math.floor(rand() * REPS.length)] as string;
    orders.push({
      id: `BZC-${1001 + i}`,
      date: `2026-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      month, region, product, qty, rep,
    });
  }
  orders.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)));
  return orders;
}

const money = (cents: number) => (cents / 100).toFixed(2);
const lineCents = (o: Order) => o.qty * o.product.cents;

interface Analysis {
  totalCents: number;
  regionCents: Record<string, number>;
  topRegion: string;
  topRegionMarginPct: number;
  productUnits: Record<string, number>;
  topProduct: string;
  topProductMargin: number;
  categoryCents: Record<string, number>;
}

function analyse(orders: Order[]): Analysis {
  const regionCents: Record<string, number> = {};
  const productUnits: Record<string, number> = {};
  const categoryCents: Record<string, number> = {};
  let totalCents = 0;
  for (const o of orders) {
    const c = lineCents(o);
    totalCents += c;
    regionCents[o.region] = (regionCents[o.region] ?? 0) + c;
    productUnits[o.product.name] = (productUnits[o.product.name] ?? 0) + o.qty;
    categoryCents[o.product.category] = (categoryCents[o.product.category] ?? 0) + c;
  }
  const regionsSorted = Object.entries(regionCents).sort((a, b) => b[1] - a[1]);
  const productsSorted = Object.entries(productUnits).sort((a, b) => b[1] - a[1]);
  const topRegion = regionsSorted[0]?.[0] ?? "";
  const second = regionsSorted[1]?.[1] ?? 0;
  const topRegionMarginPct = second > 0 ? ((regionsSorted[0]?.[1] ?? 0) - second) / second * 100 : 100;
  return {
    totalCents, regionCents, topRegion, topRegionMarginPct, productUnits,
    topProduct: productsSorted[0]?.[0] ?? "",
    topProductMargin: (productsSorted[0]?.[1] ?? 0) - (productsSorted[1]?.[1] ?? 0),
    categoryCents,
  };
}

/** Regenerate until every answer is unambiguous (no ties, healthy margins). Deterministic per seed. */
function unambiguousOrders(seed: string): { orders: Order[]; rand: () => number; analysis: Analysis } {
  for (let salt = 0; salt < 200; salt++) {
    const rand = mulberry32(hashSeed(`${seed}#${salt}`));
    const orders = generateOrders(rand);
    const a = analyse(orders);
    const monthCat = new Map<string, number>();
    for (const o of orders) monthCat.set(`${o.month}|${o.product.category}`, (monthCat.get(`${o.month}|${o.product.category}`) ?? 0) + 1);
    const everyMonthCatUsable = [...monthCat.values()].every((n) => n >= 3) && monthCat.size === MONTHS.length * CATEGORIES.length;
    if (a.topRegionMarginPct >= 4 && a.topProductMargin >= 4 && everyMonthCatUsable) return { orders, rand, analysis: a };
  }
  // Practically unreachable; fall back to a fixed, known-good seed rather than ship an ambiguous exercise.
  const rand = mulberry32(hashSeed("fallback"));
  const orders = generateOrders(rand);
  return { orders, rand, analysis: analyse(orders) };
}

function messyRegion(rand: () => number, region: string): string {
  const r = rand();
  if (r < 0.7) return region;
  if (r < 0.8) return region.toLowerCase();
  if (r < 0.88) return region.toUpperCase();
  if (r < 0.95) return `${region} `;
  return ` ${region}`;
}

export function buildPractical(seed: string): PracticalBuild {
  const { orders, rand, analysis } = unambiguousOrders(seed);
  const total = orders.length;

  // ---- build the messy CSV ----
  const rows: string[] = [];
  const dupTarget = 6 + Math.floor(rand() * 9); // 6–14 double-entered orders
  const blankTarget = 3 + Math.floor(rand() * 5); // 3–7 blank rows
  const dupIds = new Set<string>();
  while (dupIds.size < dupTarget) dupIds.add((orders[Math.floor(rand() * total)] as Order).id);
  const blankAfter = new Set<number>();
  while (blankAfter.size < blankTarget) blankAfter.add(1 + Math.floor(rand() * (total - 2)));

  orders.forEach((o, i) => {
    const line = [o.id, o.date, messyRegion(rand, o.region), o.product.name, o.product.category, String(o.qty), money(o.product.cents), o.rep].join(",");
    rows.push(line);
    if (dupIds.has(o.id)) rows.push(line); // double-entered order: identical row directly below
    if (blankAfter.has(i)) rows.push(",,,,,,,");
  });
  const csv = ["OrderID,OrderDate,Region,Product,Category,Quantity,UnitPrice,SalesRep", ...rows].join("\r\n") + "\r\n";

  // ---- answers on the cleaned data ----
  const targetMonth = Math.floor(rand() * MONTHS.length);
  const targetCategory = CATEGORIES[Math.floor(rand() * CATEGORIES.length)] as string;
  let shareCategory = CATEGORIES[Math.floor(rand() * CATEGORIES.length)] as string;
  if (shareCategory === targetCategory) shareCategory = CATEGORIES[(CATEGORIES.indexOf(targetCategory as never) + 1) % CATEGORIES.length] as string;

  const monthCatOrders = orders.filter((o) => o.month === targetMonth && o.product.category === targetCategory).length;
  const sharePct = Math.round(((analysis.categoryCents[shareCategory] ?? 0) / analysis.totalCents) * 1000) / 10;
  const topRegionCents = analysis.regionCents[analysis.topRegion] ?? 0;
  const avgCents = Math.round(analysis.totalCents / total);

  const monthName = MONTHS[targetMonth] as string;
  const tasks: PracticalTask[] = [
    { id: "p1", kind: "integer", prompt: "After deleting the blank rows and keeping each OrderID only once, how many orders are left?", hint: "Whole number." },
    { id: "p2", kind: "money", prompt: "What is the total revenue across those orders? Revenue for one order is Quantity × UnitPrice. Give the total in rand.", hint: "Two decimal places, for example 12345.60." },
    { id: "p3", kind: "text", prompt: "Which region earned the most revenue? Treat “cape town”, “CAPE TOWN ” and “Cape Town” as the same region.", hint: "Type the region name." },
    { id: "p4", kind: "money", prompt: "How much revenue did that region earn, in rand?", hint: "Two decimal places." },
    { id: "p5", kind: "money", prompt: "What is the average order value (total revenue ÷ number of orders), in rand?", hint: "Two decimal places." },
    { id: "p6", kind: "text", prompt: "Which product sold the most units (add up Quantity for each product)?", hint: "Type the product name." },
    { id: "p7", kind: "integer", prompt: `How many orders were placed in ${monthName} 2026 for the ${targetCategory} category?`, hint: "Whole number." },
    { id: "p8", kind: "percent", prompt: `What percentage of total revenue came from the ${shareCategory} category?`, hint: "One decimal place, for example 23.4." },
  ];
  const answers: Record<string, number | string> = {
    p1: total,
    p2: analysis.totalCents / 100,
    p3: analysis.topRegion,
    p4: topRegionCents / 100,
    p5: avgCents / 100,
    p6: analysis.topProduct,
    p7: monthCatOrders,
    p8: sharePct,
  };
  return { csv, tasks, answers };
}

// --- marking ---------------------------------------------------------------------------------
/** Lenient numeric parsing: "R 1 234,50", "1,234.50", "1234.5". Returns NaN when not a number. */
export function parseNumber(input: unknown): number {
  if (typeof input === "number") return Number.isFinite(input) ? input : NaN;
  if (typeof input !== "string") return NaN;
  let s = input.trim().replace(/^[rR]\s*/, "").replace(/[%\s ]/g, "");
  if (!s || s.length > 24) return NaN;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // the later separator is the decimal mark
    s = lastDot > lastComma ? s.replace(/,/g, "") : s.replace(/\./g, "").replace(",", ".");
  } else if (lastComma >= 0) {
    if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, ""); // "1,234" / "1,234,567" = thousands separators
    else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", "."); // "12,50" = decimal comma
    else s = s.replace(/,/g, "");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

export const normaliseText = (v: unknown): string =>
  typeof v === "string" ? v.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase() : "";

export interface PracticalResult {
  correct: number;
  total: number;
  percent: number;
  /** Per-task pass/fail only. Correct values are NEVER included. */
  perTask: Record<string, boolean>;
}

export function markPractical(seed: string, submitted: Record<string, unknown>): PracticalResult {
  const { tasks, answers } = buildPractical(seed);
  const perTask: Record<string, boolean> = {};
  let correct = 0;
  for (const t of tasks) {
    const expected = answers[t.id];
    const given = submitted[t.id];
    let ok = false;
    if (t.kind === "text") ok = normaliseText(given) === normaliseText(expected);
    else {
      const n = parseNumber(given);
      const tolerance = t.kind === "integer" ? 0 : t.kind === "percent" ? 0.05 : 0.01;
      ok = Number.isFinite(n) && Math.abs(n - Number(expected)) <= tolerance + 1e-9;
    }
    perTask[t.id] = ok;
    if (ok) correct++;
  }
  return { correct, total: tasks.length, percent: Math.round((correct / tasks.length) * 100), perTask };
}
