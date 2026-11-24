// Public certificate verification. Shows the minimum: validity, course, date. Name and score appear only if the learner consented.
import { API_BASE } from "./config.js";
import { h, $, clear, fmtDate } from "./core.js";

const app = $("#app");
const ID_RE = /^BZL-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/;
const q = new URLSearchParams(location.search);

async function call(path, body) {
  const res = await fetch(`${API_BASE}/api/learning/${path}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({}));
  if (res.status === 429) throw new Error("Too many checks from this connection. Please wait a minute and try again.");
  if (!data.status) throw new Error("Verification is unavailable right now. Please try again shortly.");
  return data;
}

function form(initial = "") {
  const input = h("input", { id: "cid", type: "text", value: initial, placeholder: "BZL-XXXX-XXXX-XXXX", autocomplete: "off", maxlength: 20, style: "text-transform:uppercase" });
  const f = h("form", { class: "lh-panel", novalidate: true }, h("div", { class: "lh-field" }, h("label", { for: "cid", text: "Certificate ID" }), input), h("button", { class: "lh-btn lh-btn--primary", type: "submit", text: "Verify" }));
  f.addEventListener("submit", (e) => { e.preventDefault(); const v = input.value.trim().toUpperCase(); history.replaceState(null, "", `?id=${encodeURIComponent(v)}`); run(v); });
  return f;
}

async function run(id) {
  clear(app); window.scrollTo({ top: 0 });
  const wrap = h("div", { class: "lh-narrow", style: "display:grid;gap:20px;margin-inline:auto" }, h("span", { class: "lh-eyebrow", text: "Boztik Learning" }), h("h1", { text: "Verify a certificate" }));
  app.append(wrap);
  if (!id) { wrap.append(h("p", { class: "lh-lead", text: "Enter the certificate ID printed on the certificate to check that it is genuine." }), form()); return; }
  if (!ID_RE.test(id)) { wrap.append(h("div", { class: "lh-verify-result nf" }, h("h2", { text: "That ID is not in the right format" }), h("p", { class: "lh-muted", text: "Certificate IDs look like BZL-7K3M-Q9XA-4D2P." })), form(id)); return; }
  let v;
  wrap.append(h("div", { class: "lh-skeleton", role: "status", "aria-label": "Checking" }));
  try { v = await call(`verify/${id}`); } catch (e) { wrap.lastChild.remove(); wrap.append(h("div", { class: "lh-note lh-note--bad", text: e.message }), form(id)); return; }
  wrap.lastChild.remove();
  if (v.status === "not_found") { wrap.append(h("div", { class: "lh-verify-result nf" }, h("h2", { text: "No certificate found" }), h("p", { class: "lh-muted", text: "We have no certificate with that ID. Check for typing mistakes. If it still fails, the certificate may not be genuine." })), form(id)); return; }
  if (v.status === "revoked") { wrap.append(h("div", { class: "lh-verify-result revoked" }, h("h2", { text: "This certificate has been revoked" }), h("p", { class: "lh-muted", text: `The ID ${v.certificateId} was issued for “${v.courseTitle}” but is no longer valid.` }))); return; }
  const rows = [h("dt", { text: "Certificate ID" }), h("dd", { text: v.certificateId }), h("dt", { text: "Course" }), h("dd", { text: v.courseTitle }), h("dt", { text: "Completed" }), h("dd", { text: fmtDate(v.completedOn) }), h("dt", { text: "Pass mark" }), h("dd", { text: `${v.passMark}%` })];
  if (v.detailsShared) rows.push(h("dt", { text: "Awarded to" }), h("dd", { text: v.learnerName }), h("dt", { text: "Score" }), h("dd", { text: `${v.scorePercent}%` }));
  const result = h("div", { class: "lh-verify-result valid" }, h("h2", { text: "Valid certificate" }), h("p", { class: "lh-muted", text: "This is a genuine Boztik Learning certificate of achievement." }), h("dl", { class: "lh-dl" }, rows));
  wrap.append(result);
  if (!v.detailsShared) {
    const out = h("p", { role: "status" });
    const name = h("input", { id: "vname", type: "text", maxlength: 80, autocomplete: "off" });
    const f = h("form", { class: "lh-panel", novalidate: true }, h("h3", { style: "margin-bottom:8px", text: "Does the name match?" }), h("p", { class: "lh-muted", style: "margin-bottom:12px", text: "The holder has chosen not to publish their name. If you have the certificate, type the name printed on it and we will tell you whether it matches." }), h("div", { class: "lh-field" }, h("label", { for: "vname", text: "Name on the certificate" }), name), h("button", { class: "lh-btn", type: "submit", text: "Check name" }), out);
    f.addEventListener("submit", async (e) => { e.preventDefault(); try { const r = await call("verify", { id: v.certificateId, name: name.value }); out.textContent = r.nameMatch === true ? "Match: that name is the one on this certificate." : "No match: that name is not the one on this certificate."; out.style.color = r.nameMatch ? "var(--lh-neon)" : "var(--lh-danger)"; } catch (ex) { out.textContent = ex.message; } });
    wrap.append(f);
  }
  wrap.append(h("p", { class: "lh-muted", style: "font-size:.9rem", text: "Boztik courses are independently developed and not formally accredited. Certificates are certificates of completion or achievement, not academic qualifications, professional certifications, credits or licences." }));
}
run((q.get("id") || "").trim().toUpperCase());
