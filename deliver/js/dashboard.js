import {
  supabase,
  formatBytes,
  formatDate,
  toast,
  escapeHtml,
  deliveryId,
  isValidFile
} from "./shared.js";

import {
  listDeliveries,
  createDelivery,
  deleteDelivery,
  duplicateDelivery
} from "./api.js";

import {
  config
} from "./config.js";


/* =========================================================
   BOZTIK DELIVER DASHBOARD
   Complete dashboard controller
========================================================= */


/* =========================================================
   DOM HELPER
========================================================= */

const $ = id => document.getElementById(id);


/* =========================================================
   ELEMENTS
========================================================= */

const els = {

  /* Authentication */
  loginView: $("dash-login-view"),
  mainView: $("dash-main-view"),

  loginForm: $("dash-login-form"),
  email: $("dash-email"),
  password: $("dash-password"),
  loginButton: $("dash-login-btn"),
  loginError: $("dash-login-error"),
  logout: $("dash-logout-link"),

  /* Dashboard */
  refresh: $("dash-refresh"),

  /* Statistics */
  activeCount: $("stat-active-count"),
  downloadCount: $("stat-download-count"),
  storageUsed: $("stat-storage-used"),
  totalCount: $("stat-total-count"),

  /* Analytics */
  monthlyViews: $("delivery-monthly-views"),
  monthlyDownloads: $("delivery-monthly-downloads"),
  lifetimeViews: $("delivery-lifetime-views"),
  lifetimeDownloads: $("delivery-lifetime-downloads"),

  /* Upload */
  uploadForm: $("dash-upload-form"),
  dropzone: $("dash-dropzone"),
  fileInput: $("dash-file-input"),
  fileList: $("dash-file-list"),

  clientName: $("dash-client-name"),
  projectName: $("dash-project-name"),
  notes: $("dash-notes"),
  expiry: $("dash-expiry"),

  progress: $("dash-progress"),
  progressBar: $("dash-progress-bar"),
  uploadButton: $("dash-upload-btn"),

  /* Deliveries */
  deliveriesList: $("dash-deliveries-list"),
  search: $("dash-search"),
  filter: $("dash-filter"),
  sort: $("dash-sort"),

  /* Confirmation */
  confirmDialog: $("dash-confirm"),
  confirmText: $("dash-confirm-text"),
  confirmAction: $("dash-confirm-action"),

  /* Success */
  successDialog: $("dash-success"),
  successMeta: $("dash-success-meta"),
  successLink: $("dash-success-link"),
  successCopy: $("dash-success-copy"),
  successCopyStatus: $("dash-success-copy-status"),
  successOpen: $("dash-success-open")

};


/* =========================================================
   STATE
========================================================= */

let deliveries = [];
let selectedFiles = [];
let pendingConfirmAction = null;
let cleanupRunning = false;


/* =========================================================
   AUTHENTICATION UI
========================================================= */

function showLogin() {

  if (els.loginView) {
    els.loginView.hidden = false;
  }

  if (els.mainView) {
    els.mainView.hidden = true;
  }

  if (els.logout) {
    els.logout.hidden = true;
  }

}


function showDashboard() {

  if (els.loginView) {
    els.loginView.hidden = true;
  }

  if (els.mainView) {
    els.mainView.hidden = false;
  }

  if (els.logout) {
    els.logout.hidden = false;
  }

}


/* =========================================================
   LOGIN ERROR
========================================================= */

function setLoginError(message) {

  if (!els.loginError) {
    return;
  }

  els.loginError.textContent =
    message || "";

  els.loginError.hidden =
    !message;

}


/* =========================================================
   LOGIN LOADING
========================================================= */

function setLoginLoading(loading) {

  if (!els.loginButton) {
    return;
  }

  els.loginButton.disabled =
    loading;

  els.loginButton.textContent =
    loading
      ? "Signing in…"
      : "Sign in";

}


