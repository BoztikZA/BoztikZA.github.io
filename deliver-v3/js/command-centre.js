// Boztik Command Centre — operational panels built ONLY from data the system really records:
//   * the deliveries list (status, expiry, views, downloads, source, last activity)
//   * the Worker's aggregate analytics (overview, timeseries, top deliveries, per-page views)
//   * the storage ledger summary and a live reachability probe of the Worker
// Nothing here estimates, extrapolates or invents a metric. Where data does not exist
// (visitor location, device, browser, referrer are NOT collected by design) nothing is shown.
import { escapeHtml, formatBytes, formatDate } from "./shared.js";
import { fetchPageAnalytics, fetchShareAnalytics, pingHealth } from "./api.js";
import { insightsSnapshot, percentChange, trendChart } from "./insights.js";

const HOUR = 3600 * 1000;
const nf = n => Number(n || 0).toLocaleString();
const $ = id => document.getElementById(id);
const icon = name => `<svg class="cc-i" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;

let cfg = { onAction: () => {}, labelOf: d => d.source, groupOf: d => d.source };

/* ------------------------------------------------------------------ helpers */
export function formatRate(views, downloads) {
  const v = Number(views) || 0, d = Number(downloads) || 0;
  return v > 0 ? String(Math.round((d / v) * 100)) : "—";
}
const nameOf = d => d.project_name || d.client_name || d.id;
const isActive = (d, now = Date.now()) => new Date(d.expires_at).getTime() > now && !d.storage_deleted_at;

function relative(ms) {
  const abs = Math.abs(ms), h = Math.floor(abs / HOUR), m = Math.floor((abs % HOUR) / 60000);
  if (h >= 48) return `${Math.floor(h / 24)} days`;
  if (h >= 1) return `${h}h ${m}m`;
  return `${Math.max(1, m)} min`;
}

/* ------------------------------------------------------------------ topbar */
export function renderTopbar({ session, health }) {
  const chip = $("cc-health");
  if (chip) {
    const state = !health ? "loading" : health.ok ? "ok" : "down";
    chip.className = `cc-chip is-${state}`;
    chip.innerHTML = `<span class="cc-dot" aria-hidden="true"></span><span>${state === "loading" ? "Checking API…" : state === "ok" ? `API operational${health.ms != null ? ` · ${health.ms} ms` : ""}` : "API unreachable"}</span>`;
  }
  const s = $("cc-session");
  if (s && session) {
    const left = session.expires_at ? Date.parse(session.expires_at) - Date.now() : null;
    s.innerHTML = `${icon("user")}<span>${escapeHtml(session.email || session.user?.email || "Admin")}${left && left > 0 ? ` · session ends in ${relative(left)}` : ""}</span>`;
  }
  const r = $("cc-refreshed");
  if (r) r.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

/* ---------------------------------------------------------------------- KPIs */
export function renderKpis(overview) {
  const snap = insightsSnapshot();
  const s30 = snap.series30;
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  const delta = (cur, prev) => {
    const pct = percentChange(cur, prev);
    if (pct === null) return `<span class="cc-delta is-flat">No earlier data to compare</span>`;
    if (pct === 0) return `<span class="cc-delta is-flat">▬ Same as the previous 7 days</span>`;
    return `<span class="cc-delta ${pct > 0 ? "is-up" : "is-down"}">${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}% <small>vs previous 7 days</small></span>`;
  };
  if (overview?.activity) {
    set("cc-views-7d", nf(overview.activity.last_7d.views));
    set("cc-downloads-7d", nf(overview.activity.last_7d.downloads));
    set("stat-view-rate", formatRate(overview.activity.lifetime.views, overview.activity.lifetime.downloads));
  }
  if (s30 && s30.length >= 14) {
    const sum = (arr, k) => arr.reduce((t, p) => t + p[k], 0);
    const cur = s30.slice(-7), prev = s30.slice(-14, -7);
    const v = $("cc-views-delta"), d = $("cc-downloads-delta");
    if (v) v.innerHTML = delta(sum(cur, "views"), sum(prev, "views"));
    if (d) d.innerHTML = delta(sum(cur, "downloads"), sum(prev, "downloads"));
  }
}

/* ------------------------------------------------------- needs attention */
const LEVEL_LABEL = { action: "Action needed", watch: "Keep an eye on", info: "For your information" };
const LEVEL_ICON = { action: "alert", watch: "clock", info: "info" };

export function buildAttention({ deliveries, overview, health }) {
  const now = Date.now();
  const items = [];
  const push = (level, title, detail, action) => items.push({ level, title, detail, action });

  if (health && !health.ok) {
    push("action", "The delivery API is not responding", "Clients can't open or download files until it is back. Check the Cloudflare dashboard (Workers → boztik-deliver-api).", { kind: "refresh", label: "Check again" });
  }

  const st = overview?.storage;
  if (st) {
    const pct = st.used_percent ?? 0;
    if (st.upload_locked) push("action", "Uploads are locked — storage is full", `${formatBytes(st.used_bytes + st.reserved_bytes)} of ${formatBytes(st.limit_bytes)} used. Delete old deliveries or clean expired ones.`, { kind: "cleanup", label: "Clean expired" });
    else if (pct >= 70) push(pct >= 95 ? "action" : "watch", `Storage is ${pct}% full`, `${formatBytes(st.remaining_bytes)} left of the ${formatBytes(st.limit_bytes)} hard cap.`, { kind: "cleanup", label: "Clean expired" });
    if (st.accounting_uncertain) push("watch", "Storage accounting is being re-verified", "Uploads pause until the ledger is confirmed against the bucket.", { kind: "reconcile", label: "Verify now" });
  }

  const awaiting = overview?.deliveries?.awaiting_cleanup ?? 0;
  if (awaiting > 0) push("info", `${awaiting} expired deliver${awaiting === 1 ? "y" : "ies"} still hold${awaiting === 1 ? "s" : ""} files`, "The scheduled cleanup runs every 10 minutes; you can also run it now.", { kind: "cleanup", label: "Clean expired" });

  const active = deliveries.filter(d => isActive(d, now));
  const clientActive = active.filter(d => !d.is_photoshop_battles);

  // Expiring within 72 h — with the follow-through context that actually matters.
  const expiring = active.filter(d => new Date(d.expires_at).getTime() - now <= 72 * HOUR).sort((a, b) => new Date(a.expires_at) - new Date(b.expires_at));
  expiring.slice(0, 3).forEach(d => {
    const left = new Date(d.expires_at).getTime() - now;
    const views = Number(d.view_count || 0), dls = Number(d.download_count || 0);
    const bits = [`${views} view${views === 1 ? "" : "s"}`, `${dls} download${dls === 1 ? "" : "s"}`];
    if (!d.is_photoshop_battles && views > 0 && dls === 0) bits.push("opened but not downloaded yet");
    if (!d.is_photoshop_battles && views === 0) bits.push("not opened yet");
    if (d.is_photoshop_battles) bits.push("the direct Reddit image link stops working when it expires");
    push(left <= 24 * HOUR ? "action" : "watch", `“${nameOf(d)}” expires in ${relative(left)}`, bits.join(" · "), { kind: "extend", id: d.id, label: "Extend" });
  });
  const moreExpiring = expiring.length - 3;
  if (moreExpiring > 0) push("watch", `${moreExpiring} more ${moreExpiring === 1 ? "delivery expires" : "deliveries expire"} within 72 hours`, "Open the Deliveries tab and sort by expiry to review them.", { kind: "deliveries", label: "Review" });

  // Delivered but never opened (only meaningful for client deliveries, and not if it is about to expire — already listed).
  const shownIds = new Set(expiring.slice(0, 3).map(d => d.id));
  const unopened = clientActive.filter(d => !shownIds.has(d.id) && Number(d.view_count || 0) === 0 && now - new Date(d.created_at).getTime() >= 12 * HOUR);
  unopened.slice(0, 2).forEach(d => push("info", `“${nameOf(d)}” hasn't been opened`, `Created ${relative(now - new Date(d.created_at).getTime())} ago with no views. The link may not have reached the client.`, { kind: "copy", id: d.id, label: "Copy link" }));
  if (unopened.length > 2) push("info", `${unopened.length - 2} more deliveries haven't been opened`, "They were created over 12 hours ago and have no views.", { kind: "deliveries", label: "Review" });

  const rank = { action: 0, watch: 1, info: 2 };
  return items.sort((a, b) => rank[a.level] - rank[b.level]);
}

