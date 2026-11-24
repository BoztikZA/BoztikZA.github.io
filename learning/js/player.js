// Lesson player. Course content comes from the public course.json; progress is saved on the Boztik server via the private link.
// Knowledge checks are formative and evaluated in the browser (they are not the exam). Exam answers never reach this page.
import { api, enrolFlow, session, h, $, $$, clear, inline, loadCourse, toast, copyText } from "./core.js";

const app = $("#app");
const params = new URLSearchParams(location.search);
const slug = params.get("c") || "";
let course, progress, lessons, current;

function flat(c) { return c.modules.flatMap((m, mi) => m.lessons.map((l) => ({ ...l, module: m, moduleIndex: mi }))); }
const isDone = (id) => progress.completedLessons.includes(id);

(async function boot() {
  try { course = await loadCourse(slug); } catch { return fail("We could not find that course.", true); }
  document.title = `${course.title} — Boztik Learning`;
  lessons = flat(course);
  if (!session.get()) return gate();
  try {
    progress = await api("GET", `courses/${slug}`);
    if (!progress.enrolled) progress = await api("POST", `courses/${slug}/enrol`, {});
  } catch (e) { if (e.code === "invalid_session") return gate(); return fail(e.message); }
  const want = params.get("l");
  const pick = lessons.find((l) => l.id === want) || lessons.find((l) => l.id === progress.lastLessonId) || lessons.find((l) => !isDone(l.id)) || lessons[0];
  layout(); show(pick.id, false);
})();
window.addEventListener("bzl:session-lost", () => gate());

function fail(msg, home) {
  clear(app).append(h("div", { class: "lh-panel lh-narrow" }, h("h1", { text: "Hmm." }), h("p", { class: "lh-muted", text: msg }), h("p", { style: "margin-top:16px" }, h("a", { class: "lh-btn", href: home ? "/learning/" : location.href, text: home ? "Browse courses" : "Try again" }))));
}
function gate() {
  clear(app).append(h("div", { class: "lh-panel lh-panel--neon lh-narrow" },
    h("span", { class: "lh-eyebrow", text: course.title }), h("h1", { style: "margin:10px 0", text: "Start learning" }),
    h("p", { class: "lh-muted", text: "Enter your name to begin. No account or password — just a private link that saves your progress. Already started? Open your private link, or use your recovery code on the dashboard." }),
    h("div", { class: "lh-btnrow", style: "margin-top:18px" },
      h("button", { class: "lh-btn lh-btn--primary", type: "button", onclick: () => enrolFlow(course, { onDone: () => location.reload() }), text: "Start free" }),
      h("a", { class: "lh-btn", href: "/learning/dashboard/", text: "I already have a session" }))));
}