/* =========================================================
   FRIENDLY AUTH ERRORS
========================================================= */

function friendlyAuthError(error) {

  const message =
    error?.message ||
    "";

  const normalized =
    message.toLowerCase();


  if (
    normalized.includes(
      "invalid login credentials"
    )
  ) {

    return (
      "The email or password is incorrect. " +
      "Please check your credentials and try again."
    );

  }


  if (
    normalized.includes(
      "email not confirmed"
    )
  ) {

    return (
      "This administrator email has not been confirmed in Supabase."
    );

  }


  if (
    normalized.includes("failed to fetch") ||
    normalized.includes("network")
  ) {

    return (
      "Could not connect to Supabase. " +
      "Please check your internet connection and try again."
    );

  }


  return (
    message ||
    "Unable to sign in. Please try again."
  );

}


/* =========================================================
   LOGIN
========================================================= */

async function handleLogin(event) {

  event.preventDefault();

  setLoginError("");

  const email =
    els.email?.value.trim();

  const password =
    els.password?.value || "";


  if (!email || !password) {

    setLoginError(
      "Please enter your email and password."
    );

    return;
  }


  setLoginLoading(true);


  try {

    const client =
      supabase();


    const {
      data,
      error
    } =
      await client.auth.signInWithPassword({
        email,
        password
      });


    if (error) {
      throw error;
    }


    if (!data?.session) {

      throw new Error(
        "Login succeeded but no active session was created."
      );

    }


    setLoginError("");

    if (els.password) {
      els.password.value = "";
    }


    showDashboard();

    await load();


  } catch (error) {

    console.error(
      "[Boztik Deliver] Login failed:",
      error
    );

    setLoginError(
      friendlyAuthError(error)
    );

  } finally {

    setLoginLoading(false);

  }

}


/* =========================================================
   LOGOUT
========================================================= */

async function handleLogout(event) {

  event.preventDefault();


  try {

    const client =
      supabase();


    const {
      error
    } =
      await client.auth.signOut();


    if (error) {
      throw error;
    }


    deliveries = [];

    showLogin();

    setLoginError("");


    toast(
      "You have been logged out."
    );


  } catch (error) {

    console.error(
      "[Boztik Deliver] Logout failed:",
      error
    );


    toast(
      "Could not log out. Please try again.",
      "error"
    );

  }

}


/* =========================================================
   SESSION INITIALISATION
========================================================= */

async function initialiseAuthentication() {

  try {

    const client =
      supabase();


    const {
      data,
      error
    } =
      await client.auth.getSession();


    if (error) {
      throw error;
    }


    if (data?.session) {

      showDashboard();

      await load();

    } else {

      showLogin();

    }


    client.auth.onAuthStateChange(
      async (_event, session) => {

        if (session) {

          showDashboard();

        } else {

          deliveries = [];

          showLogin();

        }

      }
    );


  } catch (error) {

    console.error(
      "[Boztik Deliver] Authentication initialisation failed:",
      error
    );


    showLogin();


    setLoginError(
      "Could not initialise secure login. " +
      "Please refresh the page and try again."
    );

  }

}


/* =========================================================
   EXPIRY
========================================================= */

function isExpired(delivery) {

  if (!delivery?.expires_at) {
    return false;
  }

  const timestamp =
    new Date(
      delivery.expires_at
    ).getTime();


  if (!Number.isFinite(timestamp)) {
    return false;
  }


  return timestamp <= Date.now();

}


/* =========================================================
   EXPIRING SOON
========================================================= */

function isExpiringSoon(delivery) {

  if (
    !delivery?.expires_at ||
    isExpired(delivery)
  ) {
    return false;
  }


  const expiry =
    new Date(
      delivery.expires_at
    ).getTime();


  const twentyFourHours =
    24 * 60 * 60 * 1000;


  return (
    expiry - Date.now() <=
    twentyFourHours
  );

}


/* =========================================================
   ANALYTICS TOTALS
========================================================= */

