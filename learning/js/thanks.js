// Contribution return page. A browser redirect is NOT proof of payment: this page only reports what PayPal's verified webhook has recorded.
import { api, session, h, $, clear, dollars } from "./core.js";

const app = $("#app");
const q = new URLSearchParams(location.search);
const id = q.get("c") || "";
const box = (title, text, extra) => clear(app).append(h("div", { class: "lh-panel lh-panel--neon lh-narrow" }, h("h1", { text: title }), h("p", { class: "lh-muted", style: "margin:12px 0 18px", text }), extra, h("p", { class: "lh-btnrow", style: "margin-top:16px" }, h("a", { class: "lh-btn lh-btn--primary", href: "/learning/dashboard/", text: "My learning" }), h("a", { class: "lh-btn", href: "/learning/", text: "More courses" }))));

(async function () {
  if (q.get("cancelled") === "1") return box("No problem", "Nothing was charged. Your certificate and results are unaffected — thank you for learning with us.");
  if (!session.get() || !/^[a-z0-9]{16}$/.test(id)) return box("Thank you", "If you completed a contribution, thank you. Open your private link to see its status. Your certificate does not depend on it.");
  box("Checking with PayPal…", "Waiting for PayPal to confirm your contribution. This usually takes a few seconds.");
  for (let i = 0; i < 12; i++) {
    try {
      const s = await api("GET", `contributions/${id}`);
      if (s.status === "completed") return box("Thank you so much", `Your ${dollars(s.amountCents)} contribution was confirmed. It helps maintain the Learning Hub and fund new courses.`);
      if (s.status === "failed") return box("That did not go through", "PayPal did not confirm the payment, so nothing was recorded. You can try again from the course page whenever you like — or not at all.");
      if (s.status === "refunded") return box("Contribution refunded", "This contribution was refunded. Thank you anyway.");
    } catch (e) { return box("We could not check that", e.message); }
    await new Promise((r) => setTimeout(r, 2500));
  }
  box("Still waiting for PayPal", "PayPal has not confirmed this contribution yet. If you did complete it, confirmation can take a few minutes. We only count a contribution once PayPal confirms it. Nothing else is needed from you.");
})();
