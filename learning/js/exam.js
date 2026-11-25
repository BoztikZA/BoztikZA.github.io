// Assessment, result, certificate claim and the optional contribution screen.
// Questions arrive from the server for ONE in-progress attempt. Marking happens on the server; the browser never holds an answer key.
import { api, session, h, $, clear, inline, loadCourse, toast, copyText, fmtDate, dollars, catalogue, courseCard } from "./core.js";

const app = $("#app");
const params = new URLSearchParams(location.search);
const slug = params.get("c") || "";
let course, meta, attempt, answers = {}, practical = {};
const draftKey = () => `bzl.draft.${attempt.attemptId}`;
const saveDraft = () => { try { sessionStorage.setItem(draftKey(), JSON.stringify({ answers, practical })); } catch { /* ignore */ } };
const loadDraft = () => { try { const d = JSON.parse(sessionStorage.getItem(draftKey()) || "null"); if (d) { answers = d.answers || {}; practical = d.practical || {}; } } catch { /* ignore */ } };

(async function boot() {
  if (params.get("a") && params.get("view") === "result") return resultFromId(params.get("a"));
  try { course = await loadCourse(slug); meta = (await catalogue()).find((c) => c.slug === slug); } catch { return msg("We could not find that course.", "/learning/", "Browse courses"); }
  document.title = `Assessment — ${course.title}`;
  if (!session.get()) return msg("Open your private link or start the course first — your progress decides when the assessment unlocks.", `/learning/courses/${slug}/`, "Go to the course");
  intro();
})();
window.addEventListener("bzl:session-lost", () => msg("Your private link is no longer valid on this device.", "/learning/dashboard/", "Recover my session"));

function msg(text, href, label) {
  clear(app).append(h("div", { class: "lh-panel lh-narrow" }, h("p", { text }), h("p", { style: "margin-top:16px" }, h("a", { class: "lh-btn lh-btn--primary", href, text: label }))));
}

async function intro() {
  let p;
  try { p = await api("GET", `courses/${slug}`); } catch (e) { return msg(e.message, "/learning/dashboard/", "My learning"); }
  clear(app);
  const locked = !p.assessmentUnlocked;
  app.append(h("div", { class: "lh-narrow", style: "display:grid;gap:20px;margin-inline:auto" },
    h("span", { class: "lh-eyebrow", text: "Assessment" }), h("h1", { text: course.title }),
    h("div", { class: "lh-panel" },
      h("h2", { style: "font-size:1.2rem;margin-bottom:12px", text: "Before you start" }),
      h("ul", { class: "lh-outcomes", style: "grid-template-columns:1fr" },
        h("li", { text: `${meta.questionCount} questions covering every module. Pass mark: ${meta.passMark}%.` }),
        meta.practicalPassMark != null ? h("li", { text: `Plus a practical with 8 tasks on a fresh data file. You need ${meta.practicalPassMark}% (6 of 8) on it as well.` }) : null,
        h("li", { text: "Take your time. You have three hours, and you can leave and come back to the same attempt." }),
        h("li", { text: "Your answers are marked on our server. Questions and options are shuffled each attempt." }),
        h("li", { text: "If you do not pass, review the lessons and retake it. Your certificate is only issued once you pass, and never depends on a payment." }))),
    locked ? h("div", { class: "lh-note lh-note--warn" }, `Finish all ${p.lessonsTotal} lessons to unlock the assessment — you have completed ${p.completedLessons.length}.`) : null,
    p.attempts.some((a) => a.status === "submitted") ? h("div", { class: "lh-panel" }, h("h3", { style: "margin-bottom:10px", text: "Your previous attempts" }), h("ul", { style: "list-style:none;display:grid;gap:8px" }, p.attempts.filter((a) => a.status === "submitted").map((a) => h("li", {}, h("a", { href: `?a=${a.attemptId}&view=result`, text: `${fmtDate(a.submittedAt)} — ${a.writtenPercent}%${a.practicalPercent != null ? ` written, ${a.practicalPercent}% practical` : ""} — ${a.passed ? "passed" : "not passed"}` }))))) : null,
    h("div", { class: "lh-btnrow" },
      locked ? h("a", { class: "lh-btn lh-btn--primary", href: `/learning/learn/?c=${slug}`, text: "Back to the lessons" }) : h("button", { class: "lh-btn lh-btn--primary", id: "begin", type: "button", text: p.attempts.some((a) => a.status === "in_progress") ? "Resume my attempt" : "Begin the assessment", onclick: start }),
      h("a", { class: "lh-btn lh-btn--quiet", href: `/learning/courses/${slug}/`, text: "Course page" }))));
}