function getMonthlyTotals(items) {

  return items.reduce(
    (totals, delivery) => {

      totals.views +=
        Number(
          delivery.monthly_views || 0
        );


      totals.downloads +=
        Number(
          delivery.monthly_downloads || 0
        );


      return totals;

    },
    {
      views: 0,
      downloads: 0
    }
  );

}


function getLifetimeTotals(items) {

  return items.reduce(
    (totals, delivery) => {

      totals.views +=
        Number(
          delivery.lifetime_views ||
          delivery.view_count ||
          0
        );


      totals.downloads +=
        Number(
          delivery.lifetime_downloads ||
          delivery.download_count ||
          0
        );


      return totals;

    },
    {
      views: 0,
      downloads: 0
    }
  );

}


/* =========================================================
   SUMMARY
========================================================= */

function renderSummary() {

  const total =
    deliveries.length;


  const expired =
    deliveries.filter(
      isExpired
    ).length;


  const active =
    total - expired;


  const downloads =
    deliveries.reduce(
      (sum, delivery) =>
        sum +
        Number(
          delivery.download_count || 0
        ),
      0
    );


  const storage =
    deliveries.reduce(
      (sum, delivery) =>
        sum +
        Number(
          delivery.file_size || 0
        ),
      0
    );


  const monthly =
    getMonthlyTotals(
      deliveries
    );


  const lifetime =
    getLifetimeTotals(
      deliveries
    );


  if (els.activeCount) {

    els.activeCount.textContent =
      active;

  }


  if (els.downloadCount) {

    els.downloadCount.textContent =
      downloads;

  }


  if (els.storageUsed) {

    els.storageUsed.textContent =
      formatBytes(storage);

  }


  if (els.totalCount) {

    els.totalCount.textContent =
      total;

  }


  if (els.monthlyViews) {

    els.monthlyViews.textContent =
      monthly.views;

  }


  if (els.monthlyDownloads) {

    els.monthlyDownloads.textContent =
      monthly.downloads;

  }


  if (els.lifetimeViews) {

    els.lifetimeViews.textContent =
      lifetime.views;

  }


  if (els.lifetimeDownloads) {

    els.lifetimeDownloads.textContent =
      lifetime.downloads;

  }

}


/* =========================================================
   DELIVERY URL
========================================================= */

function buildDeliveryUrl(id) {

  const url =
    new URL(
      "index.html",
      window.location.href
    );


  url.searchParams.set(
    "id",
    id
  );


  return url.href;

}


/* =========================================================
   FILTER / SORT
========================================================= */

function getVisibleDeliveries() {

  let items =
    [...deliveries];


  const searchTerm =
    els.search?.value
      .trim()
      .toLowerCase() ||
    "";


  const filter =
    els.filter?.value ||
    "all";


  const sort =
    els.sort?.value ||
    "recent";


  if (searchTerm) {

    items =
      items.filter(
        delivery => {

          const project =
            String(
              delivery.project_name || ""
            ).toLowerCase();


          const client =
            String(
              delivery.client_name || ""
            ).toLowerCase();


          return (
            project.includes(
              searchTerm
            ) ||
            client.includes(
              searchTerm
            )
          );

        }
      );

  }


  if (filter === "active") {

    items =
      items.filter(
        delivery =>
          !isExpired(delivery)
      );

  }


  if (filter === "expired") {

    items =
      items.filter(
        delivery =>
          isExpired(delivery)
      );

  }


  if (sort === "name") {

    items.sort(
      (a, b) =>
        String(
          a.project_name || ""
        ).localeCompare(
          String(
            b.project_name || ""
          )
        )
    );

  }


  if (sort === "downloads") {

    items.sort(
      (a, b) =>
        Number(
          b.download_count || 0
        ) -
        Number(
          a.download_count || 0
        )
    );

  }


  if (sort === "recent") {

    items.sort(
      (a, b) =>
        new Date(
          b.created_at || 0
        ) -
        new Date(
          a.created_at || 0
        )
    );

  }


  return items;

}


