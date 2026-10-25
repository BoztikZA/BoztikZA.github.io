function renderPages() {
  const host = $("cc-site-pages");
  if (!host) return;
  const w = model.website;
  if (!w.available) { host.innerHTML = `<p class="cc-empty">Website page views could not be loaded.</p>`; return; }

  const rows = [...w.pages];
  rows.sort((a, b) => b.views - a.views || (KEY_PAGES.indexOf(a.page) + 1 || 99) - (KEY_PAGES.indexOf(b.page) + 1 || 99));

  const searchInput = $("cc-page-search");
  const currentTerm = (searchInput && searchInput.value) ? searchInput.value.toLowerCase() : "";
  if (currentTerm) {
    const filtered = rows.filter(r => r.label.toLowerCase().includes(currentTerm) || r.page.toLowerCase().includes(currentTerm));
    if (filtered.length) rows.splice(0, rows.length, ...filtered); else rows.splice(0, rows.length);
  }

  const max = Math.max(1, ...rows.map(r => r.views));
  const flow = model.pageFlow || [];

  let rowsHtml = "";
  if (rows.length === 0) {
    rowsHtml = `<tr><td colspan="4" class="cc-muted">No pages match "` + escapeHtml(currentTerm) + `".</td></tr>`;
  } else {
    rowsHtml = rows.map(r => {
      const delta = rowChange(r.views, r.prev);
      const pathFlow = flow.filter(f => f.path.startsWith(r.page + " →") || f.path.endsWith(" → " + r.page));
      const nextHint = pathFlow.length ? ` · most common onward: ` + escapeHtml(pathFlow.sort((a, b) => b.sessions - a.sessions)[0].path.split(" → ").pop()) : "";
      return `<tr data-page="` + escapeHtml(r.page) + `" class="cc-page-row" role="button" tabindex="0" aria-label="` + escapeHtml(r.label) + `: ` + fmt(r.views) + ` views` + nextHint + `">
        <th scope="row">` + escapeHtml(r.label) + `<span class="cc-muted cc-page-key"> · ` + escapeHtml(r.page) + `</span></th>
        <td>` + (r.views ? `<div class="cc-inline-bar"><span style="width:` + Math.round((r.views / max) * 100) + `%"></span><b>` + fmt(r.views) + `</b></div>` : `<span class="cc-muted">No views counted</span>`) + `</td>
        <td class="num">` + (r.views ? `${pctOf(r.views, w.total)}%` : "—") + `</td>
        <td class="num">` + delta + `</td>
      </tr>`;
    }).join("");
  }

  host.innerHTML = `
    <div class="cc-page-controls">
      <label class="cc-field-label"><span class="cc-i" aria-hidden="true"><use href="#i-search"/></span><span class="cc-sr">Search pages</span><input type="search" id="cc-page-search" class="cc-input" placeholder="Search pages…" value="` + escapeHtml(currentTerm) + `" aria-label="Filter pages by name or path"/></label>
      <span class="cc-muted cc-page-count">` + rows.length + ` page` + (rows.length === 1 ? "" : "s") + (currentTerm ? ` matching "` + escapeHtml(currentTerm) + `"` : "") + `</span>
    </div>
    <div class="cc-table-wrap"><table class="cc-table">
      <caption class="cc-sr">Public website pages ranked by counted page views for the selected period</caption>
      <thead><tr><th scope="col">Page</th><th scope="col" class="num">Page views</th><th scope="col" class="num">Share</th><th scope="col" class="num">vs previous</th></tr></thead>
      <tbody>` + rowsHtml + `</tbody></table></div>
    <p class="cc-fineprint">Page loads counted by Boztik's own counter` + (w.dataSince ? ` since ` + escapeHtml(w.dataSince) : "") + ` — not unique people, and visitors who send Do Not Track / Global Privacy Control are not counted. Entrances, engagement and onward clicks per page exist only in GA4 and are not shown here. Creative Toolkit views are only recorded once the Worker update is deployed. Rows are clickable to inspect visitor paths.</p>
  `;
  wirePageRows();
}

function wirePageRows() {
  document.querySelectorAll(".cc-page-row").forEach(row => {
    const onEnter = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPageDetail(row.dataset.page); } };
    row.addEventListener("click", () => openPageDetail(row.dataset.page));
    row.addEventListener("keydown", onEnter);
  });
}

function openPageDetail(pageKey) {
  const flow = (model && model.pageFlow) || [];
  const fromThis = flow.filter(f => f.path.startsWith(pageKey + " →")).sort((a, b) => b.sessions - a.sessions);
  const toThis = flow.filter(f => f.path.endsWith(" → " + pageKey)).sort((a, b) => b.sessions - a.sessions);
  const detail = $("cc-page-detail");
  if (!detail) return;
  const w = model.website;
  const row = w.pages.find(p => p.page === pageKey);
  const label = PAGE_LABELS[pageKey] || pageKey;
  detail.innerHTML = `
    <h3 class="cc-subhead">` + escapeHtml(label) + `</h3>
    <p class="cc-muted">` + escapeHtml(pageKey) + ` — ` + fmt(row ? row.views : 0) + ` counted page view` + (row && row.views !== 1 ? "s" : "") + ` in this period.</p>
    ` + (fromThis.length ? `<h4 class="cc-subhead--small">Visitors most often go <b>from</b> this page to:</h4><ul class="cc-flow-list">` + fromThis.slice(0, 5).map(f => `<li><span class="cc-flow-path">` + escapeHtml(f.path.split(" → ").pop()) + `</span><span class="cc-flow-sessions">` + fmt(f.sessions) + ` sessions</span></li>`).join("") + `</ul>` : `<p class="cc-muted">No recorded onward transitions from this page.</p>`) + `
    ` + (toThis.length ? `<h4 class="cc-subhead--small">Visitors most often arrive <b>at</b> this page from:</h4><ul class="cc-flow-list">` + toThis.slice(0, 5).map(f => `<li><span class="cc-flow-path">` + escapeHtml(f.path.split(" → ").shift()) + `</span><span class="cc-flow-sessions">` + fmt(f.sessions) + ` sessions</span></li>`).join("") + `</ul>` : `<p class="cc-muted">No recorded incoming transitions to this page.</p>`) + `
  </div>`;
  detail.hidden = false;
  detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