async function start() {
  const b = $("#begin"); b.disabled = true;
  try { attempt = (await api("POST", `courses/${slug}/attempts`, {})).attempt; loadDraft(); questions(); }
  catch (e) { toast(e.message); b.disabled = false; }
}

function questions() {
  clear(app); app.classList.remove("lh-wrap", "lh-section"); app.style.padding = "0";
  const counter = h("strong", { id: "count" });
  const submit = h("button", { class: "lh-btn lh-btn--primary", type: "button", text: "Submit for marking", onclick: onSubmit });
  const total = attempt.questions.length;
  const update = () => { const n = attempt.questions.filter((q) => (answers[q.id] || []).length).length; counter.textContent = `${n} of ${total} answered`; };
  const list = h("div", { class: "lh-wrap lh-narrow", style: "padding-block:24px 60px" },
    h("div", { class: "lh-note", style: "margin-bottom:18px", text: "Choose the best answer for each question. Where a question says “select all that apply”, choose every correct option. Your selections are kept if you refresh this page." }),
    attempt.questions.map((q, i) => {
      const name = `q-${q.id}`;
      const opts = q.options.map((o, oi) => h("label", { class: "lh-opt" }, h("input", { type: q.multi ? "checkbox" : "radio", name, value: oi, checked: (answers[q.id] || []).includes(oi) || null, onchange: () => { answers[q.id] = $$checked(name); saveDraft(); update(); } }), h("span", {}, inline(o))));
      return h("section", { class: "lh-q", "aria-labelledby": `qp-${q.id}` }, h("span", { class: "num", text: `Question ${i + 1} of ${total}${q.multi ? " · select all that apply" : ""}` }), h("p", { class: "prompt", id: `qp-${q.id}` }, inline(q.prompt)), h("div", { class: "lh-opts", role: q.multi ? "group" : "radiogroup", "aria-labelledby": `qp-${q.id}` }, opts));
    }),
    attempt.practical ? practicalSection() : null,
    h("div", { class: "lh-btnrow", style: "margin-top:26px" }, submit, h("a", { class: "lh-btn lh-btn--quiet", href: "/learning/dashboard/", text: "Leave and come back later" })));
  app.append(h("div", { class: "lh-exambar" }, h("span", { text: course.title }), counter), list);
  update();
}
const $$checked = (name) => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => Number(i.value));

