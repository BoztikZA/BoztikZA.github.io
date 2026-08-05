/**
 * Boztik Deliver — client delivery page logic
 * Reads ?id= from the URL, loads the delivery record via the public
 * `deliveries_public` view (RLS-safe, see supabase/schema.sql), and
 * renders either the active-delivery state or the expired state.
 */

(function () {
  "use strict";

  const { getSupabaseClient, formatBytes, formatDate, getCountdown, escapeHtml, showToast } =
    window.BoztikDeliver;

  const els = {
    loading: document.getElementById("deliver-loading"),
    active: document.getElementById("deliver-active"),
    expired: document.getElementById("deliver-expired"),
    projectName: document.getElementById("deliver-project-name"),
    clientName: document.getElementById("deliver-client-name"),
    idValue: document.getElementById("deliver-id-value"),
    fileSize: document.getElementById("deliver-file-size"),
    uploadDate: document.getElementById("deliver-upload-date"),
    notesWrap: document.getElementById("deliver-notes-wrap"),
    notes: document.getElementById("deliver-notes"),
    countdown: document.getElementById("deliver-countdown"),
    countdownLabel: document.getElementById("deliver-countdown-label"),
    downloadBtn: document.getElementById("deliver-download-btn"),
    successBanner: document.getElementById("deliver-success-banner")
  };

  let countdownTimer = null;
  let currentDelivery = null;

  function showState(state) {
    els.loading.style.display = state === "loading" ? "block" : "none";
    els.active.style.display = state === "active" ? "block" : "none";
    els.expired.style.display = state === "expired" ? "block" : "none";
  }

  function renderDelivery(delivery) {
    currentDelivery = delivery;
    els.projectName.textContent = delivery.project_name || "Your Delivery";
    els.clientName.textContent = delivery.client_name ? `Prepared for ${delivery.client_name}` : "";
    els.idValue.textContent = delivery.id;
    els.fileSize.textContent = formatBytes(delivery.file_size);
    els.uploadDate.textContent = formatDate(delivery.created_at);

    if (delivery.notes) {
      els.notesWrap.style.display = "block";
      els.notes.textContent = delivery.notes;
    }

    document.title = `${delivery.project_name || "Delivery"} | Boztik Deliver`;
    updateCountdown();
    countdownTimer = setInterval(updateCountdown, 1000);
    showState("active");
  }

  function updateCountdown() {
    if (!currentDelivery) return;
    const { expired, label } = getCountdown(currentDelivery.expires_at);
    if (expired) {
      clearInterval(countdownTimer);
      showState("expired");
      return;
    }
    els.countdownLabel.textContent = label;
    const target = new Date(currentDelivery.expires_at).getTime();
    els.countdown.classList.toggle("is-urgent", target - Date.now() < 3_600_000);
  }

  async function handleDownload() {
    if (!currentDelivery) return;
    els.downloadBtn.disabled = true;
    els.downloadBtn.querySelector("span:last-child").textContent = "Preparing download…";

    try {
      const supabase = getSupabaseClient();

      // Fire-and-forget download counter via SECURITY DEFINER RPC so
      // anonymous visitors can only increment, never read/write anything else.
      supabase.rpc("increment_delivery_downloads", { p_delivery_id: currentDelivery.id }).then(
        () => {},
        () => {}
      );

      const { data, error } = await supabase.storage
        .from(window.BoztikDeliver.config.STORAGE_BUCKET)
        .createSignedUrl(currentDelivery.file_path, 60, {
          download: currentDelivery.file_name || "delivery.zip"
        });

      if (error || !data?.signedUrl) throw error || new Error("Could not create download link");

      const a = document.createElement("a");
      a.href = data.signedUrl;
      a.download = currentDelivery.file_name || "delivery.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();

      els.successBanner.classList.add("is-visible");
      showToast("Download started — thank you for choosing Boztik.");
    } catch (err) {
      console.error("[Boztik Deliver] download failed:", err);
      showToast("Something went wrong starting your download. Please refresh and try again.", "error");
    } finally {
      els.downloadBtn.disabled = false;
      els.downloadBtn.querySelector("span:last-child").textContent = "Download Files";
    }
  }

  async function init() {
    showState("loading");
    const params = new URLSearchParams(window.location.search);
    const id = (params.get("id") || "").trim().toUpperCase();

    if (!id) {
      showState("expired");
      return;
    }

    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("deliveries_public")
        .select("id, project_name, client_name, notes, file_name, file_size, created_at, expires_at, file_path")
        .eq("id", id)
        .maybeSingle();

      if (error || !data) {
        showState("expired");
        return;
      }

      const { expired } = getCountdown(data.expires_at);
      if (expired) {
        showState("expired");
        return;
      }

      renderDelivery(data);
    } catch (err) {
      console.error("[Boztik Deliver] failed to load delivery:", err);
      showState("expired");
    }
  }

  els.downloadBtn.addEventListener("click", handleDownload);
  document.addEventListener("DOMContentLoaded", init);
  if (document.readyState !== "loading") init();
})();