/* =========================================================
   FILE COUNT
========================================================= */

function getFileCount(delivery) {

  if (
    Array.isArray(
      delivery.delivery_files
    )
  ) {

    return delivery.delivery_files.length;

  }


  return 1;

}


/* =========================================================
   DELIVERY CARD
========================================================= */

function renderDelivery(delivery) {

  const expired =
    isExpired(delivery);


  const expiringSoon =
    isExpiringSoon(delivery);


  const monthlyViews =
    Number(
      delivery.monthly_views || 0
    );


  const monthlyDownloads =
    Number(
      delivery.monthly_downloads || 0
    );


  const lifetimeViews =
    Number(
      delivery.lifetime_views ||
      delivery.view_count ||
      0
    );


  const lifetimeDownloads =
    Number(
      delivery.lifetime_downloads ||
      delivery.download_count ||
      0
    );


  const fileCount =
    getFileCount(
      delivery
    );


  const fileSize =
    Number(
      delivery.file_size || 0
    );


  const card =
    document.createElement(
      "article"
    );


  card.className =
    "delivery-card";


  if (expired) {

    card.classList.add(
      "is-expired"
    );

  }


  if (expiringSoon) {

    card.classList.add(
      "is-expiring-soon"
    );

  }


  let statusText =
    "Active";


  let statusClass =
    "active";


  if (expired) {

    statusText =
      "Expired";

    statusClass =
      "expired";

  } else if (expiringSoon) {

    statusText =
      "Expires soon";

    statusClass =
      "expiring";

  }


  card.innerHTML = `

    <div class="delivery-card-main">


      <!-- ==========================================
           HEADER
      =========================================== -->

      <div class="delivery-card-heading">

        <div class="delivery-title-area">

          <h3>
            ${escapeHtml(
              delivery.project_name ||
              "Untitled delivery"
            )}
          </h3>

          <p>
            ${escapeHtml(
              delivery.client_name ||
              "Client"
            )}
          </p>

        </div>


        <span
          class="
            delivery-status
            ${statusClass}
          "
        >
          ${statusText}
        </span>

      </div>


      <!-- ==========================================
           METADATA
      =========================================== -->

      <div class="delivery-meta">

        <span>
          Created:
          <strong>
            ${formatDate(
              delivery.created_at
            )}
          </strong>
        </span>


        <span>
          Expires:
          <strong>
            ${formatDate(
              delivery.expires_at
            )}
          </strong>
        </span>


        <span>
          Files:
          <strong>
            ${fileCount}
          </strong>
        </span>


        <span>
          Size:
          <strong>
            ${formatBytes(
              fileSize
            )}
          </strong>
        </span>

      </div>


      <!-- ==========================================
           ANALYTICS
      =========================================== -->

      <div class="delivery-analytics">


        <div class="analytics-section">

          <h4>
            This Month
          </h4>


          <div class="analytics-grid">


            <div class="analytics-stat">

              <span class="analytics-label">
                Link Views
              </span>

              <strong>
                ${monthlyViews}
              </strong>

            </div>


            <div class="analytics-stat">

              <span class="analytics-label">
                Downloads
              </span>

              <strong>
                ${monthlyDownloads}
              </strong>

            </div>

          </div>

        </div>


        <div class="analytics-section">

          <h4>
            Lifetime
          </h4>


          <div class="analytics-grid">


            <div class="analytics-stat">

              <span class="analytics-label">
                Link Views
              </span>

              <strong>
                ${lifetimeViews}
              </strong>

            </div>


            <div class="analytics-stat">

              <span class="analytics-label">
                Downloads
              </span>

              <strong>
                ${lifetimeDownloads}
              </strong>

            </div>

          </div>

        </div>

      </div>


      <!-- ==========================================
           ACTIVITY
      =========================================== -->

      <div class="delivery-activity">


        <div class="activity-item">

          <span class="activity-icon">
            👁
          </span>

          <div>

            <span>
              Last viewed
            </span>

            <strong>
              ${
                delivery.last_viewed_at
                  ? formatDate(
                      delivery.last_viewed_at
                    )
                  : "Never"
              }
            </strong>

          </div>

        </div>


        <div class="activity-item">

          <span class="activity-icon">
            ↓
          </span>

          <div>

            <span>
              Last downloaded
            </span>

            <strong>
              ${
                delivery.last_downloaded_at
                  ? formatDate(
                      delivery.last_downloaded_at
                    )
                  : "Never"
              }
            </strong>

          </div>

        </div>

      </div>


      <!-- ==========================================
           ACTIONS
      =========================================== -->

      <div class="delivery-actions">


        <button
          type="button"
          class="btn-open-delivery"
        >
          Open Delivery
        </button>


        <button
          type="button"
          class="btn-copy-link"
        >
          Copy Link
        </button>


        <button
          type="button"
          class="btn-duplicate"
        >
          Duplicate
        </button>


        <button
          type="button"
          class="btn-delete danger"
        >
          Delete
        </button>

      </div>


    </div>

  `;


  /* =======================================================
     OPEN
  ======================================================= */

  card
    .querySelector(
      ".btn-open-delivery"
    )
    .addEventListener(
      "click",
      () => {

        window.open(
          buildDeliveryUrl(
            delivery.id
          ),
          "_blank",
          "noopener,noreferrer"
        );

      }
    );


  /* =======================================================
     COPY
  ======================================================= */

  card
    .querySelector(
      ".btn-copy-link"
    )
    .addEventListener(
      "click",
      async event => {

        const url =
          buildDeliveryUrl(
            delivery.id
          );


        try {

          await navigator.clipboard.writeText(
            url
          );


          const button =
            event.currentTarget;


          const original =
            button.textContent;


          button.textContent =
            "Copied!";


          setTimeout(
            () => {

              button.textContent =
                original;

            },
            1500
          );


          toast(
            "Delivery link copied."
          );


        } catch (error) {

          console.error(
            "[Boztik Deliver] Clipboard error:",
            error
          );


          toast(
            "Could not copy the link.",
            "error"
          );

        }

      }
    );


  /* =======================================================
     DUPLICATE
  ======================================================= */

  card
    .querySelector(
      ".btn-duplicate"
    )
    .addEventListener(
      "click",
      async event => {

        const button =
          event.currentTarget;


        button.disabled =
          true;


        try {

          await duplicateDelivery(
            delivery
          );


          toast(
            "Delivery duplicated."
          );


          await load();


        } catch (error) {

          console.error(
            "[Boztik Deliver] Duplicate failed:",
            error
          );


          toast(
            "Could not duplicate delivery.",
            "error"
          );


        } finally {

          button.disabled =
            false;

        }

      }
    );


  /* =======================================================
     DELETE
  ======================================================= */

  card
    .querySelector(
      ".btn-delete"
    )
    .addEventListener(
      "click",
      () => {

        openConfirm(

          `Delete "${delivery.project_name || "this delivery"}"? This will permanently remove the delivery files.`,

          async () => {

            try {

              await deleteDelivery(
                delivery
              );


              toast(
                "Delivery and files deleted."
              );


              await load();


            } catch (error) {

              console.error(
                "[Boztik Deliver] Delete failed:",
                error
              );


              toast(
                "Could not delete delivery.",
                "error"
              );

            }

          }

        );

      }
    );


  return card;

}