function practicalSection() {
  const p = attempt.practical;
  const download = () => { const url = URL.createObjectURL(new Blob([p.csv], { type: "text/csv" })); const a = h("a", { href: url, download: "boztik-cafe-practical.csv" }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  return h("section", { class: "lh-q", style: "margin-top:28px;border-color:var(--lh-line-neon)" },
    h("span", { class: "num", text: "Practical" }), h("h2", { style: "font-size:1.3rem;margin:6px 0 10px", text: "Eight questions about your own data file" }),
    h("p", { class: "lh-muted", text: "Download this file, open it in your spreadsheet, and answer the questions below. This file is unique to this attempt. Clean it first: remove blank rows, count a repeated OrderID once, treat regions that differ only by capitals or spaces as the same, and calculate revenue as Quantity × UnitPrice." }),
    h("p", { style: "margin:12px 0" }, h("button", { class: "lh-btn", type: "button", onclick: download, text: "Download practical data (CSV)" })),
    h("div", { class: "lh-prac-grid" }, p.tasks.map((t, i) => h("div", { class: "lh-field" }, h("label", { for: `p-${t.id}` }, `${i + 1}. `, inline(t.prompt)), h("input", { id: `p-${t.id}`, type: "text", inputmode: t.kind === "text" ? "text" : "decimal", autocomplete: "off", maxlength: 80, value: practical[t.id] || "", oninput: (e) => { practical[t.id] = e.target.value; saveDraft(); } }), h("small", { text: t.hint })))));
}

async function onSubmit() {
  const unanswered = attempt.questions.filter((q) => !(answers[q.id] || []).length).length;
  const pracBlank = attempt.practical ? attempt.practical.tasks.filter((t) => !String(practical[t.id] || "").trim()).length : 0;
  const note = [unanswered ? `${unanswered} question${unanswered === 1 ? "" : "s"} unanswered` : "", pracBlank ? `${pracBlank} practical task${pracBlank === 1 ? "" : "s"} blank` : ""].filter(Boolean).join(" and ");
  if (!confirm(note ? `You have ${note}. Unanswered questions score zero. Submit anyway?` : "Submit your answers for marking?")) return;
  try {
    const r = await api("POST", `attempts/${attempt.attemptId}/submit`, { answers, practical });
    try { sessionStorage.removeItem(draftKey()); } catch { /* ignore */ }
    app.classList.add("lh-wrap", "lh-section"); app.style.padding = "";
    result(r.result);
  } catch (e) { toast(e.message); if (e.code === "attempt_expired") intro(); }
}

async function resultFromId(id) {
  if (!session.get()) return msg("Open your private link to see your results.", "/learning/dashboard/", "My learning");
  try { const r = (await api("GET", `attempts/${id}/result`)).result; course = await loadCourse(r.courseSlug); meta = (await catalogue()).find((c) => c.slug === r.courseSlug); result(r); }
  catch (e) { msg(e.message, "/learning/dashboard/", "My learning"); }
}

function result(r) {
  clear(app); window.scrollTo({ top: 0 });
  const modName = (id) => course.modules.find((m) => m.id === id)?.title || id;
  const weak = Object.entries(r.modules).filter(([, m]) => m.total && m.percent < 60);
  const box = h("div", { class: "lh-narrow", style: "display:grid;gap:22px;margin-inline:auto" });
  box.append(...[
    h("span", { class: "lh-eyebrow", text: course.title }),
    h("h1", { text: r.passed ? "You passed. Well done." : "Not passed this time" }),
    h("div", { class: "lh-panel", style: "display:flex;flex-wrap:wrap;gap:24px;align-items:center" },
      h("div", { class: `lh-score${r.passed ? "" : " bad"}`, role: "img", "aria-label": `Written score ${r.written.percent} percent`, text: `${r.written.percent}%` }),
      h("div", {}, h("p", {}, h("strong", { text: `Written: ${r.written.correct} of ${r.written.total} correct` }), ` — pass mark ${r.written.passMark}% (${r.written.passed ? "met" : "not met"})`),
        r.practical ? h("p", { style: "margin-top:6px" }, h("strong", { text: `Practical: ${r.practical.correct} of ${r.practical.total} correct` }), ` — pass mark ${r.practical.passMark}% (${r.practical.passed ? "met" : "not met"})`) : null,
        h("p", { class: "lh-muted", style: "margin-top:8px", text: r.passed ? "Your certificate is ready to claim below." : "That is useful information, not a verdict. Review the topics below, then retake whenever you are ready." }))),
    h("div", { class: "lh-panel" }, h("h2", { style: "font-size:1.2rem;margin-bottom:14px", text: "Results by module" }),
      h("div", { class: "lh-modbars" }, Object.entries(r.modules).map(([id, m]) => h("div", { class: `lh-modbar${m.total && m.percent < 60 ? " weak" : ""}` }, h("span", { class: "t", text: modName(id) }), h("b", { text: `${m.correct}/${m.total}` }), h("div", { class: "lh-bar" }, h("span", { style: `width:${m.percent}%` })))))),
    r.practical ? h("div", { class: "lh-panel" }, h("h2", { style: "font-size:1.2rem;margin-bottom:10px", text: "Practical tasks" }), h("p", { class: "lh-muted", text: "Each task is marked right or wrong. We do not show the correct values, so recheck your cleaning steps and calculations." }), h("p", { style: "margin-top:10px" }, Object.entries(r.practical.perTask).map(([k, ok], i) => h("span", { class: "lh-chip", style: `margin:0 8px 8px 0;${ok ? "border-color:var(--lh-neon);color:var(--lh-neon)" : ""}`, text: `Task ${i + 1}: ${ok ? "correct" : "not correct"}` })))) : null].filter(Boolean));
  if (!r.passed) {
    box.append(h("div", { class: "lh-panel lh-panel--neon" }, h("h2", { style: "font-size:1.2rem;margin-bottom:10px", text: "What to do next" }),
      weak.length ? h("ul", { class: "lh-outcomes", style: "grid-template-columns:1fr" }, weak.map(([id]) => h("li", {}, "Review ", h("a", { href: `/learning/learn/?c=${slug}&l=${course.modules.find((m) => m.id === id).lessons[0].id}`, text: modName(id) })))) : h("p", { class: "lh-muted", text: "Your module scores are fairly even — a steady pass over the lessons will help." }),
      h("div", { class: "lh-btnrow", style: "margin-top:16px" }, h("a", { class: "lh-btn lh-btn--primary", href: `/learning/learn/?c=${slug}`, text: "Review the lessons" }), h("button", { class: "lh-btn", type: "button", text: "Retake the assessment", onclick: () => { history.replaceState(null, "", `?c=${slug}`); intro(); } }))));
  } else {
    const claim = h("div", { id: "claim" }); box.append(claim); renderClaim(claim, r);
  }
  app.append(box);
}

function renderClaim(el, r) {
  clear(el);
  if (r.certificateId) return showCertificate(el, r.certificateId);
  const err = h("p", { class: "lh-error", role: "alert" });
  const s = session.get();
  const form = h("form", { class: "lh-panel lh-panel--neon", novalidate: true },
    h("h2", { style: "font-size:1.3rem;margin-bottom:10px", text: "Claim your certificate" }),
    h("p", { class: "lh-muted", style: "margin-bottom:14px", text: "Check the name below — it is printed exactly as written and cannot be changed afterwards." }),
    h("div", { class: "lh-field" }, h("label", { for: "c-name", text: "Name on certificate" }), h("input", { id: "c-name", type: "text", maxlength: 80, value: s?.name || "" })),
    h("label", { class: "lh-check", style: "margin-bottom:6px" }, h("input", { id: "c-consent", type: "checkbox" }), h("span", { text: "Show my name and score on the public verification page. If you leave this off, the page only confirms the course and date — you can change this later." })),
    err, h("button", { class: "lh-btn lh-btn--primary", type: "submit", text: "Issue my certificate" }));
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); err.textContent = "";
    try {
      const c = (await api("POST", `attempts/${r.attemptId}/certificate`, { name: $("#c-name").value, publicDetails: $("#c-consent").checked })).certificate;
      showCertificate(el, c.certificateId, c);
    } catch (ex) { err.textContent = ex.message; }
  });
  el.append(form);
}