export function renderAttention(ctx) {
  const list = $("cc-attention-list"), count = $("cc-attention-count");
  if (!list) return;
  const items = buildAttention(ctx);
  const urgent = items.filter(i => i.level !== "info").length;
  if (count) { count.textContent = items.length ? `${items.length} item${items.length === 1 ? "" : "s"}` : "All clear"; count.dataset.state = urgent ? "attention" : "clear"; }
  if (!items.length) {
    list.innerHTML = `<li class="cc-att cc-att--ok"><span class="cc-att-ic">${icon("check")}</span><div class="cc-att-main"><span class="cc-att-tag">All clear</span><strong>Nothing needs your attention right now</strong><small>No deliveries are close to expiry, storage is healthy and the API is responding.</small></div></li>`;
    return;
  }
  list.innerHTML = items.slice(0, 7).map(i => `
    <li class="cc-att cc-att--${i.level}">
      <span class="cc-att-ic">${icon(LEVEL_ICON[i.level])}</span>
      <div class="cc-att-main"><span class="cc-att-tag">${LEVEL_LABEL[i.level]}</span><strong>${escapeHtml(i.title)}</strong><small>${escapeHtml(i.detail)}</small></div>
      ${i.action ? `<button type="button" class="cc-btn" data-att="${i.action.kind}" ${i.action.id ? `data-id="${escapeHtml(i.action.id)}"` : ""}>${escapeHtml(i.action.label)}</button>` : ""}
    </li>`).join("");
}

