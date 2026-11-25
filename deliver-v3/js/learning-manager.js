// Command Centre → Learning. Uses the existing admin session (Bearer token from the Worker login) — no separate auth.
// Everything is rendered with textContent; learner tokens/recovery codes are never requested from the API.
import { config } from "./config.js";
import { authHeaders, onAuthChange } from "./auth.js";

const root = document.getElementById("learning-root");
if (root) init();

function init() {
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v; else if (k === "text") el.textContent = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? "" : String(v));
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  };
  const when = (u) => (u ? new Date(u * 1000).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" }) : "—");
  const money = (c) => `$${(c / 100).toFixed(2)}`;
  const bytes = (n) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

  async function api(path, init = {}) {
    const r = await fetch(`${config.apiBaseUrl}/api/admin/learning/${path}`, { ...init, headers: { ...authHeaders(), ...(init.body ? { "Content-Type": "application/json" } : {}) } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
    return d;
  }

  const views = { overview, courses, certificates, learners, money: contributionsAndStorage };
  const nav = h("div", { class: "lm-nav", role: "tablist", "aria-label": "Learning sections" });
  const body = h("div", { class: "lm-body", "aria-live": "polite" });
  let active = "overview", signedIn = false;
  [["overview", "Overview"], ["courses", "Courses"], ["certificates", "Certificates"], ["learners", "Learner sessions"], ["money", "Contributions & storage"]].forEach(([id, label]) =>
    nav.append(h("button", { type: "button", class: "dash-btn lm-tab", role: "tab", "data-v": id, "aria-selected": id === active ? "true" : "false", onclick: () => go(id), text: label })));
  root.replaceChildren(nav, body);

  function go(id) {
    active = id;
    nav.querySelectorAll(".lm-tab").forEach((b) => { const on = b.dataset.v === id; b.classList.toggle("is-active", on); b.setAttribute("aria-selected", on); });
    if (!signedIn) { body.replaceChildren(h("p", { class: "cc-muted", text: "Sign in to the Command Centre to see Learning data." })); return; }
    body.replaceChildren(h("p", { class: "cc-muted", text: "Loading…" }));
    views[id]().catch((e) => body.replaceChildren(h("p", { class: "lm-error", role: "alert", text: e.message })));
  }
  document.getElementById("tab-learning")?.addEventListener("click", () => go(active));
  onAuthChange((s) => { signedIn = !!s; if (!root.closest("[hidden]")) go(active); });
  signedIn = !!authHeaders().Authorization;

  const kpi = (label, value, def, tone) => h("article", { class: `cc-kpi${tone ? " lm-" + tone : ""}` }, h("header", { text: label }), h("strong", { class: "cc-kpi-val", text: value ?? "—" }), h("p", { class: "lm-def", text: def }));
  const card = (title, ...kids) => h("article", { class: "cc-card lm-card" }, h("div", { class: "cc-card-head" }, h("h3", { text: title })), ...kids);
  const table = (heads, rows) => h("div", { class: "lm-tablewrap" }, h("table", { class: "lm-table" }, h("thead", {}, h("tr", {}, heads.map((x) => h("th", { scope: "col", text: x })))), h("tbody", {}, rows.length ? rows : h("tr", {}, h("td", { colspan: heads.length, class: "cc-muted", text: "Nothing to show yet." })))));
  const bar = (pct, tone) => h("span", { class: `lm-bar${tone ? " " + tone : ""}`, role: "img", "aria-label": `${pct}%` }, h("i", { style: `width:${Math.max(0, Math.min(100, pct))}%` }));

  function usageMeter(u) {
    const tone = u.level === "ok" ? "" : u.level === "notice" ? "warn" : "bad";
    return h("div", {}, h("div", { class: "lm-usage" }, bar(u.used_percent, tone), h("strong", { text: `${u.used_percent}%` })),
      h("p", { class: "cc-muted", text: `${bytes(u.used_bytes)} of ${bytes(u.allocation_bytes)} Learning allocation (separate from the 3 GB delivery allocation). Level: ${u.level}.${u.full ? " New learners are paused until space is freed." : ""}` }),
      h("p", { class: "cc-muted", text: "Warnings at 70%, 85% and 95%; new learners pause at 100%. Estimate based on stored text plus row and index overhead." }));
  }

  async function overview() {
    const d = await api("overview"), D = d.definitions;
    const pp = d.contributions.paypal;
    body.replaceChildren(
      h("div", { class: "cc-kpis" },
        kpi("Learners", d.learners.total, D.learners), kpi("Active now", d.learners.activeNow, D.activeSessions, d.learners.activeNow ? "ok" : ""), kpi("Active, 7 days", d.learners.active7d, D.activeLearners7d),
        kpi("New, 30 days", d.learners.new30d, "Sessions created in the last 30 days."),
        kpi("Enrolments", d.enrolments.total, D.enrolments), kpi("Started learning", d.enrolments.started, D.started), kpi("Courses passed", d.enrolments.passed, D.coursesPassed),
        kpi("Attempts submitted", d.attempts.submitted, D.attemptsSubmitted), kpi("Pass rate", d.attempts.passRatePercent == null ? "—" : `${d.attempts.passRatePercent}%`, D.passRate),
        kpi("Certificates issued", d.certificates.valid, D.certificatesIssued), kpi("Certificates revoked", d.certificates.revoked, "Withdrawn by an admin; they fail public verification."),
        kpi("Contributions (live)", `${d.contributions.live.completed} · ${money(d.contributions.live.completedCents)}`, D.contributions)),
      h("div", { class: "lm-grid" },
        card("Learning storage", usageMeter(d.usage)),
        card("PayPal contributions", h("p", { class: "cc-muted", text: pp.enabled ? `Enabled in ${pp.env} mode.${pp.env === "sandbox" ? " Test mode: no real money moves." : ""}` : `Off. Missing: ${pp.missing.join(", ") || "nothing"}. Certificates and results never depend on this.` }),
          h("p", { class: "cc-muted", text: `Sandbox (test) confirmations: ${d.contributions.sandbox.completed} — never counted as income.` }))),
      card("Recent activity", table(["When", "Event", "Course", "Detail"], d.recentActivity.map((r) => h("tr", {}, h("td", { text: when(r.at) }), h("td", { text: r.kind.replace(/_/g, " ") }), h("td", { text: r.course || "" }), h("td", { text: r.detail || "" }))))),
      card("What these numbers mean", h("dl", { class: "lm-defs" }, Object.entries(D).map(([k, v]) => [h("dt", { text: k.replace(/([A-Z])/g, " $1").toLowerCase() }), h("dd", { text: v })]))));
  }

  async function courses() {
    const d = await api("courses");
    body.replaceChildren(...d.courses.map((c) => card(c.title,
      h("div", { class: "cc-kpis" }, kpi("Enrolments", c.enrolments, "Learners enrolled."), kpi("Started", c.learnersStarted, "Learners with at least one lesson done."), kpi("Finished lessons", c.lessonsFinished, "Assessment unlocked."),
        kpi("Passed", c.passed, "Passed the assessment."), kpi("Pass rate", c.passRatePercent == null ? "—" : `${c.passRatePercent}%`, `${c.attemptsPassed} of ${c.attemptsSubmitted} attempts.`), kpi("Avg written score", c.averageWrittenPercent == null ? "—" : `${c.averageWrittenPercent}%`, `Pass mark ${c.passMark}%.`),
        kpi("Completion rate", c.completionRatePercent == null ? "—" : `${c.completionRatePercent}%`, "Passed ÷ enrolled."), kpi("Certificates", c.certificates, "Valid, not revoked.")),
      c.biggestDropOff ? h("p", { class: "lm-note", text: `Biggest drop-off: ${c.biggestDropOff.module.toUpperCase()} — ${c.biggestDropOff.lostVsPreviousPercent}% fewer learners reached it than the module before.` }) : h("p", { class: "cc-muted", text: "No drop-off to report yet." }),
      h("h4", { text: "Drop-off by module (learners who completed at least one lesson in it)" }),
      table(["Module", "Learners reached", "", "Lost vs previous"], c.modules.map((m) => h("tr", {}, h("td", { text: m.module.toUpperCase() }), h("td", { text: m.learnersReached }), h("td", {}, bar(c.learnersStarted ? Math.round((m.learnersReached / c.learnersStarted) * 100) : 0)), h("td", { text: m.lostVsPreviousPercent == null ? "—" : `${m.lostVsPreviousPercent}%` })))),
      h("details", {}, h("summary", { text: "Lesson completions" }), table(["Lesson", "Completed by"], c.lessons.map((l) => h("tr", {}, h("td", { text: l.id }), h("td", { text: l.completed }))))))));
  }

  async function certificates() {
    const q = h("input", { type: "search", placeholder: "Search ID, name or course", "aria-label": "Search certificates" });
    const st = h("select", { "aria-label": "Status" }, h("option", { value: "", text: "All" }), h("option", { value: "valid", text: "Valid" }), h("option", { value: "revoked", text: "Revoked" }));
    const out = h("div"), detail = h("div");
    const load = async () => {
      const d = await api(`certificates?q=${encodeURIComponent(q.value)}&status=${st.value}`);
      out.replaceChildren(h("p", { class: "cc-muted", text: `${d.total} certificate${d.total === 1 ? "" : "s"}` }), table(["ID", "Name", "Course", "Score", "Issued", "Status", "PDF / checks", ""], d.certificates.map((c) => h("tr", {},
        h("td", { text: c.certificate_id }), h("td", { text: c.learner_name }), h("td", { text: c.course_title }), h("td", { text: `${c.score_percent}%${c.practical_percent != null ? ` / ${c.practical_percent}%` : ""}` }), h("td", { text: when(c.issued_at) }),
        h("td", {}, h("span", { class: `lm-pill ${c.revoked_at ? "bad" : "ok"}`, text: c.revoked_at ? "Revoked" : "Valid" })), h("td", { text: `${c.download_count} / ${c.verify_count}` }),
        h("td", {}, h("button", { class: "dash-btn dash-compact", type: "button", text: "Verify", onclick: () => verify(c.certificate_id) }), " ", c.revoked_at ? null : h("button", { class: "dash-btn dash-compact lm-danger", type: "button", text: "Revoke", onclick: () => revoke(c.certificate_id) }))))));
    };
    const verify = async (id) => { let c; try { ({ certificate: c } = await api(`certificates/${encodeURIComponent(id)}`)); } catch (e) { detail.replaceChildren(h("p", { class: "lm-error", role: "alert", text: e.message })); return; } detail.replaceChildren(card(`Certificate ${c.certificate_id}`, h("dl", { class: "lm-defs" }, [["Status", c.status], ["Awarded to", c.learner_name], ["Course", c.course_title], ["Written score", `${c.score_percent}% (pass ${c.pass_mark}%)`], ["Practical", c.practical_percent == null ? "n/a" : `${c.practical_percent}%`], ["Issued", when(c.issued_at)], ["Learner shows name publicly", c.public_details ? "Yes" : "No"], ["Revoked", c.revoked_at ? `${when(c.revoked_at)} — ${c.revoked_reason}` : "No"]].map(([k, v]) => [h("dt", { text: k }), h("dd", { text: v })])))); };
    const revoke = async (id) => { const reason = prompt(`Revoke ${id}? Give a reason (kept in the audit log):`); if (!reason) return; try { await api(`certificates/${encodeURIComponent(id)}/revoke`, { method: "POST", body: JSON.stringify({ reason }) }); await load(); } catch (e) { alert(e.message); } };
    const f = h("form", { class: "lm-toolbar", onsubmit: (e) => { e.preventDefault(); load().catch((x) => out.replaceChildren(h("p", { class: "lm-error", text: x.message }))); } }, q, st, h("button", { class: "dash-btn dash-btn-primary", type: "submit", text: "Search" }));
    body.replaceChildren(card("Certificates", f, out), detail); await load();
  }

  async function learners() {
    const q = h("input", { type: "search", placeholder: "Search name, email or reference", "aria-label": "Search learners" });
    const out = h("div");
    const load = async () => {
      const d = await api(`learners?q=${encodeURIComponent(q.value)}`);
      out.replaceChildren(h("p", { class: "cc-muted", text: `Active now = private link used in the last ${d.activeWindowMinutes} minutes. Private-link tokens and recovery codes are never shown.` }),
        table(["Ref", "Name", "Email", "Country", "Joined", "Last active", "Enrol / attempts / certs", "State", ""], d.learners.map((l) => h("tr", {},
          h("td", { text: l.ref }), h("td", { text: l.name }), h("td", { text: l.email || "—" }), h("td", { text: l.country || "—" }), h("td", { text: when(l.created_at) }), h("td", { text: when(l.last_seen_at) }), h("td", { text: `${l.enrolments} / ${l.attempts} / ${l.certificates}` }),
          h("td", {}, h("span", { class: `lm-pill ${l.revoked_at ? "bad" : l.activeNow ? "ok" : ""}`, text: l.revoked_at ? "Revoked" : l.activeNow ? "Active now" : "Idle" })),
          h("td", {}, h("button", { class: `dash-btn dash-compact${l.revoked_at ? "" : " lm-danger"}`, type: "button", text: l.revoked_at ? "Restore" : "Revoke link", onclick: () => act(l) }))))));
    };
    const act = async (l) => {
      const body = {}; if (!l.revoked_at) { const r = prompt(`Revoke the private link for ${l.ref}? The learner will lose access until restored. Reason:`); if (!r) return; body.reason = r; }
      try { await api(`learners/${encodeURIComponent(l.ref)}/${l.revoked_at ? "restore" : "revoke"}`, { method: "POST", body: JSON.stringify(body) }); await load(); } catch (e) { alert(e.message); }
    };
    body.replaceChildren(card("Learner sessions", h("form", { class: "lm-toolbar", onsubmit: (e) => { e.preventDefault(); load(); } }, q, h("button", { class: "dash-btn dash-btn-primary", type: "submit", text: "Search" })), out)); await load();
  }

  async function contributionsAndStorage() {
    const [u, c, a] = await Promise.all([api("usage?refresh=1"), api("contributions"), api("audit")]);
    body.replaceChildren(
      card("Learning storage", usageMeter(u.usage), table(["Table", "Rows", "Estimated size"], Object.entries(u.usage.tables).map(([t, v]) => h("tr", {}, h("td", { text: t }), h("td", { text: v.rows }), h("td", { text: bytes(v.bytes) }))))),
      card("Contributions", h("p", { class: "cc-muted", text: c.paypal.enabled ? `PayPal ${c.paypal.env} mode is on.` : `PayPal is off (missing: ${c.paypal.missing.join(", ")}).` }),
        table(["Created", "Course", "Amount", "Mode", "Status"], c.contributions.map((x) => h("tr", {}, h("td", { text: when(x.created_at) }), h("td", { text: x.course_slug || "" }), h("td", { text: money(x.amount_cents) }), h("td", { text: x.paypal_env === "live" ? "Live" : "Sandbox (test)" }), h("td", { text: x.status }))))),
      card("Audit log (latest 100)", table(["When", "Admin", "Action", "Target", "Detail"], a.entries.map((e) => h("tr", {}, h("td", { text: when(e.at) }), h("td", { text: e.actor }), h("td", { text: e.action }), h("td", { text: e.target || "" }), h("td", { text: e.detail || "" }))))));
  }
}
