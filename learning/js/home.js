// Learning homepage: enhances the statically rendered page with the learner's own progress (if they have a private link).
import { api, catalogue, courseCard, session, h, $, clear } from "./core.js";

(async function () {
  if (!session.get()) return;
  try {
    const [me, courses] = await Promise.all([api("GET", "me"), catalogue()]);
    const mine = me.courses.filter((c) => c.enrolled);
    if (!mine.length) return;
    for (const p of mine) {
      const card = $(`[data-course="${p.courseSlug}"]`);
      if (!card) continue;
      const slot = $("[data-progress]", card);
      slot.append(h("div", { class: "lh-bar", role: "progressbar", "aria-valuenow": p.percent, "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": "Your progress" }, h("span", { style: `width:${p.percent}%` })), h("small", { class: "lh-muted", text: `${p.percent}% complete` }));
      $("[data-cta]", card).textContent = p.passed ? "Review" : p.percent >= 100 ? "Take assessment" : "Continue";
    }
    const grid = $("#continue-grid"); clear(grid);
    for (const p of mine) { const c = courses.find((x) => x.slug === p.courseSlug); if (c) grid.append(courseCard(c, p)); }
    $("#continue").hidden = false;
  } catch { /* offline or link no longer valid: the public page is still fully usable */ }
})();