/* =========================================================
   RENDER DELIVERIES
========================================================= */

function renderDeliveries() {

  if (!els.deliveriesList) {
    return;
  }


  els.deliveriesList.innerHTML =
    "";


  const visible =
    getVisibleDeliveries();


  if (!visible.length) {

    const empty =
      document.createElement(
        "div"
      );


    empty.className =
      "delivery-empty";


    empty.textContent =
      deliveries.length
        ? "No deliveries match your search."
        : "No deliveries created yet.";


    els.deliveriesList.append(
      empty
    );


    return;

  }


  visible.forEach(
    delivery => {

      els.deliveriesList.append(
        renderDelivery(
          delivery
        )
      );

    }
  );

}


/* =========================================================
   AUTOMATIC EXPIRED DELIVERY CLEANUP
=========================================================

   IMPORTANT:

   This function calls the secure Edge Function.

   It does NOT contain a Supabase service-role key.

   The Edge Function performs the privileged Storage
   deletion server-side.

   The scheduled server-side job is still required for
   guaranteed automatic cleanup when the dashboard is
   closed.
========================================================= */

async function cleanupExpiredDeliveries() {

  if (cleanupRunning) {
    return;
  }


  cleanupRunning =
    true;


  try {

    const client =
      supabase();


    const {
      data: sessionData,
      error: sessionError
    } =
      await client.auth.getSession();


    if (sessionError) {
      throw sessionError;
    }


    const accessToken =
      sessionData?.session?.access_token;


    if (!accessToken) {
      return;
    }


    const functionUrl =
      `${config.supabaseUrl}/functions/v1/cleanup-expired-deliveries`;


    const response =
      await fetch(
        functionUrl,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "apikey":
              config.supabaseAnonKey,

            "Authorization":
              `Bearer ${accessToken}`
          },

          body: JSON.stringify({})
        }
      );


    let result =
      null;


    try {

      result =
        await response.json();

    } catch {

      result =
        null;

    }


    if (!response.ok) {

      throw new Error(
        result?.message ||
        result?.error ||
        `Cleanup request failed with HTTP ${response.status}.`
      );

    }


    if (
      Number(
        result?.deletedDeliveries || 0
      ) > 0
    ) {

      console.info(
        "[Boztik Deliver] Expired deliveries cleaned up:",
        result.deletedDeliveries
      );

    }

  } catch (error) {

    /*
     * Cleanup failure should NOT prevent the dashboard
     * itself from loading.
     */

    console.warn(
      "[Boztik Deliver] Automatic cleanup request failed:",
      error
    );

  } finally {

    cleanupRunning =
      false;

  }

}