/* ------------------------------------------------------------------- health */
export function renderHealth({ health, overview, session }) {
  const host = $("cc-health-body");
  if (!host) return;
  const st = overview?.storage;
  const row = (label, value, state, hint = "") => `<li class="cc-hrow is-${state}"><span class="cc-hrow-label">${label}</span><span class="cc-hrow-val"><i class="cc-state-ic" aria-hidden="true">${state === "ok" ? "✓" : state === "warn" ? "!" : state === "bad" ? "✕" : "•"}</i>${value}</span>${hint ? `<small>${hint}</small>` : ""}</li>`;
  const rows = [];
  rows.push(health
    ? health.ok ? row("Delivery API", `Operational${health.ms != null ? ` · ${health.ms} ms` : ""}`, "ok", "Worker answered the health check just now.") : row("Delivery API", "Unreachable", "bad", "The health check failed — clients may not be able to open deliveries.")
    : row("Delivery API", "Checking…", "idle"));
  if (st) {
    rows.push(st.accounting_uncertain ? row("Storage ledger", "Re-verification pending", "warn", "Uploads pause until confirmed against the bucket.") : row("Storage ledger", st.last_reconciled_at ? `Verified ${escapeHtml(formatDate(st.last_reconciled_at))}` : "Not yet verified", st.last_reconciled_at ? "ok" : "warn"));
    rows.push(st.upload_locked ? row("Uploads", "Locked", "bad", escapeHtml(st.lock_reason || "Storage is full.")) : row("Uploads", "Open", "ok", `${formatBytes(st.remaining_bytes)} available`));
    rows.push(row("Storage used", `${st.used_percent}% of ${formatBytes(st.limit_bytes)}`, st.used_percent >= 95 ? "bad" : st.used_percent >= 70 ? "warn" : "ok"));
  }
  const awaiting = overview?.deliveries?.awaiting_cleanup;
  if (awaiting !== undefined) rows.push(row("Expired, files still stored", String(awaiting), awaiting ? "warn" : "ok", awaiting ? "Auto-cleanup runs every 10 minutes." : "Nothing waiting for cleanup."));
  if (session?.expires_at) { const left = Date.parse(session.expires_at) - Date.now(); rows.push(row("Admin session", left > 0 ? `Ends in ${relative(left)}` : "Expired", left > 0 ? "ok" : "bad", "You'll be asked to sign in again when it ends.")); }
  host.innerHTML = `<ul class="cc-hlist">${rows.join("")}</ul>`;
}

