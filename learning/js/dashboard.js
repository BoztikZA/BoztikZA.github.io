// Private dashboard: progress across courses, certificates, the private link, recovery and data deletion.
import { api, session, h, $, clear, catalogue, courseCard, copyText, toast, fmtDate, explainerNote, COMING_SOON } from "./core.js";

const app = $("#app");
window.addEventListener("bzl:session-lost", () => recovery());

(async function () {
  if (!session.get()) return recovery();
  try { render(await api("GET", "me")); }
  catch (e) { if (e.code !== "invalid_session") clear(app).append(h("div", { class: "lh-note lh-note--bad", text: e.message })); }
})();

function recovery() {
  clear(app);
  const err = h("p", { class: "lh-error", role: "alert" });
  const f = h("form", { class: "lh-panel lh-panel--neon", novalidate: true },
    h("h2", { style: "font-size:1.3rem;margin-bottom:8px", text: "Get back into your session" }),
    h("p", { class: "lh-muted", style: "margin-bottom:14px", text: "Best: open your private link (it looks like …/learning/resume/#t=…). Lost it? Enter the reference and recovery code you saved when you started. We will issue a new private link, and the old one will stop working." }),
    h("div", { class: "lh-field" }, h("label", { for: "r-ref", text: "Reference (LN-XXXXXXXX)" }), h("input", { id: "r-ref", type: "text", autocomplete: "off", maxlength: 12, style: "text-transform:uppercase" })),
    h("div", { class: "lh-field" }, h("label", { for: "r-code", text: "Recovery code (XXXX-XXXX-XXXX-XXXX)" }), h("input", { id: "r-code", type: "text", autocomplete: "off", maxlength: 24, style: "text-transform:uppercase" })),
    err, h("button", { class: "lh-btn lh-btn--primary", type: "submit", text: "Recover my session" }));
  f.addEventListener("submit", async (e) => {
    e.preventDefault(); err.textContent = "";
    try { const r = await api("POST", "recover", { ref: $("#r-ref").value, code: $("#r-code").value }, { auth: false }); session.set({ token: r.token, ref: r.ref, name: r.name }); toast("Welcome back"); location.reload(); }
    catch (ex) { err.textContent = ex.message; }
  });
  app.append(h("div", { class: "lh-narrow", style: "display:grid;gap:20px;margin-inline:auto" }, h("span", { class: "lh-eyebrow", text: "My learning" }), h("h1", { text: "Welcome to Boztik Learning" }), h("p", { class: "lh-lead", text: "New here? Choose a course and enrol — it only takes a name." }), h("div", { class: "lh-btnrow" }, h("a", { class: "lh-btn lh-btn--primary", href: "/learning/#courses", text: "Browse courses" })), f, explainerNote()));
}