async function showCertificate(el, id, known) {
  clear(el);
  let cert = known;
  if (!cert) { try { cert = (await api("GET", "certificates")).certificates.find((c) => c.certificateId === id); } catch { /* shown minimal below */ } }
  const dl = async (btn) => {
    btn.disabled = true;
    try { const res = await api("GET", `certificates/${id}/pdf`, undefined, { raw: true }); const blob = await res.blob(); const url = URL.createObjectURL(blob); const a = h("a", { href: url, download: `Boztik-Learning-Certificate-${id}.pdf` }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); }
    catch (e) { toast(e.message); }
    btn.disabled = false;
  };
  const dlBtn = h("button", { class: "lh-btn lh-btn--primary", type: "button", text: "Download PDF certificate" }); dlBtn.addEventListener("click", () => dl(dlBtn));
  const verify = cert?.verifyUrl || `https://www.boztik.com/learning/verify/?id=${id}`;
  el.append(h("div", { class: "lh-panel lh-panel--neon" },
    h("h2", { style: "font-size:1.3rem;margin-bottom:10px", text: "Your certificate is ready" }),
    h("dl", { class: "lh-dl" }, h("dt", { text: "Certificate ID" }), h("dd", { text: id }), cert ? [h("dt", { text: "Name" }), h("dd", { text: cert.learnerName }), h("dt", { text: "Completed" }), h("dd", { text: fmtDate(cert.issuedAt) })] : null),
    h("div", { class: "lh-btnrow", style: "margin-top:16px" }, dlBtn, h("button", { class: "lh-btn", type: "button", onclick: () => copyText(verify, "Verification link copied"), text: "Copy verification link" })),
    h("p", { class: "lh-muted", style: "margin-top:12px;font-size:.92rem", text: "Boztik courses are independently developed and not formally accredited. This is a certificate of achievement, not an academic qualification or professional certification." })));
  // Keep the optional support choice available whenever a learner revisits a passed result.
  contribution(el.parentElement);
}