function layout() {
  const pct = h("span", { style: `width:${progress.percent}%` });
  clear(app); app.classList.remove("lh-wrap", "lh-section"); app.style.padding = "0";
  const toc = h("nav", { class: "lh-toc", id: "toc", "aria-label": "Course contents" },
    h("button", { class: "lh-toc__toggle", type: "button", "aria-expanded": "false", onclick: (e) => { const o = toc.classList.toggle("is-open"); e.currentTarget.setAttribute("aria-expanded", o); }, text: "Course contents" }),
    h("div", { class: "lh-toc__list", id: "toc-list" }));
  app.append(
    h("div", { class: "lh-topbar" }, h("div", { class: "lh-wrap" },
      h("a", { href: `/learning/courses/${slug}/`, style: "text-decoration:none;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:42%", text: course.title }),
      h("div", { class: "lh-bar", id: "topbar-bar", role: "progressbar", "aria-label": "Course progress", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": progress.percent }, pct),
      h("a", { class: "lh-btn lh-btn--sm lh-btn--quiet", href: "/learning/dashboard/", text: "My learning" }))),
    h("div", { class: "lh-wrap" }, h("div", { class: "lh-player" }, toc, h("article", { class: "lh-lesson", id: "lesson", tabindex: "-1" }))));
  renderToc();
}
function renderToc() {
  const list = $("#toc-list"); clear(list);
  course.modules.forEach((m, i) => {
    list.append(h("h3", { text: `${i + 1}. ${m.title}` }));
    m.lessons.forEach((l) => list.append(h("a", { href: `?c=${slug}&l=${l.id}`, class: isDone(l.id) ? "done" : "", "aria-current": current === l.id ? "true" : null, "data-l": l.id, onclick: (e) => { e.preventDefault(); show(l.id, true); $("#toc").classList.remove("is-open"); } }, h("span", { class: "dot" }), h("span", { text: l.title }))));
  });
  const pct = progress.percent;
  const bar = $("#topbar-bar"); bar.setAttribute("aria-valuenow", pct); bar.firstChild.style.width = `${pct}%`;
}

function show(id, focus) {
  const idx = lessons.findIndex((l) => l.id === id); if (idx < 0) return;
  const l = lessons[idx]; current = id;
  history.replaceState(null, "", `?c=${slug}&l=${id}`);
  api("POST", `courses/${slug}/lessons/${id}/visit`, {}).catch(() => {});
  const el = $("#lesson"); clear(el);
  el.append(h("span", { class: "lh-eyebrow", text: `Module ${l.moduleIndex + 1} · ${l.module.title}` }), h("h1", { text: l.title }), h("p", { class: "lh-muted", style: "margin:-12px 0 18px", text: `About ${l.minutes} minutes` }));
  const blocks = h("div", { class: "lh-blocks" }); el.append(blocks);
  l.blocks.forEach((b) => { const n = renderBlock(b); if (n) blocks.append(n); });
  const prev = lessons[idx - 1], next = lessons[idx + 1];
  const complete = h("button", { class: "lh-btn lh-btn--primary", type: "button", text: isDone(id) ? (next ? "Next lesson" : "Finish") : (next ? "Mark complete & continue" : "Mark complete & finish") });
  complete.addEventListener("click", async () => {
    complete.disabled = true;
    try {
      const before = progress.percent;
      if (!isDone(id)) progress = await api("POST", `courses/${slug}/lessons/${id}/complete`, {});
      renderToc();
      const moduleDone = l.module.lessons.every((x) => isDone(x.id));
      const lastOfModule = l.module.lessons[l.module.lessons.length - 1].id === id;
      if (progress.assessmentUnlocked) return completion();
      if ((moduleDone && lastOfModule) || (before < 50 && progress.percent >= 50)) return milestone(l, next, before);
      if (next) show(next.id, true); else completion();
    } catch (e) { toast(e.message); complete.disabled = false; }
  });
  el.append(h("div", { class: "lh-lessonfoot" }, prev ? h("button", { class: "lh-btn lh-btn--quiet", type: "button", onclick: () => show(prev.id, true), text: "← Previous" }) : h("span"), complete));
  $$("#toc-list a").forEach((a) => a.setAttribute("aria-current", a.dataset.l === id ? "true" : "false"));
  if (focus) { el.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: "smooth" }); }
}