async function render(me) {
  clear(app);
  const all = await catalogue().catch(() => []);
  const link = session.link(session.get().token);
  let shown = false;
  const linkText = h("code", { class: "lh-reveal", text: link });
  const mine = me.courses.filter((c) => c.enrolled);
  app.append(h("div", { style: "display:grid;gap:36px" },
    h("div", {}, h("span", { class: "lh-eyebrow", text: "My learning" }), h("h1", { style: "margin:10px 0 6px", text: `Hello, ${me.learner.name.split(" ")[0]}` }), h("p", { class: "lh-muted", text: `Reference ${me.learner.ref}` })),
    section("My courses", mine.length ? h("div", { class: "lh-grid lh-grid--3" }, mine.map((p) => { const c = all.find((x) => x.slug === p.courseSlug); return c ? courseCard(c, p) : null; })) : h("p", { class: "lh-muted" }, "You have not started a course yet. ", h("a", { href: "/learning/#courses", text: "Browse the courses" }), ".")),
    section("My certificates", me.certificates.length ? h("div", { class: "lh-grid lh-grid--2" }, me.certificates.map(certCard)) : h("p", { class: "lh-muted", text: "Certificates you earn will appear here. They are issued when you pass an assessment." })),
    section("Private link", h("div", { class: "lh-panel" },
      explainerNote(),
      h("div", { class: "lh-linkbox", style: "margin:14px 0" }, linkText, h("button", { class: "lh-btn lh-btn--sm", type: "button", onclick: () => { shown = !shown; linkText.classList.toggle("on", shown); }, text: "Show / hide" }), h("button", { class: "lh-btn lh-btn--sm", type: "button", onclick: () => copyText(link, "Private link copied"), text: "Copy" })),
      h("p", { class: "lh-muted", style: "font-size:.92rem", text: "Open this link on another device to continue there. If you think it has been seen by someone else, recover your session with your recovery code to replace it." }),
      h("div", { class: "lh-btnrow", style: "margin-top:14px" }, h("button", { class: "lh-btn lh-btn--sm lh-btn--quiet", type: "button", onclick: () => { session.clear(); location.reload(); }, text: "Sign out on this device" })))),
    all.length ? section("Discover what to learn next", h("div", {}, h("div", { class: "lh-grid lh-grid--3" }, all.filter((c) => !mine.some((p) => p.courseSlug === c.slug)).map((c) => courseCard(c))), h("p", { class: "lh-muted", style: "margin-top:16px", text: `More categories are on the way: ${COMING_SOON}` }))) : null,
    section("Your data", h("div", { class: "lh-panel" }, h("p", { class: "lh-muted", text: "You can delete your session and everything saved with it: progress, attempts, name, email and country." }), h("div", { class: "lh-btnrow", style: "margin-top:14px" }, h("button", { class: "lh-btn lh-btn--sm lh-btn--danger", type: "button", onclick: del, text: "Delete my data…" }))))));
}
const section = (title, body) => h("section", {}, h("h2", { style: "font-size:1.4rem;margin-bottom:16px", text: title }), body);

function certCard(c) {
  const consent = h("input", { type: "checkbox", checked: c.publicDetails || null, disabled: c.revoked || null });
  consent.addEventListener("change", async () => { try { await api("PATCH", `certificates/${c.certificateId}`, { publicDetails: consent.checked }); toast(consent.checked ? "Name and score will show on the verification page" : "Only the course and date will show"); } catch (e) { toast(e.message); consent.checked = !consent.checked; } });
  const dl = h("button", { class: "lh-btn lh-btn--primary lh-btn--sm", type: "button", text: "Download PDF", disabled: c.revoked || null });
  dl.addEventListener("click", async () => { dl.disabled = true; try { const res = await api("GET", `certificates/${c.certificateId}/pdf`, undefined, { raw: true }); const url = URL.createObjectURL(await res.blob()); const a = h("a", { href: url, download: `Boztik-Learning-Certificate-${c.certificateId}.pdf` }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); } catch (e) { toast(e.message); } dl.disabled = false; });
  return h("div", { class: "lh-panel lh-panel--neon" }, c.revoked ? h("span", { class: "lh-chip", style: "color:var(--lh-danger)", text: "Revoked" }) : null, h("h3", { style: "margin:6px 0 8px", text: c.courseTitle }), h("p", { class: "lh-muted", text: `${c.learnerName} · ${fmtDate(c.issuedAt)} · score ${c.scorePercent}% (pass mark ${c.passMark}%)` }), h("p", { class: "lh-muted", style: "font-size:.9rem", text: c.certificateId }),
    h("label", { class: "lh-check", style: "margin:12px 0;font-size:.92rem" }, consent, h("span", { text: "Show my name and score on the public verification page" })),
    h("div", { class: "lh-btnrow" }, dl, h("button", { class: "lh-btn lh-btn--sm", type: "button", onclick: () => copyText(c.verifyUrl, "Verification link copied"), text: "Copy verification link" })));
}

function del() {
  if (!confirm("Delete your Boztik Learning session and all saved progress? This cannot be undone.")) return;
  const certs = confirm("Also delete your certificates? Press OK to delete them too, or Cancel to keep them (they stay verifiable by ID but will no longer show your name publicly).");
  api("DELETE", "me", { confirm: true, alsoDeleteCertificates: certs }).then(() => { session.clear(); toast("Your data has been deleted"); setTimeout(() => (location.href = "/learning/"), 900); }).catch((e) => toast(e.message));
}