// ---------------------------------------------------------------- optional contribution (never required, never gating)
async function contribution(parent) {
  if ($("#contrib")) return;
  let cfg;
  try { cfg = (await api("GET", "config", undefined, { auth: false })).contributions; }
  catch { cfg = { enabled: false }; }

  const box = h("section", { id: "contrib", class: "lh-panel lh-contrib", "aria-labelledby": "contrib-title" });
  parent.append(box);

  const next = async () => {
    clear(box).append(
      h("span", { class: "lh-eyebrow", text: "Your next step" }),
      h("h2", { style: "font-size:1.3rem;margin:8px 0", text: "Thank you for learning with us" }),
      h("p", { class: "lh-muted", text: "Keep building your skills with another free course:" })
    );
    try {
      const all = await catalogue();
      box.append(h("div", { class: "lh-grid lh-grid--2", style: "margin-top:16px" }, all.filter((c) => c.slug !== slug).map((c) => courseCard(c))));
    } catch { /* course suggestions are optional */ }
    box.append(h("p", { style: "margin-top:16px" }, h("a", { class: "lh-btn", href: "/learning/dashboard/", text: "Go to my learning" })));
  };

  clear(box).append(
    h("span", { class: "lh-eyebrow", text: "Optional · PayPal" }),
    h("h2", { id: "contrib-title", style: "font-size:clamp(1.35rem,3vw,1.8rem);margin:9px 0 10px", text: "Help keep practical learning accessible" }),
    h("p", { class: "lh-contrib__lead", text: "You’ve completed this course and your certificate is yours. If you found the learning useful, you can optionally help us keep the Hub free for the next learner. No subscription, no pressure." }),
    h("div", { class: "lh-contrib__uses", "aria-label": "What contributions help fund" },
      h("div", { class: "lh-contrib__use" }, h("strong", { text: "Platform & hosting" }), h("span", { text: "Keeping lessons, learner progress and certificates available." })),
      h("div", { class: "lh-contrib__use" }, h("strong", { text: "Course development" }), h("span", { text: "Researching, writing and testing practical new lessons." })),
      h("div", { class: "lh-contrib__use" }, h("strong", { text: "Better learning resources" }), h("span", { text: "Improving assessments and keeping existing material up to date." }))
    )
  );

  if (!cfg.enabled) {
    box.append(
      h("p", { class: "lh-contrib__notice", text: "Online support options are being prepared. You can continue to your learning dashboard or explore another free course." }),
      h("div", { class: "lh-btnrow", style: "margin-top:16px" }, h("button", { class: "lh-btn lh-btn--quiet", type: "button", onclick: next, text: "Continue" }))
    );
    return;
  }

  const currency = cfg.currency || "USD";
  const currencyLabel = currency === "USD" ? "US dollars" : currency;
  const presets = (Array.isArray(cfg.presetsCents) ? cfg.presetsCents : [])
    .filter((c) => Number.isInteger(c) && c >= cfg.minCents && c <= cfg.maxCents)
    .filter((c, i, all) => all.indexOf(c) === i);
  const presetLabels = ["Help with hosting", "Improve resources", "Develop courses", "Support the Hub"];
  let amount = presets[0] ?? cfg.minCents;
  const custom = h("input", {
    id: "custom", type: "number", min: cfg.minCents / 100, max: cfg.maxCents / 100, step: "0.01",
    inputmode: "decimal", placeholder: `Other amount (min ${dollars(cfg.minCents)})`,
    "aria-label": `Custom contribution amount in ${currencyLabel}`
  });
  const err = h("p", { class: "lh-error", role: "alert", "aria-live": "polite" });
  const btns = presets.map((c, i) => h("button", {
    class: "lh-amount", type: "button", "aria-pressed": c === amount ? "true" : "false",
    onclick: () => {
      amount = c; custom.value = "";
      btns.forEach((b, index) => b.setAttribute("aria-pressed", presets[index] === c ? "true" : "false"));
    }
  }, h("b", { text: dollars(c) }), h("small", { text: presetLabels[i] || "Support learning" })));

  const pay = h("button", { class: "lh-btn lh-btn--primary", type: "button", text: "Continue securely with PayPal" });
  pay.addEventListener("click", async () => {
    err.textContent = "";
    let cents = amount;
    if (custom.value.trim()) {
      if (!/^\d+(?:\.\d{1,2})?$/.test(custom.value.trim())) {
        err.textContent = "Enter an amount using no more than two decimal places.";
        return;
      }
      cents = Math.round(Number(custom.value) * 100);
      btns.forEach((b) => b.setAttribute("aria-pressed", "false"));
    }
    if (!Number.isSafeInteger(cents) || cents < cfg.minCents) {
      err.textContent = `The minimum contribution is ${dollars(cfg.minCents)}.`;
      return;
    }
    if (cents > cfg.maxCents) {
      err.textContent = `The maximum contribution is ${dollars(cfg.maxCents)}.`;
      return;
    }
    pay.disabled = true;
    pay.textContent = "Connecting to PayPal…";
    try {
      const r = await api("POST", "contributions", { amountCents: cents, courseSlug: slug });
      if (!r.approveUrl || !/^https:\/\/(www\.)?(sandbox\.)?paypal\.com\//i.test(r.approveUrl)) throw new Error("PayPal returned an invalid checkout link. Please try again later.");
      location.href = r.approveUrl;
    } catch (e) {
      err.textContent = e.message || "We could not start PayPal checkout. Your certificate is unaffected.";
      pay.disabled = false;
      pay.textContent = "Continue securely with PayPal";
    }
  });

  box.append(
    h("h3", { class: "lh-contrib__choice-title", text: "Choose an amount" }),
    h("p", { class: "lh-muted", text: "Every contribution is optional and helps support the Learning Hub as a whole." }),
    h("div", { class: "lh-amounts", style: "margin:14px 0" }, btns),
    h("div", { class: "lh-field" }, h("label", { for: "custom", text: `Or enter your own amount (${currency})` }), custom),
    err,
    h("div", { class: "lh-btnrow", style: "margin-top:14px" }, pay, h("button", { class: "lh-btn lh-btn--quiet", type: "button", onclick: next, text: "Maybe later" })),
    h("p", { class: "lh-contrib__fine", text: "PayPal handles checkout. Boztik does not receive or store your card details. This is a voluntary contribution, not a charitable donation; no certificate, result or course access depends on paying." })
  );
}