/* ------------------------------------------------------ analytics: funnel */
export function renderFunnel(deliveries, overviewTotal) {
  const host = $("cc-funnel-body");
  if (!host) return;
  const client = deliveries.filter(d => !d.is_photoshop_battles);
  if (!client.length) { host.innerHTML = `<p class="cc-empty">No client deliveries yet. Once you deliver work, you'll see how many were opened and downloaded.</p>`; return; }
  const total = client.length;
  const opened = client.filter(d => Number(d.view_count || 0) > 0).length;
  const downloaded = client.filter(d => Number(d.download_count || 0) > 0).length;
  const viewedNotDl = client.filter(d => isActive(d) && Number(d.view_count || 0) > 0 && Number(d.download_count || 0) === 0).length;
  const pct = n => Math.round((n / total) * 100);
  const bar = (label, n) => `<li><div class="cc-fun-top"><span>${label}</span><strong>${n} of ${total} <em>(${pct(n)}%)</em></strong></div><div class="cc-meter" role="img" aria-label="${label}: ${n} of ${total}"><span style="width:${pct(n)}%"></span></div></li>`;
  const truncated = overviewTotal && overviewTotal > deliveries.length;
  host.innerHTML = `<ul class="cc-funnel">${bar("Delivered", total)}${bar("Opened at least once", opened)}${bar("Downloaded at least once", downloaded)}</ul>
    ${viewedNotDl ? `<p class="cc-note">${icon("info")}<span>${viewedNotDl} active deliver${viewedNotDl === 1 ? "y has" : "ies have"} been opened but not downloaded — worth a nudge before ${viewedNotDl === 1 ? "it expires" : "they expire"}.</span></p>` : ""}
    <p class="cc-fineprint">Client deliveries only (PhotoshopBattles images are public direct links and are excluded). “Opened” means the link was loaded at least once; a view is counted on every page load, including repeats.${truncated ? ` Based on the ${deliveries.length} most recent of ${overviewTotal} deliveries.` : ""}</p>`;
}

/* ------------------------------------------------------- analytics: sources */
export function renderSources(deliveries) {
  const host = $("cc-sources-body");
  if (!host) return;
  if (!deliveries.length) { host.innerHTML = `<p class="cc-empty">No deliveries yet.</p>`; return; }
  const groups = new Map();
  deliveries.forEach(d => {
    const key = cfg.groupOf(d);
    const g = groups.get(key) || { key, label: cfg.labelOf(d), n: 0, views: 0, downloads: 0 };
    g.n += 1; g.views += Number(d.view_count || 0); g.downloads += Number(d.download_count || 0);
    groups.set(key, g);
  });
  const rows = [...groups.values()].sort((a, b) => b.views - a.views || b.n - a.n);
  const maxViews = Math.max(1, ...rows.map(r => r.views));
  host.innerHTML = `<div class="cc-table-wrap"><table class="cc-table">
      <caption class="cc-sr">Deliveries, views and downloads by delivery type</caption>
      <thead><tr><th scope="col">Type</th><th scope="col" class="num">Deliveries</th><th scope="col">Views</th><th scope="col" class="num">Downloads</th><th scope="col" class="num">Per 100 views</th></tr></thead>
      <tbody>${rows.map(r => `<tr><th scope="row">${escapeHtml(r.label)}</th><td class="num">${nf(r.n)}</td>
        <td><div class="cc-inline-bar"><span style="width:${Math.round((r.views / maxViews) * 100)}%"></span><b>${nf(r.views)}</b></div></td>
        <td class="num">${nf(r.downloads)}</td><td class="num">${formatRate(r.views, r.downloads)}</td></tr>`).join("")}</tbody></table></div>
    <p class="cc-fineprint">“Per 100 views” is downloads ÷ views × 100. Views include repeat visits, so it is a ratio of events, not a share of people. Higher numbers mean more of the page loads ended in a download; this can't tell you why.</p>`;
}