/* =========================================================
   LOAD DELIVERIES
========================================================= */

async function load() {

  try {

    if (els.refresh) {

      els.refresh.disabled =
        true;

      els.refresh.textContent =
        "Refreshing…";

    }


    /*
     * Ask the secure server function to clean up anything
     * that has already expired.
     *
     * This is a convenience cleanup.
     *
     * The scheduled Edge Function handles true automatic
     * background cleanup.
     */

    await cleanupExpiredDeliveries();


    deliveries =
      await listDeliveries();


    renderSummary();

    renderDeliveries();


  } catch (error) {

    console.error(
      "[Boztik Deliver] Failed to load deliveries:",
      error
    );


    const message =
      error?.message?.toLowerCase() ||
      "";


    if (
      message.includes("jwt") ||
      message.includes("token") ||
      message.includes("unauthorized")
    ) {

      toast(
        "Your session has expired. Please sign in again.",
        "error"
      );


      showLogin();

      return;

    }


    toast(
      "Could not load deliveries. Please refresh the page.",
      "error"
    );


  } finally {

    if (els.refresh) {

      els.refresh.disabled =
        false;

      els.refresh.textContent =
        "Refresh";

    }

  }

}


/* =========================================================
   FILE VALIDATION
========================================================= */

function validateSelectedFiles(files) {

  if (!files.length) {
    return;
  }


  if (files.length > 30) {

    toast(
      "You can upload a maximum of 30 files.",
      "error"
    );

    return;

  }


  const invalid =
    files.find(
      file =>
        !isValidFile(file)
    );


  if (invalid) {

    toast(
      `"${invalid.name}" is not a supported file or is too large.`,
      "error"
    );

    return;

  }


  selectedFiles =
    [...files];


  renderFileList();

}


