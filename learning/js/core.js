// Boztik Learning — shared client: API wrapper, private-link session, safe DOM helpers, modal, toast.
// No innerHTML is used with data: everything is built with textContent so course text and API values cannot inject markup.
import { API_BASE, SITE_ORIGIN } from "./config.js";

export const CATEGORIES = [
  { id: "ai-emerging-technology", name: "AI & Emerging Technology", blurb: "Use AI tools well, check what they produce and stay ahead of new technology." },
  { id: "cybersecurity-digital-safety", name: "Cybersecurity & Digital Safety", blurb: "Protect your accounts, devices and information from everyday threats." },
  { id: "data-analytics", name: "Data & Analytics", blurb: "Turn messy numbers into clear answers using spreadsheets and sound reasoning." },
  { id: "computer-digital-skills", name: "Computer & Digital Skills", blurb: "Confident everyday computing, from files and email to online tools." },
  { id: "design-creativity", name: "Design & Creativity", blurb: "Visual thinking, editing and creative craft." },
  { id: "business-entrepreneurship", name: "Business & Entrepreneurship", blurb: "Start, price, market and run a small business." },
  { id: "programming-development", name: "Programming & Development", blurb: "Learn to build software, from first principles to real projects." },
  { id: "career-professional-skills", name: "Career & Professional Skills", blurb: "CVs, interviews, communication and workplace skills." },
];
export const COMING_SOON = "Something exciting is on the way! We're developing new learning experiences for this category. New courses will be added soon.";
export const catName = (id) => CATEGORIES.find((c) => c.id === id)?.name ?? id;

// ---------------------------------------------------------------- DOM helpers
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "text") el.textContent = v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function clear(el) { el.replaceChildren(); return el; }

/** `**bold**` and `` `code` `` only — the whole inline grammar the course contract allows. */
export function inline(text) {
  const frag = document.createDocumentFragment();
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  String(text ?? "").split(re).forEach((part) => {
    if (!part) return;
    if (part.startsWith("**") && part.endsWith("**")) frag.append(h("strong", { text: part.slice(2, -2) }));
    else if (part.startsWith("`") && part.endsWith("`")) frag.append(h("code", { text: part.slice(1, -1) }));
    else frag.append(document.createTextNode(part));
  });
  return frag;
}
export function icon(id, cls = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true"); if (cls) svg.setAttribute("class", cls);
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `/learning/assets/img/icons.svg#i-${id}`);
  svg.append(use); return svg;
}
export const fmtDate = (unix) => new Date(unix * 1000).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
export const dollars = (cents) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

let toastTimer;
export function toast(message) {
  document.querySelector(".lh-toast")?.remove();
  const t = h("div", { class: "lh-toast", role: "status" }, message);
  document.body.append(t); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3800);
}
export async function copyText(text, okMsg = "Copied") {
  try { await navigator.clipboard.writeText(text); toast(okMsg); }
  catch { const ta = h("textarea", { class: "lh-sr" }); ta.value = text; document.body.append(ta); ta.select(); try { document.execCommand("copy"); toast(okMsg); } catch { toast("Copy failed — select the text and copy it manually."); } ta.remove(); }
}

export function modal(title, build, { dismissible = true } = {}) {
  const opener = document.activeElement;
  const box = h("div", { class: "lh-modal__box", role: "dialog", "aria-modal": "true", "aria-label": title, tabindex: "-1" });
  const wrap = h("div", { class: "lh-modal" }, box);
  const close = () => { wrap.remove(); document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; opener?.focus?.(); };
  const onKey = (e) => {
    if (e.key === "Escape" && dismissible) close();
    if (e.key === "Tab") { const f = $$("a[href],button:not([disabled]),input,select,textarea,[tabindex='0']", box).filter((x) => !x.closest("[hidden]")); if (!f.length) return; const first = f[0], last = f[f.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
  };
  wrap.addEventListener("mousedown", (e) => { if (e.target === wrap && dismissible) close(); });
  document.addEventListener("keydown", onKey);
  document.body.style.overflow = "hidden";
  build(box, close);
  document.body.append(wrap);
  (box.querySelector("input,select,textarea,button") || box).focus();
  return close;
}

// ---------------------------------------------------------------- API
export class ApiError extends Error { constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; } }

const KEY = "bzl.session.v1";
export const session = {
  get() { try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); return v && v.token ? v : null; } catch { return null; } },
  set(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: the link still works, just not remembered */ } },
  clear() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } },
  link(token) { return `${SITE_ORIGIN}/learning/resume/#t=${token}`; },
};

