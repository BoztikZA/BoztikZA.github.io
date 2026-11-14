// Private applicant status page. The secret token lives in the URL fragment (never sent to servers or logs as a
// path/query) and is only ever sent in POST bodies. All text is rendered with textContent.
const API = "https://deliver-api.boztik.com/api/public/spotlight/owner";
const $ = id => document.getElementById(id);
const STEPS = ["Received", "In review", "Approved", "Live"];
const COPY = {
  received: ["We have your application.", "A person will start reviewing it soon. Reviews usually take up to 72 hours."],
  in_review: ["Your application is being reviewed.", "We will email you if we need anything else."],
  info_needed: ["We need a little more information.", "Reply below so we can finish the review."],
  approved: ["Approved. We are preparing your profile.", "Your profile will be published manually. You will not need to do anything."],
  live: ["Your profile is live.", "Thanks for being part of Boztik Spotlight."],
  declined: ["We could not publish this application.", "The reason is below. You are welcome to apply again."],
  expired: ["This application has expired.", "You are welcome to apply again."],
};
const STEP_INDEX = { received: 0, in_review: 1, info_needed: 1, approved: 2, live: 3 };

function readToken() {
  const match = /(?:^#|&)t=([A-Za-z0-9_-]{43})(?:&|$)/.exec(location.hash);
  if (match) return match[1];
  try { return localStorage.getItem("boztik-spotlight-owner") || ""; } catch { return ""; }
}
async function call(path, body) {
  const response = await fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}
const date = seconds => new Date(seconds * 1000).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

function render(app) {
  $("sp-status-state").hidden = true;
  $("sp-status-card").hidden = false;
  $("sp-status-name").textContent = app.display_name;
  const [headline, detail] = COPY[app.stage] || COPY.received;
  $("sp-status-headline").textContent = headline;
  const lines = [detail];
  if (app.stage === "declined" && app.decline_reason) lines.push("Reason: " + app.decline_reason);
  if (app.review_expires_at && ["received", "in_review", "info_needed"].includes(app.stage)) lines.push("Review window ends " + date(app.review_expires_at) + ".");
  if (app.listing_expires_at) lines.push("Your listing runs until " + date(app.listing_expires_at) + ".");
  $("sp-status-detail").textContent = lines.join(" ");
  const steps = $("sp-status-steps");
  steps.replaceChildren();
  if (app.stage in STEP_INDEX) {
    const current = STEP_INDEX[app.stage];
    STEPS.forEach((label, index) => {
      const li = document.createElement("li");
      li.textContent = label;
      li.dataset.state = index < current || (app.stage === "live" && index === 3) ? "done" : index === current ? "current" : "todo";
      if (index === current) li.setAttribute("aria-current", "step");
      steps.append(li);
    });
  } else {
    const li = document.createElement("li");
    li.textContent = app.stage === "declined" ? "Not published" : "Expired";
    li.dataset.state = "problem";
    steps.append(li);
  }
  const reply = $("sp-status-reply");
  const info = app.info_request;
  reply.hidden = !(info && info.awaiting_reply);
  if (info && info.awaiting_reply) $("sp-info-note").textContent = info.note || "";
  if (info && !info.awaiting_reply && info.reply) {
    $("sp-status-detail").textContent += " Your reply was sent on " + date(info.replied_at) + ".";
  }
  const link = $("sp-status-public");
  link.hidden = !app.public_url;
  if (app.public_url) link.href = app.public_url;
}

async function load() {
  const token = readToken();
  if (!token) { $("sp-status-state").textContent = "Open the private status link you saved when you applied."; return; }
  let result;
  try { result = await call("", { token }); } catch { $("sp-status-state").textContent = "We could not reach the server. Check your connection and refresh."; return; }
  if (!result.ok) { $("sp-status-state").textContent = result.status === 404 ? "We could not find an application for this link. Check you copied the whole link." : (result.data.error || "Something went wrong. Please try again."); return; }
  render(result.data.application);
  $("sp-status-reply").addEventListener("submit", async event => {
    event.preventDefault();
    const out = $("sp-reply-status"), button = event.target.querySelector("button");
    button.disabled = true; out.textContent = "Sending…";
    try {
      const sent = await call("/respond", { token, message: event.target.elements.message.value });
      if (!sent.ok) throw new Error(sent.data.error || "We could not send your reply.");
      event.target.reset(); out.textContent = "";
      render(sent.data.application);
    } catch (error) { out.textContent = error.message; } finally { button.disabled = false; }
  });
}
load();