/* --------------------------------------------------- analytics: site pages */
const PAGE_LABELS = { homepage: "Home", services: "Services", portfolio: "Portfolio", tools: "Tools (Image Inspector, Creative Assistant)", guides: "Guides", about: "About", support: "Support", contact: "Contact", deliver: "Delivery pages (client views)" };

export async function renderPages() {
  const host = $("cc-pages-body");
  if (!host) return;
  host.innerHTML = `<p class="cc-muted">Loading…</p>`;
  let pages;
  try { ({ pages } = await fetchPageAnalytics()); }
  catch (e) { host.innerHTML = `<p class="cc-inline-error" role="alert">${escapeHtml(e?.message || "Could not load page views.")}</p>`; return; }
  const site = pages.filter(p => p.page !== "deliver");
  const total = site.reduce((t, p) => t + p.views, 0);
  if (!total) {
    host.innerHTML = `<p class="cc-empty">No public page views recorded yet.</p>
      <p class="cc-fineprint">Public pages report a single anonymous page-view (which page, which day) through <code>js/pageview.js</code>. Until that script is live on the site and visitors arrive, this stays empty — it is never estimated.</p>`;
    return;
  }
  const max = Math.max(...pages.map(p => p.views));
  const top = site[0];
  host.innerHTML = `<ul class="cc-pagelist">${pages.map(p => `<li><span class="cc-pl-name">${escapeHtml(PAGE_LABELS[p.page] || p.page)}</span><div class="cc-inline-bar"><span style="width:${Math.round((p.views / max) * 100)}%"></span><b>${nf(p.views)}</b></div></li>`).join("")}</ul>
    <p class="cc-note">${icon("info")}<span>${escapeHtml(PAGE_LABELS[top.page] || top.page)} is the most-viewed public page: ${nf(top.views)} of ${nf(total)} page views (${Math.round((top.views / total) * 100)}%) in the last 30 days.</span></p>
    <p class="cc-fineprint">Last 30 days. A page is counted once per browser session; no cookies, IP addresses or personal data are stored, and visitors who send Do Not Track or Global Privacy Control are not counted. Numbers are page loads, not unique people.</p>`;
}

/* ------------------------------------------ analytics: how it gets shared */
const SHARE_METHOD_LABELS = { native: "System share sheet", copy: "Copied link", whatsapp: "WhatsApp", facebook: "Facebook", x: "X (Twitter)", reddit: "Reddit" };