/* =========================================================
   FILE PREVIEWS
========================================================= */

function renderFileList() {

  if (!els.fileList) {
    return;
  }


  els.fileList.innerHTML =
    "";


  selectedFiles.forEach(
    file => {

      const item =
        document.createElement(
          "li"
        );


      item.className =
        "dash-file-item";


      const isImage =
        file.type.startsWith(
          "image/"
        );


      let preview =
        "";


      if (isImage) {

        const url =
          URL.createObjectURL(
            file
          );


        preview = `
          <img
            src="${url}"
            alt=""
            class="dash-file-preview"
          >
        `;


        setTimeout(
          () => {

            URL.revokeObjectURL(
              url
            );

          },
          60000
        );

      }


      item.innerHTML = `

        ${preview}

        <div class="dash-file-info">

          <strong>
            ${escapeHtml(
              file.name
            )}
          </strong>

          <span>
            ${formatBytes(
              file.size
            )}
          </span>

        </div>

      `;


      els.fileList.append(
        item
      );

    }
  );

}


/* =========================================================
   DROPZONE
========================================================= */

function setupDropzone() {

  if (
    !els.dropzone ||
    !els.fileInput
  ) {
    return;
  }


  els.dropzone.addEventListener(
    "click",
    () => {

      els.fileInput.click();

    }
  );


  els.dropzone.addEventListener(
    "keydown",
    event => {

      if (
        event.key === "Enter" ||
        event.key === " "
      ) {

        event.preventDefault();

        els.fileInput.click();

      }

    }
  );


  els.dropzone.addEventListener(
    "dragover",
    event => {

      event.preventDefault();

      els.dropzone.classList.add(
        "is-dragging"
      );

    }
  );


  els.dropzone.addEventListener(
    "dragleave",
    () => {

      els.dropzone.classList.remove(
        "is-dragging"
      );

    }
  );


  els.dropzone.addEventListener(
    "drop",
    event => {

      event.preventDefault();


      els.dropzone.classList.remove(
        "is-dragging"
      );


      validateSelectedFiles(
        [...event.dataTransfer.files]
      );

    }
  );


  els.fileInput.addEventListener(
    "change",
    () => {

      validateSelectedFiles(
        [...els.fileInput.files]
      );

    }
  );

}


/* =========================================================
   UPLOAD
========================================================= */