function milestone(l, next, before) {
  const half = before < 50 && progress.percent >= 50;
  const el = $("#lesson"); clear(el);
  el.append(h("div", { class: "lh-milestone" },
    h("img", { src: "/learning/assets/img/milestone.svg", alt: "", width: 400, height: 200 }),
    h("h1", { style: "font-size:1.8rem", text: half ? "Halfway there" : `Module ${l.moduleIndex + 1} complete` }),
    h("p", { class: "lh-muted", text: half ? `You have finished ${progress.percent}% of the lessons. Take a breath — your progress is saved.` : `${l.module.title} is done. ${progress.completedLessons.length} of ${progress.lessonsTotal} lessons finished.` }),
    h("div", { class: "lh-btnrow" }, next ? h("button", { class: "lh-btn lh-btn--primary", type: "button", onclick: () => show(next.id, true), text: "Continue" }) : null, h("a", { class: "lh-btn lh-btn--quiet", href: "/learning/dashboard/", text: "Pause here" }))));
  el.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: "smooth" });
}
function completion() {
  const el = $("#lesson"); clear(el);
  el.append(h("div", { class: "lh-milestone" },
    h("img", { src: "/learning/assets/img/completion.svg", alt: "", width: 400, height: 220 }),
    h("h1", { style: "font-size:1.9rem", text: "All lessons complete" }),
    h("p", { class: "lh-muted", text: `The assessment is now unlocked: ${progress.passed ? "you have already passed it, and can retake it any time" : "it is marked on our server, and you can retake it if you need to"}. Take it when you feel ready — there is no rush.` }),
    h("div", { class: "lh-btnrow" }, h("a", { class: "lh-btn lh-btn--primary", href: `/learning/exam/?c=${slug}`, text: progress.passed ? "Retake the assessment" : "Take the assessment" }), h("button", { class: "lh-btn lh-btn--quiet", type: "button", onclick: () => show(lessons[0].id, true), text: "Review the lessons" }))));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------------------------------------------------------------- blocks
function renderBlock(b) {
  switch (b.type) {
    case "p": return h("p", {}, inline(b.text));
    case "h": return h("h2", {}, inline(b.text));
    case "list": return h(b.ordered ? "ol" : "ul", {}, b.items.map((i) => h("li", {}, inline(i))));
    case "callout": return h("div", { class: `lh-callout lh-callout--${b.tone || "tip"}`, role: "note" }, b.title ? h("strong", { class: "t" }, inline(b.title)) : null, h("div", {}, inline(b.text)));
    case "steps": return h("div", {}, b.title ? h("h2", { style: "margin-bottom:10px" }, inline(b.title)) : null, h("ol", { class: "lh-stepsblock" }, b.items.map((s) => h("li", {}, h("div", {}, h("strong", {}, inline(s.title)), h("div", { class: "lh-muted" }, inline(s.text)))))));
    case "table": return h("div", { class: "lh-table-wrap", tabindex: "0", role: "region", "aria-label": b.caption || "Table" }, h("table", {}, b.caption ? h("caption", {}, inline(b.caption)) : null, h("thead", {}, h("tr", {}, b.headers.map((x) => h("th", { scope: "col" }, inline(x))))), h("tbody", {}, b.rows.map((r) => h("tr", {}, r.map((c) => h("td", {}, inline(c))))))));
    case "code": return h("div", { class: "lh-codeblock" }, h("header", {}, h("span", { text: b.label || "Example" }), h("button", { class: "lh-btn lh-btn--sm lh-btn--quiet", type: "button", onclick: () => copyText(b.text, "Copied"), text: "Copy" })), h("pre", { text: b.text }));
    case "exercise": return exercise(b);
    case "check": return check(b);
    default: return null;
  }
}
function exercise(b) {
  const key = `bzl.ex.${slug}.${current}.${b.title}`;
  let saved = []; try { saved = JSON.parse(localStorage.getItem(key) || "[]"); } catch { /* ignore */ }
  return h("section", { class: "lh-exercise", "aria-label": "Exercise" },
    h("strong", { text: `Exercise: ${b.title}` }), b.intro ? h("p", {}, inline(b.intro)) : null,
    h("ul", {}, b.tasks.map((t, i) => h("li", {}, h("label", { class: "lh-check", style: "margin:6px 0" }, h("input", { type: "checkbox", checked: saved.includes(i) || null, onchange: (e) => { const s = new Set(saved); e.target.checked ? s.add(i) : s.delete(i); saved = [...s]; try { localStorage.setItem(key, JSON.stringify(saved)); } catch { /* ignore */ } } }), h("span", {}, inline(t)))))),
    b.reflection ? h("p", { class: "lh-muted", style: "margin-top:10px" }, h("em", {}, inline(`Reflect: ${b.reflection}`))) : null);
}
function check(b) {
  const multi = b.kind === "multi" || (b.correct || []).length > 1;
  const name = `chk-${b.id}`;
  const fb = h("p", { class: "lh-feedback", role: "status" });
  const opts = b.options.map((o, i) => h("label", { class: "lh-opt" }, h("input", { type: multi ? "checkbox" : "radio", name, value: i }), h("span", {}, inline(o))));
  const btn = h("button", { class: "lh-btn lh-btn--sm", type: "button", text: "Check answer" });
  btn.addEventListener("click", () => {
    const picked = opts.map((l, i) => (l.querySelector("input").checked ? i : -1)).filter((i) => i >= 0);
    if (!picked.length) { fb.textContent = "Choose an answer first."; return; }
    const right = picked.length === b.correct.length && picked.every((i) => b.correct.includes(i));
    opts.forEach((l, i) => { l.classList.toggle("is-right", b.correct.includes(i)); l.classList.toggle("is-wrong", picked.includes(i) && !b.correct.includes(i)); });
    clear(fb).append(h("strong", { text: right ? "Correct. " : "Not quite. " }), inline(b.explain || ""));
  });
  return h("section", { class: "lh-check-q", "aria-label": "Knowledge check" }, h("strong", { text: "Check your understanding" }), h("p", { style: "margin:8px 0" }, inline(b.prompt)), multi ? h("small", { class: "lh-muted", text: "Select all that apply." }) : null, h("div", { class: "lh-opts" }, opts), btn, fb);
}