export async function api(method, path, body, { auth = true, raw = false } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) { const s = session.get(); if (s) headers.Authorization = `Bearer ${s.token}`; }
  let res;
  try { res = await fetch(`${API_BASE}/api/learning/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw new ApiError(0, "network", "Could not reach Boztik Learning. Check your connection and try again."); }
  if (raw && res.ok) return res;
  let data = null; try { data = await res.json(); } catch { /* not json */ }
  if (!res.ok) {
    if (res.status === 401 && data?.code === "invalid_session") { session.clear(); window.dispatchEvent(new CustomEvent("bzl:session-lost")); }
    throw new ApiError(res.status, data?.code || "error", data?.error || "Something went wrong. Please try again.", data || {});
  }
  return data;
}

export async function catalogue() {
  const res = await fetch("/learning/data/courses.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("catalogue unavailable");
  return (await res.json()).courses;
}
export async function loadCourse(slug) {
  if (!/^[a-z0-9-]+$/.test(slug || "")) throw new Error("bad slug");
  const res = await fetch(`/learning/courses/${slug}/course.json`, { cache: "no-cache" });
  if (!res.ok) throw new Error("course unavailable");
  return res.json();
}
export const courseUrl = (slug) => `${SITE_ORIGIN}/learning/courses/${slug}/`;

// ---------------------------------------------------------------- Course card (home + discover-next)
export function courseCard(c, progress) {
  const ill = `/learning/assets/img/course-${({ "practical-ai-productivity": "ai", "cybersecurity-digital-safety": "cyber", "data-analysis-spreadsheets": "data" })[c.slug] || "ai"}.svg`;
  return h("article", { class: "lh-card" },
    h("img", { class: "lh-card__img", src: ill, alt: "", width: 800, height: 450, loading: "lazy" }),
    h("div", { class: "lh-card__body" },
      h("div", { class: "lh-meta" }, h("span", { class: "lh-chip lh-chip--free", text: "Free" }), h("span", { class: "lh-chip", text: c.level }), h("span", { class: "lh-chip", text: c.estimatedHours })),
      h("h3", { class: "lh-card__title" }, h("a", { href: `/learning/courses/${c.slug}/`, text: c.title })),
      h("p", { class: "lh-muted", text: c.summary }),
      progress ? h("div", {}, h("div", { class: "lh-bar", role: "progressbar", "aria-valuenow": progress.percent, "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": "Your progress" }, h("span", { style: `width:${progress.percent}%` })), h("small", { class: "lh-muted", text: `${progress.percent}% complete` })) : null,
      h("div", { class: "lh-card__foot" },
        h("span", { class: "lh-muted", text: `${c.modules} modules · ${c.lessons} lessons` }),
        h("a", { class: "lh-btn lh-btn--primary lh-btn--sm", href: `/learning/courses/${c.slug}/`, text: progress ? (progress.percent >= 100 ? "Review" : "Continue") : "View course" }))));
}

// ---------------------------------------------------------------- Enrolment modal (name required; email/country optional)
const COUNTRIES = ["South Africa", "Botswana", "Eswatini", "Lesotho", "Mozambique", "Namibia", "Zambia", "Zimbabwe", "Kenya", "Nigeria", "Ghana", "United Kingdom", "United States", "Canada", "Australia", "India", "Other"];

export function explainerNote() {
  return h("div", { class: "lh-note" },
    h("strong", { text: "How your private link works. " }),
    "There is no password and no account. We give you a private link that saves your progress on our server. Anyone who has that link can open your learning session, so keep it to yourself. If you lose it, your recovery code gets you back in.");
}

export function enrolFlow(course, { onDone } = {}) {
  const existing = session.get();
  if (existing) {
    return (async () => {
      try { await api("POST", `courses/${course.slug}/enrol`, {}); onDone?.(); }
      catch (e) { if (e.code !== "invalid_session") { toast(e.message); return; } enrolFlow(course, { onDone }); }
    })();
  }
  modal(`Start ${course.title}`, (box, close) => {
    const err = h("p", { class: "lh-error", role: "alert" });
    const form = h("form", { novalidate: true },
      h("p", { class: "lh-muted", text: "Free. No account needed. Tell us what name to print on your certificate." }),
      h("div", { class: "lh-field" }, h("label", { for: "e-name", text: "Full name (required)" }), h("input", { id: "e-name", type: "text", name: "name", required: true, autocomplete: "name", maxlength: 80 }), h("small", { text: "This is the name on your certificate. Use letters A–Z (accents are fine)." })),
      h("div", { class: "lh-field" }, h("label", { for: "e-email", text: "Email (optional)" }), h("input", { id: "e-email", type: "email", name: "email", autocomplete: "email", maxlength: 254 }), h("small", { text: "Not needed to learn. We do not send marketing." })),
      h("div", { class: "lh-field" }, h("label", { for: "e-country", text: "Country (optional)" }), h("select", { id: "e-country", name: "country" }, h("option", { value: "", text: "Prefer not to say" }), ...COUNTRIES.map((c) => h("option", { value: c, text: c })))),
      explainerNote(),
      h("label", { class: "lh-check", style: "margin:14px 0" }, h("input", { type: "checkbox", name: "ack", required: true }), h("span", { text: "I understand that anyone with my private link can open my session, and I will keep it safe." })),
      err,
      h("div", { class: "lh-btnrow" }, h("button", { class: "lh-btn lh-btn--primary", type: "submit", text: "Start learning" }), h("button", { class: "lh-btn lh-btn--quiet", type: "button", onclick: close, text: "Not now" })));
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); err.textContent = "";
      const f = new FormData(form);
      if (!f.get("ack")) { err.textContent = "Please tick the box to confirm you understand how the private link works."; return; }
      const btn = $("button[type=submit]", form); btn.disabled = true;
      try {
        const r = await api("POST", "enrol", { name: f.get("name"), email: f.get("email") || undefined, country: f.get("country") || undefined, courseSlug: course.slug }, { auth: false });
        session.set({ token: r.token, ref: r.ref, name: r.name });
        clear(box); saveLinkScreen(box, r, () => { close(); onDone?.(); });
      } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
    });
    box.append(h("h2", { text: `Start ${course.title}` }), form);
  });
}

export function saveLinkScreen(box, r, done) {
  const link = session.link(r.token);
  let shown = false;
  const code = h("p", { class: "lh-recovery lh-reveal", "aria-live": "polite", text: r.recoveryCode });
  const reveal = h("button", { class: "lh-btn lh-btn--sm", type: "button", onclick: () => { shown = !shown; code.classList.toggle("on", shown); reveal.textContent = shown ? "Hide code" : "Show code"; }, text: "Show code" });
  box.append(
    h("h2", { text: "Save your private link" }),
    h("p", { class: "lh-muted", text: `Welcome, ${r.name}. Your progress is saved on our server. To continue on another phone or computer, open this link there.` }),
    h("div", { class: "lh-linkbox" }, h("code", { text: link }), h("button", { class: "lh-btn lh-btn--sm", type: "button", onclick: () => copyText(link, "Private link copied"), text: "Copy" })),
    h("p", { style: "margin-top:16px" }, h("strong", { text: "Recovery code" }), h("span", { class: "lh-muted", text: " — shown once. If you lose the link, your reference and this code get you back in." })),
    h("p", { class: "lh-muted", text: `Your reference: ${r.ref}` }), code,
    h("div", { class: "lh-btnrow", style: "margin:8px 0 16px" }, reveal, h("button", { class: "lh-btn lh-btn--sm", type: "button", onclick: () => copyText(`Boztik Learning\nReference: ${r.ref}\nRecovery code: ${r.recoveryCode}\nPrivate link: ${link}`, "Copied everything — paste it somewhere safe"), text: "Copy all" })),
    h("div", { class: "lh-note lh-note--warn", text: "Anyone with the private link can open your session. Do not post it publicly. Sharing a course with a friend never shares your link — send them the course page instead." }),
    h("div", { class: "lh-btnrow", style: "margin-top:18px" }, h("button", { class: "lh-btn lh-btn--primary", type: "button", onclick: done, text: "I've saved it — continue" })));
}

// ---------------------------------------------------------------- Share (course page address only — never learner data)
export function shareBlock(course) {
  const url = courseUrl(course.slug);
  const text = `I'm learning "${course.title}" for free on Boztik Learning. Join me:`;
  const row = h("div", { class: "lh-share" },
    h("button", { class: "lh-btn lh-btn--sm", type: "button", onclick: () => copyText(url, "Course link copied"), text: "Copy link" }),
    h("a", { class: "lh-btn lh-btn--sm", href: `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`, target: "_blank", rel: "noopener", text: "WhatsApp" }),
    h("a", { class: "lh-btn lh-btn--sm", href: `mailto:?subject=${encodeURIComponent(`Free course: ${course.title}`)}&body=${encodeURIComponent(`${text}\n\n${url}`)}`, text: "Email" }));
  if (navigator.share) row.append(h("button", { class: "lh-btn lh-btn--sm", type: "button", text: "More…", onclick: () => navigator.share({ title: course.title, text, url }).catch(() => {}) }));
  return h("div", {}, h("p", { class: "lh-muted", style: "margin-bottom:10px", text: "Know someone who would enjoy learning this? Share the course and learn together." }), row,
    h("small", { class: "lh-muted", style: "display:block;margin-top:8px", text: "The link goes to this course's public page. Your progress, results and private link are never included, and friends get their own separate session." }));
}

window.addEventListener("bzl:session-lost", () => { toast("That private link is no longer valid. Use your recovery code from the dashboard page."); });
