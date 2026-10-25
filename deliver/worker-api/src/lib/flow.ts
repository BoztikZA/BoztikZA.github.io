// Visitor-flow derivation. PURE: no I/O, so it can be unit-tested and so the dashboard can only ever show what
// the recorded events say.
//
// Input is the raw page_session_events rows (anonymous cookie id, receipt time, page key). Output is built ONLY
// from those rows — nothing is inferred from aggregate page-view totals.
//
// Visit policy (documented in the dashboard too):
//   * One browser cookie lives up to 180 days, so a cookie is NOT a visit. A new visit starts after
//     VISIT_GAP_SECONDS (30 minutes) with no recorded page view from the same cookie.
//   * Consecutive repeats of the same page inside a visit (reload / double fire) collapse into one step.
//   * An "exit" is the last RECORDED page of a visit. The counter cannot see what happens after that (visitor
//     leaving, a page without tracking, Do Not Track), so exits are "last observed page", not proof of leaving.

export const VISIT_GAP_SECONDS = 30 * 60;
/** Fewer recorded visits than this => numbers are shown but flagged as a small sample. */
export const MIN_VISITS_FOR_FLOW = 20;
export const MAX_JOURNEY_STEPS = 5;

export interface FlowEvent { session_id: string; page: string; seen_at: number }

export interface FlowResult {
  visits: number;
  single_page_visits: number;
  multi_page_visits: number;
  entries: Array<{ page: string; visits: number }>;
  exits: Array<{ page: string; visits: number }>;
  transitions: Array<{ from: string; to: string; visits: number }>;
  journeys: Array<{ path: string[]; truncated: boolean; visits: number }>;
}

/** Splits time-ordered events into visits (arrays of page keys). Events MUST be ordered by seen_at within a session. */
export function buildVisits(events: FlowEvent[], gapSeconds = VISIT_GAP_SECONDS): string[][] {
  const bySession = new Map<string, FlowEvent[]>();
  for (const e of events) {
    const list = bySession.get(e.session_id);
    if (list) list.push(e); else bySession.set(e.session_id, [e]);
  }
  const visits: string[][] = [];
  for (const list of bySession.values()) {
    // Stable sort keeps insertion (rowid) order for events in the same second.
    const ordered = list.map((e, i) => ({ e, i })).sort((a, b) => a.e.seen_at - b.e.seen_at || a.i - b.i).map(x => x.e);
    let current: string[] = [];
    let last = 0;
    for (const e of ordered) {
      if (current.length && e.seen_at - last > gapSeconds) { visits.push(current); current = []; }
      if (current[current.length - 1] !== e.page) current.push(e.page);
      last = e.seen_at;
    }
    if (current.length) visits.push(current);
  }
  return visits;
}

const rank = <T extends { visits: number }>(rows: T[], key: (r: T) => string): T[] =>
  rows.sort((a, b) => b.visits - a.visits || key(a).localeCompare(key(b)));

export function computeFlow(visits: string[][], opts: { limit?: number } = {}): FlowResult {
  const limit = opts.limit ?? 8;
  const entries = new Map<string, number>();
  const exits = new Map<string, number>();
  const transitions = new Map<string, number>();
  const journeys = new Map<string, { path: string[]; truncated: boolean; visits: number }>();
  let multi = 0;

  for (const v of visits) {
    if (!v.length) continue;
    entries.set(v[0]!, (entries.get(v[0]!) ?? 0) + 1);
    exits.set(v[v.length - 1]!, (exits.get(v[v.length - 1]!) ?? 0) + 1);
    if (v.length < 2) continue;
    multi += 1;
    const seen = new Set<string>();
    for (let i = 0; i < v.length - 1; i++) seen.add(`${v[i]}\u0000${v[i + 1]}`);
    for (const t of seen) transitions.set(t, (transitions.get(t) ?? 0) + 1);
    const path = v.slice(0, MAX_JOURNEY_STEPS);
    const k = path.join("\u0000") + (v.length > MAX_JOURNEY_STEPS ? "\u0000…" : "");
    const j = journeys.get(k);
    if (j) j.visits += 1; else journeys.set(k, { path, truncated: v.length > MAX_JOURNEY_STEPS, visits: 1 });
  }

  const toRows = (m: Map<string, number>) => [...m.entries()].map(([page, n]) => ({ page, visits: n }));
  return {
    visits: visits.length,
    single_page_visits: visits.length - multi,
    multi_page_visits: multi,
    // entries / exits / transitions are bounded by the closed set of tracked page keys, so they are never truncated.
    entries: rank(toRows(entries), r => r.page),
    exits: rank(toRows(exits), r => r.page),
    transitions: rank([...transitions.entries()].map(([k, n]) => { const [from, to] = k.split("\u0000"); return { from: from!, to: to!, visits: n }; }), r => `${r.from}>${r.to}`),
    journeys: rank([...journeys.values()], r => r.path.join(">")).slice(0, limit),
  };
}

/** Per-page entrance / exit counts across ALL pages (not truncated), used by the page-performance table. */
export function pageEntranceExit(visits: string[][]): Record<string, { entrances: number; exits: number }> {
  const out: Record<string, { entrances: number; exits: number }> = {};
  const slot = (p: string) => (out[p] ??= { entrances: 0, exits: 0 });
  for (const v of visits) {
    if (!v.length) continue;
    slot(v[0]!).entrances += 1;
    slot(v[v.length - 1]!).exits += 1;
  }
  return out;
}
