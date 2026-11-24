// Private-link landing page: /learning/resume/#t=TOKEN. The token lives only in the URL fragment (never sent to any server),
// is moved into this browser's storage, and is removed from the address bar straight away.
import { api, session, h, $, clear } from "./core.js";

(async function () {
  const m = /(?:^#|&)t=([A-Za-z0-9]{40,64})/.exec(location.hash);
  history.replaceState(null, "", location.pathname);
  const app = $("#app");
  const fail = () => clear(app).append(h("div", { class: "lh-panel lh-narrow" }, h("h1", { text: "That link did not work" }), h("p", { class: "lh-muted", text: "The private link may be incomplete, or it was replaced when someone recovered this session. If you have your reference and recovery code, you can get back in." }), h("p", { style: "margin-top:16px" }, h("a", { class: "lh-btn lh-btn--primary", href: "/learning/dashboard/", text: "Recover my session" }))));
  if (!m) return fail();
  const prev = session.get();
  session.set({ token: m[1], ref: "", name: "" });
  try {
    const me = await api("GET", "me");
    session.set({ token: m[1], ref: me.learner.ref, name: me.learner.name });
    location.replace("/learning/dashboard/");
  } catch { if (prev) session.set(prev); else session.clear(); fail(); }
})();