export async function renderShares() {
  const host = $("cc-shares-body");
  if (!host) return;
  let shares;
  try { shares = await fetchShareAnalytics(); }
  catch (e) { host.innerHTML = `<p class="cc-inline-error" role="alert">${escapeHtml(e?.message || "Could not load share analytics.")}</p>`; return; }

  const t = shares.totals || {};
  const set = (id, val) => { const el = $(id); if (el) el.textContent = nf(val); };
  set("share-today", t.today ?? 0); set("share-7d", t.last_7d ?? 0); set("share-month", t.month ?? 0); set("share-total", t.total ?? 0);

  const total = t.total ?? 0;
  if (!total) {
    host.innerHTML = `<p class="cc-empty">No delivery has been shared yet.</p>
      <p class="cc-fineprint">When someone taps <strong>Share</strong> on a delivery page or a PhotoshopBattles image and copies the link, opens the system share sheet, or opens a social sheet, the method is counted here as an aggregate (method, day, page type) — never per visitor.</p>`;
    return;
  }

  const methods = Object.entries(shares.methods || {}).sort((a, b) => b[1] - a[1]);
  const maxMethod = Math.max(1, ...methods.map(([, n]) => n));
  const pt = shares.page_types || { deliveries: 0, photoshop_battles: 0 };
  const top = (shares.top || []);
  const topList = top.length
    ? `<div class="cc-table-wrap"><table class="cc-table"><caption class="cc-sr">Deliveries with the most shares</caption>
        <thead><tr><th scope="col">Delivery</th><th scope="col">Page</th><th scope="col" class="num">Shares</th></tr></thead>
        <tbody>${top.map((r, i) => `<tr><td><span title="${escapeHtml(r.delivery_id)}" class="cc-delid">${i + 1}.</span> ${escapeHtml(r.project_name || r.delivery_id)}</td><td>${r.page_type === "photoshop_battles" ? "PhotoshopBattles" : "Delivery"}</td><td class="num">${nf(r.shares)}</td></tr>`).join("")}</tbody></table></div>`
    : "";

  host.innerHTML = `
    <ul class="cc-pagelist">${methods.map(([m, n]) => `<li><span class="cc-pl-name">${escapeHtml(SHARE_METHOD_LABELS[m] || m)}</span><div class="cc-inline-bar"><span style="width:${Math.round((n / maxMethod) * 100)}%"></span><b>${nf(n)}</b></div></li>`).join("")}</ul>
    <p class="cc-note">${icon("info")}<span>${nf(pt.deliveries ?? 0)} shares on client deliveries and ${nf(pt.photoshop_battles ?? 0)} on PhotoshopBattles pages across ${nf(total)} total.</span></p>
    ${topList}
    <p class="cc-fineprint">A copy or a completed system share counts as a share; opening a WhatsApp / Facebook / X / Reddit sheet is recorded as an attempt, since we can't confirm whether the post was published. Counts come from the delivery page, not from deleted deliveries.</p>`;
}

/* -------------------------------------------------- analytics: 30-day summary */
export function renderAnalyticsTrend() {
  const s30 = insightsSnapshot().series30;
  const head = $("cc-analytics-headline"), chart = $("cc-analytics-trend");
  if (!s30 || !head || !chart) return;
  const v = s30.reduce((t, p) => t + p.views, 0), d = s30.reduce((t, p) => t + p.downloads, 0);
  const best = s30.reduce((b, p) => (p.views > (b?.views ?? -1) ? p : b), null);
  head.textContent = v || d ? `${nf(v)} views and ${nf(d)} downloads in the last 30 days${best?.views ? ` — busiest day ${best.label.slice(5)} (${nf(best.views)} views).` : "."}` : "No delivery activity recorded in the last 30 days.";
  chart.innerHTML = trendChart(s30);
}

/* ----------------------------------------------------------- orchestration */
export function initCommandCentre(options) {
  cfg = { ...cfg, ...options };
  $("cc-attention-list")?.addEventListener("click", event => {
    const b = event.target.closest("[data-att]");
    if (b) cfg.onAction(b.dataset.att, b.dataset.id || null);
  });
}

/** Refreshes everything on the Overview tab that isn't owned by dashboard.js / insights.js. */
export async function refreshCommandCentre({ deliveries, overview, session }) {
  renderTopbar({ session, health: null });
  const health = await pingHealth();
  renderTopbar({ session, health });
  renderHealth({ health, overview, session });
  renderAttention({ deliveries, overview, health });
  renderKpis(overview);
  return health;
}

export async function refreshAnalyticsExtras({ deliveries, overview }) {
  renderAnalyticsTrend();
  renderFunnel(deliveries, overview?.deliveries?.total);
  renderSources(deliveries);
  await renderPages();
  await renderShares();
}
