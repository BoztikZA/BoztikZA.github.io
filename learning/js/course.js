// Course landing page: start/continue, progress, sharing and "discover next".
import { api, catalogue, courseCard, enrolFlow, session, shareBlock, h, $, COMING_SOON, CATEGORIES } from "./core.js";

const btn = $("#start-btn");
const slug = btn.dataset.course;
const go = () => { location.href = `/learning/learn/?c=${slug}`; };
let title = document.querySelector("h1").textContent;
let action = () => enrolFlow({ slug, title }, { onDone: go });
btn.addEventListener("click", () => action());
$("#share-slot").append(shareBlock({ slug, title }));

(async function () {
  if (session.get()) {
    try {
      const p = await api("GET", `courses/${slug}`);
      if (p.enrolled) {
        const ready = p.percent >= 100 && !p.passed;
        btn.textContent = p.passed ? "Review this course" : ready ? "Take the assessment" : p.percent > 0 ? "Continue learning" : "Open the course";
        action = () => { location.href = ready ? `/learning/exam/?c=${slug}` : `/learning/learn/?c=${slug}`; };
        $("#progress-slot").append(
          h("div", { class: "lh-bar", role: "progressbar", "aria-valuenow": p.percent, "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": "Your progress" }, h("span", { style: `width:${p.percent}%` })),
          h("small", { class: "lh-muted", text: `${p.percent}% complete${p.passed ? " · assessment passed" : ""}` }));
      }
    } catch { /* offline or link no longer valid: the public page still works */ }
  }

  const slot = $("#discover-slot");
  try {
    const all = await catalogue();
    const others = all.filter((c) => c.slug !== slug);
    slot.append(
      h("h2", { style: "margin-bottom:8px", text: "Discover what to learn next" }),
      h("p", { class: "lh-muted", style: "margin-bottom:20px", text: "Other free courses, plus more categories on the way." }),
      h("div", { class: "lh-grid lh-grid--3" }, others.map((c) => courseCard(c))));
    const soon = CATEGORIES.filter((c) => !all.some((x) => x.category === c.id));
    if (soon.length) slot.append(h("p", { class: "lh-muted", style: "margin-top:18px" }, h("strong", { text: `${soon.map((c) => c.name).join(", ")}: ` }), COMING_SOON));
  } catch { /* ignore */ }
})();