async function handleUpload(event) {

  event.preventDefault();


  if (!selectedFiles.length) {

    toast(
      "Please select at least one file.",
      "error"
    );

    return;

  }


  const clientName =
    els.clientName?.value.trim();


  const projectName =
    els.projectName?.value.trim();


  const notes =
    els.notes?.value.trim() ||
    "";


  const expiryHours =
    Number(
      els.expiry?.value ||
      config.defaultExpiryHours
    );


  if (!clientName ||
      !projectName) {

    toast(
      "Please enter the client name and project title.",
      "error"
    );

    return;

  }


  if (
    !Number.isFinite(
      expiryHours
    ) ||
    expiryHours <= 0
  ) {

    toast(
      "Please select a valid expiry period.",
      "error"
    );

    return;

  }


  const id =
    deliveryId();


  const expiresAt =
    new Date(
      Date.now() +
      expiryHours *
      60 *
      60 *
      1000
    ).toISOString();


  const metadata = {

    id,

    client_name:
      clientName,

    project_name:
      projectName,

    notes,

    expires_at:
      expiresAt

  };


  try {

    if (els.uploadButton) {

      els.uploadButton.disabled =
        true;

      els.uploadButton.textContent =
        "Uploading…";

    }


    if (els.progress) {

      els.progress.hidden =
        false;

    }


    if (els.progressBar) {

      els.progressBar.style.width =
        "0%";

    }


    await createDelivery(
      metadata,
      selectedFiles,
      progress => {

        if (els.progressBar) {

          els.progressBar.style.width =
            `${Math.round(
              progress * 100
            )}%`;

        }

      }
    );


    const url =
      buildDeliveryUrl(
        id
      );


    if (els.successMeta) {

      els.successMeta.textContent =
        `${projectName} for ${clientName}`;

    }


    if (els.successLink) {

      els.successLink.value =
        url;

    }


    if (els.successOpen) {

      els.successOpen.href =
        url;

    }


    if (els.successCopyStatus) {

      els.successCopyStatus.hidden =
        true;

    }


    if (els.successDialog) {

      els.successDialog.showModal();

    }


    toast(
      "Delivery created successfully."
    );


    els.uploadForm?.reset();


    selectedFiles =
      [];


    renderFileList();


    await load();


  } catch (error) {

    console.error(
      "[Boztik Deliver] Upload failed:",
      error
    );


    toast(
      error?.message ||
      "Could not create the delivery.",
      "error"
    );


  } finally {

    if (els.progress) {

      els.progress.hidden =
        true;

    }


    if (els.progressBar) {

      els.progressBar.style.width =
        "0%";

    }


    if (els.uploadButton) {

      els.uploadButton.disabled =
        false;

      els.uploadButton.textContent =
        "Generate secure delivery";

    }

  }

}


/* =========================================================
   CONFIRMATION DIALOG
========================================================= */

function openConfirm(
  message,
  action
) {

  if (
    !els.confirmDialog ||
    !els.confirmAction
  ) {

    const confirmed =
      window.confirm(
        message
      );


    if (confirmed) {

      action();

    }


    return;

  }


  els.confirmText.textContent =
    message;


  pendingConfirmAction =
    action;


  els.confirmDialog.showModal();

}


/* =========================================================
   CONFIRM ACTION
========================================================= */

if (els.confirmAction) {

  els.confirmAction.addEventListener(
    "click",
    async () => {

      const action =
        pendingConfirmAction;


      pendingConfirmAction =
        null;


      els.confirmDialog.close();


      if (action) {

        try {

          await action();

        } catch (error) {

          console.error(
            "[Boztik Deliver] Confirmation action failed:",
            error
          );

        }

      }

    }
  );

}


/* =========================================================
   SUCCESS COPY
========================================================= */

if (els.successCopy) {

  els.successCopy.addEventListener(
    "click",
    async () => {

      const value =
        els.successLink?.value;


      if (!value) {
        return;
      }


      try {

        await navigator.clipboard.writeText(
          value
        );


        if (els.successCopyStatus) {

          els.successCopyStatus.textContent =
            "Link copied to clipboard.";

          els.successCopyStatus.hidden =
            false;

        }


        toast(
          "Client download link copied."
        );


      } catch (error) {

        console.error(
          "[Boztik Deliver] Copy failed:",
          error
        );


        toast(
          "Could not copy the link.",
          "error"
        );

      }

    }
  );

}


/* =========================================================
   EVENT LISTENERS
========================================================= */

if (els.loginForm) {

  els.loginForm.addEventListener(
    "submit",
    handleLogin
  );

}


if (els.logout) {

  els.logout.addEventListener(
    "click",
    handleLogout
  );

}


if (els.refresh) {

  els.refresh.addEventListener(
    "click",
    load
  );

}


if (els.uploadForm) {

  els.uploadForm.addEventListener(
    "submit",
    handleUpload
  );

}


if (els.search) {

  els.search.addEventListener(
    "input",
    renderDeliveries
  );

}


if (els.filter) {

  els.filter.addEventListener(
    "change",
    renderDeliveries
  );

}


if (els.sort) {

  els.sort.addEventListener(
    "change",
    renderDeliveries
  );

}


/* =========================================================
   START
========================================================= */

setupDropzone();

initialiseAuthentication();