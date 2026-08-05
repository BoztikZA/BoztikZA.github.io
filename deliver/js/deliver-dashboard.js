/**
 * Boztik Deliver — admin dashboard logic
 * Handles Supabase Auth login/session, ZIP upload to Storage,
 * delivery row creation, listing, copy-link, and delete.
 */

(function () {
  "use strict";

  const { getSupabaseClient, generateDeliveryId, formatBytes, formatDate, getCountdown, escapeHtml, buildDeliveryLink, showToast, config } =
    window.BoztikDeliver;

  const supabase = getSupabaseClient();

  const els = {
    loginView: document.getElementById("dash-login-view"),
    mainView: document.getElementById("dash-main-view"),
    loginForm: document.getElementById("dash-login-form"),
    loginBtn: document.getElementById("dash-login-btn"),
    loginError: document.getElementById("dash-login-error"),
    logoutLink: document.getElementById("dash-logout-link"),

    uploadForm: document.getElementById("dash-upload-form"),
    dropzone: document.getElementById("dash-dropzone"),
    fileInput: document.getElementById("dash-file-input"),
    fileChip: document.getElementById("dash-file-chip"),
    fileChipName: document.getElementById("dash-file-chip-name"),
    fileChipRemove: document.getElementById("dash-file-chip-remove"),
    clientName: document.getElementById("dash-client-name"),
    projectName: document.getElementById("dash-project-name"),
    notes: document.getElementById("dash-notes"),
    expiry: document.getElementById("dash-expiry"),
    progress: document.getElementById("dash-progress"),
    progressBar: document.getElementById("dash-progress-bar"),
    uploadBtn: document.getElementById("dash-upload-btn"),
    uploadError: document.getElementById("dash-upload-error"),

    list: document.getElementById("dash-deliveries-list"),
    statActive: document.getElementById("stat-active-count"),
    statDownloads: document.getElementById("stat-download-count"),
    statStorage: document.getElementById("stat-storage-used"),
    statTotal: document.getElementById("stat-total-count")
  };

  let selectedFile = null;

  // ---------------------------------------------------------------------
  // AUTH
  // ---------------------------------------------------------------------

  async function checkSession() {
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      showDashboard();
    } else {
      showLogin();
    }
  }

  function showLogin() {
    els.loginView.style.display = "block";
    els.mainView.style.display = "none";
    els.logoutLink.style.display = "none";
  }

  function showDashboard() {
    els.loginView.style.display = "none";
    els.mainView.style.display = "block";
    els.logoutLink.style.display = "inline";
    loadDeliveries();
  }

  els.loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    els.loginError.classList.remove("is-visible");
    els.loginBtn.disabled = true;
    els.loginBtn.textContent = "Signing in…";

    const email = document.getElementById("dash-email").value.trim();
    const password = document.getElementById("dash-password").value;

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    els.loginBtn.disabled = false;
    els.loginBtn.textContent = "Sign In";

    if (error) {
      els.loginError.textContent = "Invalid email or password.";
      els.loginError.classList.add("is-visible");
      return;
    }
    showDashboard();
  });

  els.logoutLink.addEventListener("click", async (e) => {
    e.preventDefault();
    await supabase.auth.signOut();
    showLogin();
  });

  // ---------------------------------------------------------------------
  // FILE SELECTION
  // ---------------------------------------------------------------------

  function setSelectedFile(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".zip")) {
      showToast("Only ZIP files are accepted.", "error");
      return;
    }
    if (file.size > config.MAX_UPLOAD_BYTES) {
      showToast(`File exceeds the ${formatBytes(config.MAX_UPLOAD_BYTES)} limit.`, "error");
      return;
    }
    selectedFile = file;
    els.fileChipName.textContent = `${file.name} (${formatBytes(file.size)})`;
    els.fileChip.classList.add("is-visible");
  }

  els.dropzone.addEventListener("click", () => els.fileInput.click());
  els.dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      els.fileInput.click();
    }
  });
  els.fileInput.addEventListener("change", (e) => setSelectedFile(e.target.files[0]));

  ["dragenter", "dragover"].forEach((evt) =>
    els.dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      els.dropzone.classList.add("is-dragover");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    els.dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      els.dropzone.classList.remove("is-dragover");
    })
  );
  els.dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    setSelectedFile(file);
  });
  els.fileChipRemove.addEventListener("click", () => {
    selectedFile = null;
    els.fileInput.value = "";
    els.fileChip.classList.remove("is-visible");
  });

  // ---------------------------------------------------------------------
  // UPLOAD / CREATE DELIVERY
  // ---------------------------------------------------------------------

  els.uploadForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    els.uploadError.classList.remove("is-visible");

    if (!selectedFile) {
      els.uploadError.textContent = "Please choose a ZIP file to upload.";
      els.uploadError.classList.add("is-visible");
      return;
    }

    els.uploadBtn.disabled = true;
    els.uploadBtn.textContent = "Uploading…";
    els.progress.classList.add("is-visible");
    els.progressBar.style.width = "10%";

    try {
      const deliveryId = generateDeliveryId();
      const safeFileName = selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const filePath = `${deliveryId}/${safeFileName}`;
      const expiryHours = parseInt(els.expiry.value, 10) || config.DEFAULT_EXPIRY_HOURS;
      const expiresAt = new Date(Date.now() + expiryHours * 3_600_000).toISOString();

      const { error: uploadError } = await supabase.storage
        .from(config.STORAGE_BUCKET)
        .upload(filePath, selectedFile, {
          cacheControl: "3600",
          upsert: false,
          contentType: "application/zip"
        });

      if (uploadError) throw uploadError;
      els.progressBar.style.width = "70%";

      const { error: insertError } = await supabase.from("deliveries").insert({
        id: deliveryId,
        client_name: els.clientName.value.trim(),
        project_name: els.projectName.value.trim(),
        notes: els.notes.value.trim() || null,
        file_path: filePath,
        file_name: selectedFile.name,
        file_size: selectedFile.size,
        expires_at: expiresAt
      });

      if (insertError) throw insertError;

      els.progressBar.style.width = "100%";
      showToast(`Delivery ${deliveryId} created.`);

      const link = buildDeliveryLink(deliveryId);
      try {
        await navigator.clipboard.writeText(link);
        showToast("Client link copied to clipboard.");
      } catch {
        /* clipboard permission denied — non-fatal */
      }

      els.uploadForm.reset();
      selectedFile = null;
      els.fileChip.classList.remove("is-visible");
      loadDeliveries();
    } catch (err) {
      console.error("[Boztik Deliver] upload failed:", err);
      els.uploadError.textContent = err.message || "Upload failed. Please try again.";
      els.uploadError.classList.add("is-visible");
    } finally {
      els.uploadBtn.disabled = false;
      els.uploadBtn.textContent = "Generate Delivery";
      setTimeout(() => {
        els.progress.classList.remove("is-visible");
        els.progressBar.style.width = "0%";
      }, 800);
    }
  });

  // ---------------------------------------------------------------------
  // LIST / STATS
  // ---------------------------------------------------------------------

  async function loadDeliveries() {
    els.list.innerHTML = `<div class="dash-empty-state">Loading deliveries…</div>`;

    const { data, error } = await supabase
      .from("deliveries")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      els.list.innerHTML = `<div class="dash-empty-state">Failed to load deliveries.</div>`;
      console.error(error);
      return;
    }

    renderStats(data);
    renderList(data);
  }

  function renderStats(deliveries) {
    const activeCount = deliveries.filter((d) => !getCountdown(d.expires_at).expired).length;
    const totalDownloads = deliveries.reduce((sum, d) => sum + (d.download_count || 0), 0);
    const totalStorage = deliveries.reduce((sum, d) => sum + (d.file_size || 0), 0);

    els.statActive.textContent = activeCount;
    els.statDownloads.textContent = totalDownloads;
    els.statStorage.textContent = formatBytes(totalStorage);
    els.statTotal.textContent = deliveries.length;
  }

  function renderList(deliveries) {
    if (!deliveries.length) {
      els.list.innerHTML = `<div class="dash-empty-state">No deliveries yet. Create your first one on the left.</div>`;
      return;
    }

    els.list.innerHTML = deliveries
      .map((d) => {
        const { expired, label } = getCountdown(d.expires_at);
        return `
        <div class="dash-delivery-item" data-id="${escapeHtml(d.id)}" data-path="${escapeHtml(d.file_path)}">
          <div class="dash-delivery-top">
            <div>
              <h3>${escapeHtml(d.project_name)}</h3>
              <small>${escapeHtml(d.client_name)} · ${escapeHtml(d.id)}</small>
            </div>
            <span class="dash-status-badge ${expired ? "dash-status-badge--expired" : "dash-status-badge--active"}">
              ${expired ? "Expired" : "Active"}
            </span>
          </div>
          <div class="dash-delivery-meta">
            <span>📦 ${formatBytes(d.file_size)}</span>
            <span>📅 ${formatDate(d.created_at)}</span>
            <span>⬇ ${d.download_count || 0} downloads</span>
            <span>${expired ? "Expired" : "⏳ " + label}</span>
          </div>
          <div class="dash-delivery-actions">
            <button type="button" class="dash-copy-btn">Copy Link</button>
            <button type="button" class="dash-delete-btn is-danger">Delete</button>
          </div>
        </div>`;
      })
      .join("");

    els.list.querySelectorAll(".dash-copy-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const id = e.target.closest(".dash-delivery-item").dataset.id;
        navigator.clipboard.writeText(buildDeliveryLink(id)).then(() => showToast("Link copied."));
      });
    });

    els.list.querySelectorAll(".dash-delete-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => handleDelete(e.target.closest(".dash-delivery-item")));
    });
  }

  async function handleDelete(item) {
    const id = item.dataset.id;
    const path = item.dataset.path;
    if (!confirm(`Delete delivery ${id}? This permanently removes the file.`)) return;

    try {
      const { error: storageError } = await supabase.storage.from(config.STORAGE_BUCKET).remove([path]);
      if (storageError) throw storageError;

      const { error: dbError } = await supabase.from("deliveries").delete().eq("id", id);
      if (dbError) throw dbError;

      showToast(`Delivery ${id} deleted.`);
      loadDeliveries();
    } catch (err) {
      console.error("[Boztik Deliver] delete failed:", err);
      showToast("Failed to delete delivery.", "error");
    }
  }

  checkSession();
})();
