import {
  supabase,
  formatBytes,
  formatDate,
  countdown,
  toast,
  escapeHtml,
  deliveryId,
  isValidFile
} from "./shared.js";

import {
  listDeliveries,
  createDelivery,
  updateDelivery,
  deleteDelivery,
  duplicateDelivery,
  fetchRedditMetadata
} from "./api.js";

import {
  config
} from "./config.js";


/* =========================================================
   BOZTIK DELIVER — DASHBOARD
   =========================================================
   This file is designed to work with the current dashboard
   HTML structure using:

     data-tab
     data-panel

   It intentionally does not depend on the old:

     data-dash-tab
     data-dash-panel
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

  /* Main statistics */
  activeCount: $("stat-active-count"),
  downloadCount: $("stat-download-count"),
  storageUsed: $("stat-storage-used"),
  totalCount: $("stat-total-count"),

  /* Analytics */
  monthlyViews: $("delivery-monthly-views"),
  monthlyDownloads: $("delivery-monthly-downloads"),
  lifetimeViews: $("delivery-lifetime-views"),
  lifetimeDownloads: $("delivery-lifetime-downloads"),

  /* Overview analytics */
  overviewMonthlyViews: $("overview-monthly-views"),
  overviewMonthlyDownloads: $("overview-monthly-downloads"),

  /* Upload */
  uploadForm: $("dash-upload-form"),
  dropzone: $("dash-dropzone"),
  fileInput: $("dash-file-input"),
  fileList: $("dash-file-list"),

  clientName: $("dash-client-name"),
  projectName: $("dash-project-name"),
  notes: $("dash-notes"),
  expiry: $("dash-expiry"),

  sourcePicker: $("dash-source-picker"),
  redditField: $("dash-reddit-field"),
  redditUrl: $("dash-reddit-url"),
  redditStatus: $("dash-reddit-status"),

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
  successOpen: $("dash-success-open"),

  /* Edit delivery */
  editDialog: $("dash-edit"),
  editForm: $("dash-edit-form"),
  editProjectName: $("edit-project-name"),
  editClientName: $("edit-client-name"),
  editNotes: $("edit-notes"),
  editSource: $("edit-source"),
  editRedditField: $("edit-reddit-field"),
  editRedditUrl: $("edit-reddit-url"),
  editExpiry: $("edit-expiry"),
  editError: $("dash-edit-error"),
  editSave: $("dash-edit-save"),
  editCancel: $("dash-edit-cancel")

};


/* =========================================================
   STATE
========================================================= */

let deliveries = [];
let selectedFiles = [];
let pendingConfirmAction = null;
let authListener = null;
let editingDelivery = null;
let editSaving = false;

let selectedSource = "reddit";
let redditMeta = null;
let redditFetchToken = 0;

const SOURCE_LABELS = {
  reddit: "Reddit",
  private: "Private Client",
  paid: "Paid Client",
  free: "Free Edit",
  returning: "Returning Client",
  other: "Other"
};


/* =========================================================
   CONSTANTS
========================================================= */

const MAX_FILES = 30;

const TAB_STORAGE_KEY =
  "boztik-deliver-dashboard-tab";


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


function setLoginError(message = "") {

  if (!els.loginError) {
    return;
  }

  els.loginError.textContent = message;
  els.loginError.hidden = !message;

}


function setLoginLoading(loading) {

  if (!els.loginButton) {
    return;
  }

  els.loginButton.disabled = loading;

  els.loginButton.textContent =
    loading
      ? "Signing in…"
      : "Sign in";

}


/* =========================================================
   AUTH ERROR HANDLING
========================================================= */

function friendlyAuthError(error) {

  const message =
    String(error?.message || "");

  const normalized =
    message.toLowerCase();


  if (
    normalized.includes("invalid login credentials") ||
    normalized.includes("invalid credentials")
  ) {

    return (
      "The email or password is incorrect. " +
      "Please check your credentials and try again."
    );

  }


  if (
    normalized.includes("email not confirmed")
  ) {

    return (
      "This administrator email has not been confirmed " +
      "in Supabase."
    );

  }


  if (
    normalized.includes("failed to fetch") ||
    normalized.includes("network") ||
    normalized.includes("fetch")
  ) {

    return (
      "Could not connect to Supabase. " +
      "Please check your internet connection and try again."
    );

  }


  if (
    normalized.includes("rate limit")
  ) {

    return (
      "Too many login attempts. Please wait a moment " +
      "and try again."
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
    els.email?.value.trim() || "";

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
    selectedFiles = [];


    renderFileList();
    renderSummary();
    renderDeliveries();


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
   AUTH SESSION CHECK
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


    /*
      Prevent duplicate auth listeners if this function
      is ever called again.
    */

    if (authListener) {
      authListener.subscription.unsubscribe();
      authListener = null;
    }


    authListener =
      client.auth.onAuthStateChange(
        async (_event, session) => {

          if (session) {

            showDashboard();

          } else {

            deliveries = [];

            showLogin();

            renderSummary();
            renderDeliveries();

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


/*
 * Three-state status used for the Command Centre badge:
 * "active" (base styling), "warn" (expiring within 6 hours),
 * "expired". Always derived live from the backend expires_at
 * timestamp — never a stored/cached flag.
 */
const EXPIRING_SOON_WINDOW_MS = 6 * 3600000;

function getDeliveryStatus(delivery) {

  if (!delivery?.expires_at) {
    return { key: "active", label: "Active" };
  }

  const remainingMs =
    new Date(delivery.expires_at).getTime() - Date.now();

  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return { key: "expired", label: "Expired" };
  }

  if (remainingMs <= EXPIRING_SOON_WINDOW_MS) {
    return { key: "warn", label: "Expiring Soon" };
  }

  return { key: "active", label: "Active" };

}


/* =========================================================
   ANALYTICS HELPERS
========================================================= */

function getMonthlyTotals(items) {

  return items.reduce(
    (totals, delivery) => {

      totals.views += Number(
        delivery.monthly_views || 0
      );


      totals.downloads += Number(
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

      totals.views += Number(
        delivery.lifetime_views ??
        delivery.view_count ??
        0
      );


      totals.downloads += Number(
        delivery.lifetime_downloads ??
        delivery.download_count ??
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
    Math.max(
      0,
      total - expired
    );


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


  /* -------------------------------------------------------
     MAIN STATISTICS
  ------------------------------------------------------- */

  if (els.activeCount) {
    els.activeCount.textContent = active;
  }


  if (els.downloadCount) {
    els.downloadCount.textContent = downloads;
  }


  if (els.storageUsed) {
    els.storageUsed.textContent =
      formatBytes(storage);
  }


  if (els.totalCount) {
    els.totalCount.textContent = total;
  }


  /* -------------------------------------------------------
     ANALYTICS
  ------------------------------------------------------- */

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


  /* -------------------------------------------------------
     OVERVIEW
  ------------------------------------------------------- */

  if (els.overviewMonthlyViews) {
    els.overviewMonthlyViews.textContent =
      monthly.views;
  }


  if (els.overviewMonthlyDownloads) {
    els.overviewMonthlyDownloads.textContent =
      monthly.downloads;
  }

}


/* =========================================================
   DELIVERY URL
========================================================= */

function buildDeliveryUrl(id) {

  if (!id) {
    return "";
  }


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
   DASHBOARD TABS
========================================================= */

function setupDashboardTabs() {

  /*
    IMPORTANT:

    Current HTML uses:

      data-tab="overview"
      data-panel="overview"

    NOT:

      data-dash-tab
      data-dash-panel
  */

  const tabs =
    document.querySelectorAll(
      "[data-tab]"
    );


  const panels =
    document.querySelectorAll(
      "[data-panel]"
    );


  if (!tabs.length) {

    console.warn(
      "[Boztik Deliver] No dashboard tabs found."
    );

    return;

  }


  function activateTab(tabName) {

    const validTab =
      [...tabs].some(
        tab =>
          tab.dataset.tab ===
          tabName
      );


    if (!validTab) {
      tabName = tabs[0]?.dataset.tab;
    }


    tabs.forEach(
      tab => {

        const active =
          tab.dataset.tab ===
          tabName;


        tab.classList.toggle(
          "is-active",
          active
        );


        tab.setAttribute(
          "aria-selected",
          active
            ? "true"
            : "false"
        );


        tab.setAttribute(
          "tabindex",
          active
            ? "0"
            : "-1"
        );

      }
    );


    panels.forEach(
      panel => {

        const active =
          panel.dataset.panel ===
          tabName;


        panel.hidden =
          !active;


        panel.classList.toggle(
          "is-active",
          active
        );

      }
    );


    try {

      localStorage.setItem(
        TAB_STORAGE_KEY,
        tabName
      );

    } catch (error) {

      console.warn(
        "[Boztik Deliver] Could not save dashboard tab:",
        error
      );

    }

  }


  tabs.forEach(
    tab => {

      tab.addEventListener(
        "click",
        () => {

          activateTab(
            tab.dataset.tab
          );

        }
      );


      /*
        Keyboard support for the tab list.
      */

      tab.addEventListener(
        "keydown",
        event => {

          if (
            event.key !== "ArrowRight" &&
            event.key !== "ArrowLeft" &&
            event.key !== "Home" &&
            event.key !== "End"
          ) {
            return;
          }


          event.preventDefault();


          const tabArray =
            [...tabs];


          const currentIndex =
            tabArray.indexOf(
              tab
            );


          let nextIndex =
            currentIndex;


          if (
            event.key ===
            "ArrowRight"
          ) {

            nextIndex =
              (currentIndex + 1) %
              tabArray.length;

          }


          if (
            event.key ===
            "ArrowLeft"
          ) {

            nextIndex =
              (
                currentIndex -
                1 +
                tabArray.length
              ) %
              tabArray.length;

          }


          if (
            event.key ===
            "Home"
          ) {

            nextIndex = 0;

          }


          if (
            event.key ===
            "End"
          ) {

            nextIndex =
              tabArray.length - 1;

          }


          const nextTab =
            tabArray[nextIndex];


          if (nextTab) {

            activateTab(
              nextTab.dataset.tab
            );

            nextTab.focus();

          }

        }
      );

    }
  );


  /*
    Buttons such as:

      View analytics →
      Create a delivery
      View all →
      + New delivery

    use data-open-tab.
  */

  document
    .querySelectorAll(
      "[data-open-tab]"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () => {

            activateTab(
              button.dataset.openTab
            );

          }
        );

      }
    );


  let initialTab =
    "overview";


  try {

    const savedTab =
      localStorage.getItem(
        TAB_STORAGE_KEY
      );


    if (
      savedTab &&
      [...tabs].some(
        tab =>
          tab.dataset.tab ===
          savedTab
      )
    ) {

      initialTab =
        savedTab;

    }

  } catch (error) {

    console.warn(
      "[Boztik Deliver] Could not read saved dashboard tab:",
      error
    );

  }


  activateTab(
    initialTab
  );

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


  /* -------------------------------------------------------
     SEARCH
  ------------------------------------------------------- */

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


  /* -------------------------------------------------------
     STATUS
  ------------------------------------------------------- */

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


  /* -------------------------------------------------------
     SORT
  ------------------------------------------------------- */

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
        ).getTime() -
        new Date(
          a.created_at || 0
        ).getTime()
    );

  }


  return items;

}


/* =========================================================
   DELIVERY CARD
========================================================= */

function renderDelivery(delivery) {

  const status =
    getDeliveryStatus(delivery);

  const expired =
    status.key === "expired";

  const remainingLabel =
    !expired && delivery.expires_at
      ? countdown(delivery.expires_at).label
      : null;


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
      delivery.lifetime_views ??
      delivery.view_count ??
      0
    );


  const lifetimeDownloads =
    Number(
      delivery.lifetime_downloads ??
      delivery.download_count ??
      0
    );


  const fileCount =
    Array.isArray(
      delivery.delivery_files
    )
      ? (delivery.delivery_files.length || 1)
      : 1;


  const card =
    document.createElement(
      "article"
    );


  card.className =
    `delivery-card${expired ? " is-expired" : ""}`;


  card.innerHTML = `

    <div class="delivery-card-header">

      <div class="delivery-card-heading">

        <h3 class="delivery-card-title">
          ${escapeHtml(
            delivery.project_name ||
            "Untitled delivery"
          )}
        </h3>

        <p class="delivery-card-client">
          ${escapeHtml(
            delivery.client_name ||
            "Client"
          )}
        </p>

        ${
          delivery.source
            ? `<p class="delivery-card-source">
                ${
                  delivery.source === "reddit"
                    ? `Reddit${delivery.source_meta?.subreddit ? ` &middot; r/${escapeHtml(delivery.source_meta.subreddit)}` : ""}`
                    : escapeHtml(SOURCE_LABELS[delivery.source] || "Other")
                }
              </p>`
            : ""
        }

      </div>

      <span class="delivery-status${status.key !== "active" ? ` ${status.key}` : ""}">
        <span class="status-dot" aria-hidden="true"></span>
        ${status.label}
      </span>

    </div>


    <div class="delivery-card-meta">

      <div class="delivery-card-meta-item">
        <span class="delivery-card-meta-label">Created</span>
        <span class="delivery-card-meta-value" title="${formatDate(delivery.created_at)}">
          ${formatDate(delivery.created_at)}
        </span>
      </div>

      <div class="delivery-card-meta-item">
        <span class="delivery-card-meta-label">${expired ? "Expired" : "Expires"}</span>
        <span class="delivery-card-meta-value" title="${formatDate(delivery.expires_at)}">
          ${expired ? formatDate(delivery.expires_at) : (remainingLabel || formatDate(delivery.expires_at))}
        </span>
      </div>

      <div class="delivery-card-meta-item">
        <span class="delivery-card-meta-label">Files</span>
        <span class="delivery-card-meta-value">
          ${fileCount} &middot; ${formatBytes(delivery.file_size || 0)}
        </span>
      </div>

    </div>


    <div class="delivery-card-analytics">

      <div class="delivery-analytics-item">
        <span class="delivery-analytics-label">Views (Month)</span>
        <span class="delivery-analytics-value">${monthlyViews}</span>
      </div>

      <div class="delivery-analytics-item">
        <span class="delivery-analytics-label">Downloads (Month)</span>
        <span class="delivery-analytics-value">${monthlyDownloads}</span>
      </div>

      <div class="delivery-analytics-item">
        <span class="delivery-analytics-label">Views (Lifetime)</span>
        <span class="delivery-analytics-value">${lifetimeViews}</span>
      </div>

      <div class="delivery-analytics-item">
        <span class="delivery-analytics-label">Downloads (Lifetime)</span>
        <span class="delivery-analytics-value">${lifetimeDownloads}</span>
      </div>

    </div>


    <div class="delivery-card-actions">

      <button
        type="button"
        class="dash-btn small btn-edit-delivery"
      >
        Edit
      </button>

      <button
        type="button"
        class="dash-btn small btn-open-delivery"
        ${expired ? "disabled" : ""}
      >
        Open
      </button>


      <button
        type="button"
        class="dash-btn small btn-copy-link"
        ${expired ? "disabled" : ""}
      >
        Copy Link
      </button>


      <details class="delivery-extend">

        <summary class="dash-btn small" ${expired ? "aria-disabled=\"true\"" : ""}>
          Extend
        </summary>

        <div class="delivery-extend-menu">

          <button type="button" class="delivery-extend-option" data-hours="24">+24 hours</button>
          <button type="button" class="delivery-extend-option" data-hours="48">+48 hours</button>
          <button type="button" class="delivery-extend-option" data-hours="168">+7 days</button>
          <button type="button" class="delivery-extend-option" data-custom="1">Custom…</button>

        </div>

      </details>


      <button
        type="button"
        class="dash-btn small btn-disable-now"
        ${expired ? "disabled" : ""}
      >
        Disable Now
      </button>


      <button
        type="button"
        class="dash-btn small btn-duplicate"
      >
        Duplicate
      </button>


      <button
        type="button"
        class="dash-btn small danger btn-delete"
      >
        Delete
      </button>

    </div>

  `;


  /* -------------------------------------------------------
     EDIT DELIVERY
  ------------------------------------------------------- */

  const editButton =
    card.querySelector(
      ".btn-edit-delivery"
    );


  if (editButton) {

    editButton.addEventListener(
      "click",
      () => {

        openEditDialog(
          delivery
        );

      }
    );

  }


  /* -------------------------------------------------------
     OPEN DELIVERY
  ------------------------------------------------------- */

  const openButton =
    card.querySelector(
      ".btn-open-delivery"
    );


  if (openButton && !expired) {

    openButton.addEventListener(
      "click",
      () => {

        const url =
          buildDeliveryUrl(
            delivery.id
          );


        if (!url) {
          return;
        }


        window.open(
          url,
          "_blank",
          "noopener,noreferrer"
        );

      }
    );

  }


  /* -------------------------------------------------------
     COPY LINK
  ------------------------------------------------------- */

  const copyButton =
    card.querySelector(
      ".btn-copy-link"
    );


  if (copyButton && !expired) {

    copyButton.addEventListener(
      "click",
      async event => {

        const url =
          buildDeliveryUrl(
            delivery.id
          );


        if (!url) {
          return;
        }


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


          /*
            Fallback for browsers where clipboard
            permissions are unavailable.
          */

          const temporaryInput =
            document.createElement(
              "input"
            );


          temporaryInput.value =
            url;


          temporaryInput.style.position =
            "fixed";

          temporaryInput.style.opacity =
            "0";


          document.body.append(
            temporaryInput
          );


          temporaryInput.select();


          let copied = false;


          try {

            copied =
              document.execCommand(
                "copy"
              );

          } catch {
            copied = false;
          }


          temporaryInput.remove();


          toast(
            copied
              ? "Delivery link copied."
              : "Could not copy the link.",
            copied
              ? "success"
              : "error"
          );

        }

      }
    );

  }


  /* -------------------------------------------------------
     EXTEND EXPIRY
  ------------------------------------------------------- */

  const extendDetails =
    card.querySelector(
      ".delivery-extend"
    );


  const applyExtend = async expiresAtIso => {

    try {

      const updated =
        await updateDelivery(
          delivery.id,
          { expires_at: expiresAtIso }
        );


      const index =
        deliveries.findIndex(
          d => d.id === delivery.id
        );


      if (index !== -1) {

        deliveries[index] = {
          ...deliveries[index],
          ...updated
        };

      }


      renderSummary();
      renderDeliveries();


      toast(
        "Delivery expiry updated."
      );


    } catch (error) {

      console.error(
        "[Boztik Deliver] Extend failed:",
        error
      );


      toast(
        error?.message ||
        "Could not update expiry.",
        "error"
      );

    }

  };


  if (extendDetails && !expired) {

    extendDetails.querySelectorAll(
      ".delivery-extend-option"
    ).forEach(option => {

      option.addEventListener(
        "click",
        () => {

          extendDetails.open = false;


          if (option.dataset.custom) {
            openEditDialog(delivery);
            return;
          }


          const hours =
            Number(option.dataset.hours) || 0;

          if (hours <= 0) {
            return;
          }


          const currentExpiry =
            delivery.expires_at
              ? new Date(delivery.expires_at).getTime()
              : Date.now();


          const base =
            Math.max(Date.now(), currentExpiry);


          const newExpiry =
            new Date(
              base + hours * 60 * 60 * 1000
            ).toISOString();


          applyExtend(newExpiry);

        }
      );

    });

  }


  /* -------------------------------------------------------
     DISABLE NOW
  ------------------------------------------------------- */

  const disableButton =
    card.querySelector(
      ".btn-disable-now"
    );


  if (disableButton && !expired) {

    disableButton.addEventListener(
      "click",
      () => {

        const projectName =
          delivery.project_name ||
          "this delivery";


        openConfirm(
          `Disable "${projectName}" now? Clients will immediately lose access — this can't be undone.`,
          () => applyExtend(new Date().toISOString())
        );

      }
    );

  }


  /* -------------------------------------------------------
     DUPLICATE
  ------------------------------------------------------- */

  const duplicateButton =
    card.querySelector(
      ".btn-duplicate"
    );


  if (duplicateButton) {

    duplicateButton.addEventListener(
      "click",
      async event => {

        const button =
          event.currentTarget;


        button.disabled =
          true;


        button.textContent =
          "Duplicating…";


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
            error?.message ||
            "Could not duplicate delivery.",
            "error"
          );


        } finally {

          button.disabled =
            false;


          button.textContent =
            "Duplicate";

        }

      }
    );

  }


  /* -------------------------------------------------------
     DELETE
  ------------------------------------------------------- */

  const deleteButton =
    card.querySelector(
      ".btn-delete"
    );


  if (deleteButton) {

    deleteButton.addEventListener(
      "click",
      () => {

        const projectName =
          delivery.project_name ||
          "this delivery";


        openConfirm(
          `Delete "${projectName}"? This cannot be undone.`,
          async () => {

            try {

              await deleteDelivery(
                delivery
              );


              toast(
                "Delivery deleted."
              );


              await load();


            } catch (error) {

              console.error(
                "[Boztik Deliver] Delete failed:",
                error
              );


              toast(
                error?.message ||
                "Could not delete delivery.",
                "error"
              );

            }

          }
        );

      }
    );

  }


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
      "dash-empty";


    const heading =
      deliveries.length
        ? "No deliveries match your search."
        : "No deliveries created yet.";

    const detail =
      deliveries.length
        ? "Try adjusting your search or filters."
        : "Create your first delivery using the form above.";


    empty.innerHTML = `
      <h3>${escapeHtml(heading)}</h3>
      <p>${escapeHtml(detail)}</p>
    `;


    els.deliveriesList.append(
      empty
    );


    return;

  }


  const fragment =
    document.createDocumentFragment();


  visible.forEach(
    delivery => {

      fragment.append(
        renderDelivery(
          delivery
        )
      );

    }
  );


  els.deliveriesList.append(
    fragment
  );

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


    const result =
      await listDeliveries();


    /*
      Protect the dashboard if the API unexpectedly
      returns null instead of an array.
    */

    deliveries =
      Array.isArray(result)
        ? result
        : [];


    renderSummary();

    renderDeliveries();


  } catch (error) {

    console.error(
      "[Boztik Deliver] Failed to load deliveries:",
      error
    );


    const message =
      String(
        error?.message || ""
      ).toLowerCase();


    if (
      message.includes("jwt") ||
      message.includes("token") ||
      message.includes("unauthorized") ||
      message.includes("401")
    ) {

      toast(
        "Your session has expired. Please sign in again.",
        "error"
      );


      showLogin();

      return;

    }


    toast(
      error?.message ||
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

  const incoming =
    Array.isArray(files)
      ? files
      : [...files];


  if (!incoming.length) {
    return;
  }


  if (incoming.length > MAX_FILES) {

    toast(
      `You can upload a maximum of ${MAX_FILES} files.`,
      "error"
    );

    return;

  }


  const invalid =
    incoming.find(
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
    incoming;


  renderFileList();

}


/* =========================================================
   FILE LIST / PREVIEWS
========================================================= */

function renderFileList() {

  if (!els.fileList) {
    return;
  }


  els.fileList.innerHTML =
    "";


  if (!selectedFiles.length) {
    return;
  }


  const fragment =
    document.createDocumentFragment();


  selectedFiles.forEach(
    file => {

      const item =
        document.createElement(
          "li"
        );


      item.className =
        "dash-file-item";


      const isImage =
        String(
          file.type || ""
        ).startsWith(
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
            loading="lazy"
          >
        `;


        /*
          The URL is kept alive long enough for the
          browser to display the thumbnail.
        */

        setTimeout(
          () => {

            try {

              URL.revokeObjectURL(
                url
              );

            } catch {
              /* Ignore cleanup errors. */
            }

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


      fragment.append(
        item
      );

    }
  );


  els.fileList.append(
    fragment
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
    event => {

      /*
        Avoid reopening the picker if the actual input
        somehow receives the click.
      */

      if (
        event.target ===
        els.fileInput
      ) {
        return;
      }


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

      event.dataTransfer.dropEffect =
        "copy";


      els.dropzone.classList.add(
        "is-dragging"
      );

    }
  );


  els.dropzone.addEventListener(
    "dragleave",
    event => {

      /*
        Only remove the state when the pointer
        actually leaves the dropzone.
      */

      if (
        !els.dropzone.contains(
          event.relatedTarget
        )
      ) {

        els.dropzone.classList.remove(
          "is-dragging"
        );

      }

    }
  );


  els.dropzone.addEventListener(
    "drop",
    event => {

      event.preventDefault();


      els.dropzone.classList.remove(
        "is-dragging"
      );


      const files =
        [...(
          event.dataTransfer?.files ||
          []
        )];


      validateSelectedFiles(
        files
      );

    }
  );


  els.fileInput.addEventListener(
    "change",
    () => {

      validateSelectedFiles(
        [...els.fileInput.files]
      );


      /*
        Allows selecting the same file again
        after removing/replacing it.
      */

      els.fileInput.value =
        "";

    }
  );

}


/* =========================================================
   UPLOAD
========================================================= */

/* =========================================================
   DELIVERY SOURCE PICKER + REDDIT AUTO-FILL
   -----------------------------------------------------
   "Reduce data-entry friction, not information." Selecting
   a source toggles the Reddit URL field on/off. Reddit
   fetch is best-effort and NEVER blocks delivery creation —
   any failure just leaves the fields for manual entry.
========================================================= */

function setRedditStatus(message, tone = "muted") {

  if (!els.redditStatus) {
    return;
  }

  if (!message) {
    els.redditStatus.hidden = true;
    els.redditStatus.textContent = "";
    els.redditStatus.className = "dash-reddit-status";
    return;
  }

  els.redditStatus.hidden = false;
  els.redditStatus.textContent = message;
  els.redditStatus.className = `dash-reddit-status ${tone}`;

}


function setSelectedSource(source) {

  selectedSource = source;

  if (els.sourcePicker) {

    els.sourcePicker
      .querySelectorAll(".dash-source-btn")
      .forEach(btn => {

        btn.classList.toggle(
          "is-active",
          btn.dataset.source === source
        );

      });

  }

  if (els.redditField) {
    els.redditField.hidden = source !== "reddit";
  }

  if (source !== "reddit") {
    redditMeta = null;
    setRedditStatus("");
  }

}


function resetSourcePicker() {

  setSelectedSource("reddit");
  redditMeta = null;
  setRedditStatus("");

  if (els.redditUrl) {
    els.redditUrl.value = "";
  }

}


function initSourcePicker() {

  if (!els.sourcePicker) {
    return;
  }

  els.sourcePicker.addEventListener("click", event => {

    const btn = event.target.closest(".dash-source-btn");

    if (!btn) {
      return;
    }

    setSelectedSource(btn.dataset.source || "other");

  });

  setSelectedSource(selectedSource);

}


async function runRedditAutofill() {

  const url = els.redditUrl?.value.trim() || "";

  if (!url) {
    setRedditStatus("");
    return;
  }

  const token = ++redditFetchToken;

  setRedditStatus("Fetching thread title…", "loading");

  try {

    const meta = await fetchRedditMetadata(url);

    /*
     * A newer request may have started while this one was
     * in flight (fast paste + edit) — ignore stale results.
     */
    if (token !== redditFetchToken) {
      return;
    }

    redditMeta = meta;

    if (els.projectName && !els.projectName.value.trim()) {
      els.projectName.value = meta.title;
    }

    if (els.clientName && !els.clientName.value.trim()) {
      els.clientName.value =
        meta.subreddit
          ? `r/${meta.subreddit}`
          : "Reddit Client";
    }

    setRedditStatus(
      `Auto-filled from r/${meta.subreddit || "reddit"} — title is editable.`,
      "success"
    );

  } catch (error) {

    if (token !== redditFetchToken) {
      return;
    }

    redditMeta = null;

    setRedditStatus(
      `${error?.message || "Couldn't auto-fill from Reddit."} Enter the title manually.`,
      "error"
    );

  }

}


function initRedditAutofill() {

  if (!els.redditUrl) {
    return;
  }

  els.redditUrl.addEventListener("blur", runRedditAutofill);

  els.redditUrl.addEventListener("keydown", event => {

    if (event.key === "Enter") {
      event.preventDefault();
      runRedditAutofill();
    }

  });

}


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
    els.clientName?.value.trim() ||
    "";


  const projectName =
    els.projectName?.value.trim() ||
    "";


  const notes =
    els.notes?.value.trim() ||
    "";


  const expiryHours =
    Number(
      els.expiry?.value ||
      config.defaultExpiryHours
    );


  if (
    !clientName ||
    !projectName
  ) {

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


  const source = selectedSource;

  const sourceMeta =
    source === "reddit" && redditMeta
      ? {
          redditUrl: redditMeta.redditUrl,
          subreddit: redditMeta.subreddit
        }
      : null;


  const metadata = {

    id,

    client_name:
      clientName,

    project_name:
      projectName,

    notes,

    expires_at:
      expiresAt,

    source,

    source_meta:
      sourceMeta

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

        const safeProgress =
          Math.max(
            0,
            Math.min(
              1,
              Number(progress) || 0
            )
          );


        if (els.progressBar) {

          els.progressBar.style.width =
            `${Math.round(
              safeProgress * 100
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

      els.successCopyStatus.textContent =
        "";

    }


    if (
      els.successDialog &&
      typeof els.successDialog.showModal ===
        "function"
    ) {

      els.successDialog.showModal();

    }


    toast(
      "Delivery created successfully."
    );


    if (els.uploadForm) {
      els.uploadForm.reset();
    }


    selectedFiles = [];


    renderFileList();
    resetSourcePicker();


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
   EDIT DELIVERY DIALOG
========================================================= */

/*
 * Converts an ISO timestamp into the local "YYYY-MM-DDTHH:mm"
 * string a <input type="datetime-local"> expects. Uses local
 * getters (not UTC) so it round-trips through the same Date +
 * toISOString() pattern already used by the create-delivery form —
 * no second timezone system is introduced.
 */
function toDatetimeLocalValue(isoString) {

  const date =
    new Date(isoString);


  if (Number.isNaN(date.getTime())) {
    return "";
  }


  const pad =
    value => String(value).padStart(2, "0");


  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );

}


function setEditError(message = "") {

  if (!els.editError) {
    return;
  }

  els.editError.textContent = message;
  els.editError.hidden = !message;

}


function setEditSaving(saving) {

  editSaving = saving;

  if (els.editSave) {

    els.editSave.disabled = saving;

    els.editSave.textContent =
      saving ? "Saving…" : "Save Changes";

  }

  if (els.editCancel) {
    els.editCancel.disabled = saving;
  }

}


function closeEditDialog() {

  if (els.editDialog?.open) {
    els.editDialog.close();
  }

  editingDelivery = null;

}


function openEditDialog(delivery) {

  if (!els.editDialog || !delivery) {
    return;
  }

  editingDelivery = delivery;

  setEditError("");
  setEditSaving(false);

  if (els.editProjectName) {
    els.editProjectName.value = delivery.project_name || "";
  }

  if (els.editClientName) {
    els.editClientName.value = delivery.client_name || "";
  }

  if (els.editNotes) {
    els.editNotes.value = delivery.notes || "";
  }

  const source = delivery.source || "private";

  if (els.editSource) {
    els.editSource.value = source;
  }

  if (els.editRedditUrl) {
    els.editRedditUrl.value = delivery.source_meta?.redditUrl || "";
  }

  if (els.editRedditField) {
    els.editRedditField.hidden = source !== "reddit";
  }

  if (els.editExpiry) {
    els.editExpiry.value = toDatetimeLocalValue(delivery.expires_at);
  }

  if (typeof els.editDialog.showModal === "function") {
    els.editDialog.showModal();
  }

}


async function handleEditSubmit(event) {

  event.preventDefault();


  /* Guard against duplicate submissions (double-click, Enter + click). */
  if (editSaving || !editingDelivery) {
    return;
  }


  const projectName =
    els.editProjectName?.value.trim() || "";

  const clientName =
    els.editClientName?.value.trim() || "";

  const notes =
    els.editNotes?.value.trim() || "";

  const source =
    els.editSource?.value || "private";

  const redditUrl =
    els.editRedditUrl?.value.trim() || "";

  const sourceMeta =
    source === "reddit" && redditUrl
      ? {
          redditUrl,
          subreddit:
            editingDelivery.source_meta?.subreddit ||
            redditUrl.match(/\/r\/([A-Za-z0-9_]+)/i)?.[1] ||
            null
        }
      : null;

  const expiryRaw =
    els.editExpiry?.value || "";


  setEditError("");


  if (!projectName) {
    setEditError("Please enter a delivery name.");
    return;
  }

  if (!clientName) {
    setEditError("Please enter a client name.");
    return;
  }

  if (!expiryRaw) {
    setEditError("Please choose an expiry date and time.");
    return;
  }


  const expiryDate =
    new Date(expiryRaw);


  if (Number.isNaN(expiryDate.getTime())) {
    setEditError("That expiry date/time isn't valid.");
    return;
  }


  const expiresAtIso =
    expiryDate.toISOString();

  const isPastExpiry =
    expiryDate.getTime() <= Date.now();

  const targetId =
    editingDelivery.id;


  const applyUpdate = async () => {

    setEditSaving(true);

    try {

      const updated =
        await updateDelivery(
          targetId,
          {
            project_name: projectName,
            client_name: clientName,
            notes: notes || null,
            source,
            source_meta: sourceMeta,
            expires_at: expiresAtIso
          }
        );


      const index =
        deliveries.findIndex(
          d => d.id === targetId
        );


      if (index !== -1) {

        deliveries[index] = {
          ...deliveries[index],
          ...updated
        };

      }


      renderSummary();
      renderDeliveries();


      toast(
        "Delivery updated successfully."
      );


      closeEditDialog();


    } catch (error) {

      console.error(
        "[Boztik Deliver] Update failed:",
        error
      );


      const message =
        String(error?.message || "").toLowerCase();


      if (
        message.includes("jwt") ||
        message.includes("token") ||
        message.includes("unauthorized") ||
        message.includes("401")
      ) {

        toast(
          "Your session has expired. Please sign in again.",
          "error"
        );


        closeEditDialog();
        showLogin();

        return;

      }


      setEditError(
        error?.message ||
        "Could not save changes. Please try again."
      );


      setEditSaving(false);

    }

  };


  if (isPastExpiry) {

    /*
      Confirm before letting an edit silently expire the delivery —
      the dash-edit dialog stays open underneath so the person lands
      back on the form (with the error, if any) if this is cancelled.
    */

    openConfirm(
      "This expiry date/time is in the past, so the delivery will " +
      "expire immediately once saved. Continue?",
      applyUpdate
    );

    return;

  }


  await applyUpdate();

}


function setupEditDialog() {

  if (els.editForm) {

    els.editForm.addEventListener(
      "submit",
      handleEditSubmit
    );

  }


  if (els.editSource && els.editRedditField) {

    els.editSource.addEventListener(
      "change",
      () => {

        els.editRedditField.hidden =
          els.editSource.value !== "reddit";

      }
    );

  }


  if (els.editCancel) {

    els.editCancel.addEventListener(
      "click",
      () => {

        if (!editSaving) {
          closeEditDialog();
        }

      }
    );

  }


  /* Prevent Esc from closing the dialog mid-save. */
  els.editDialog?.addEventListener(
    "cancel",
    event => {

      if (editSaving) {
        event.preventDefault();
      }

    }
  );

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
    !els.confirmAction ||
    typeof els.confirmDialog.showModal !==
      "function"
  ) {

    const confirmed =
      window.confirm(
        message
      );


    if (confirmed) {

      Promise.resolve(
        action()
      ).catch(
        error => {

          console.error(
            "[Boztik Deliver] Confirmation action failed:",
            error
          );

        }
      );

    }


    return;

  }


  if (els.confirmText) {

    els.confirmText.textContent =
      message;

  }


  pendingConfirmAction =
    action;


  els.confirmDialog.showModal();

}


/* =========================================================
   CONFIRM ACTION
========================================================= */

function setupConfirmation() {

  if (!els.confirmAction) {
    return;
  }


  els.confirmAction.addEventListener(
    "click",
    async () => {

      const action =
        pendingConfirmAction;


      pendingConfirmAction =
        null;


      if (
        els.confirmDialog &&
        els.confirmDialog.open
      ) {

        els.confirmDialog.close();

      }


      if (!action) {
        return;
      }


      try {

        await action();

      } catch (error) {

        console.error(
          "[Boztik Deliver] Confirmation action failed:",
          error
        );

      }

    }
  );

}


/* =========================================================
   SUCCESS DIALOG
========================================================= */

function setupSuccessDialog() {

  if (!els.successDialog) {
    return;
  }


  /*
    Clicking outside the dialog should not accidentally
    close it unless the browser handles that natively.
  */

  els.successDialog.addEventListener(
    "close",
    () => {

      if (els.successCopyStatus) {

        els.successCopyStatus.hidden =
          true;

      }

    }
  );

  /* Opening the client page is a completed hand-off. Close the success
     dialog immediately so it cannot remain layered over the dashboard. */
  els.successOpen?.addEventListener("click", () => {
    if (els.successDialog.open) els.successDialog.close();
  });

}


/* =========================================================
   COPY SUCCESS LINK
========================================================= */

async function copyText(value) {

  if (!value) {
    return false;
  }


  /*
    Modern Clipboard API
  */

  if (
    navigator.clipboard &&
    window.isSecureContext
  ) {

    try {

      await navigator.clipboard.writeText(
        value
      );

      return true;

    } catch (error) {

      console.warn(
        "[Boztik Deliver] Clipboard API failed:",
        error
      );

    }

  }


  /*
    Legacy browser fallback
  */

  const input =
    document.createElement(
      "input"
    );


  input.value =
    value;


  input.setAttribute(
    "readonly",
    ""
  );


  input.style.position =
    "fixed";


  input.style.left =
    "-9999px";


  document.body.append(
    input
  );


  input.select();


  let copied = false;


  try {

    copied =
      document.execCommand(
        "copy"
      );

  } catch (error) {

    console.warn(
      "[Boztik Deliver] Legacy clipboard failed:",
      error
    );

  }


  input.remove();


  return copied;

}


function setupSuccessCopy() {

  if (!els.successCopy) {
    return;
  }


  els.successCopy.addEventListener(
    "click",
    async () => {

      const value =
        els.successLink?.value ||
        "";


      if (!value) {
        return;
      }


      const copied =
        await copyText(
          value
        );


      if (copied) {

        if (els.successCopyStatus) {

          els.successCopyStatus.textContent =
            "Link copied to clipboard.";

          els.successCopyStatus.hidden =
            false;

        }


        toast(
          "Client download link copied."
        );

        /* Keep feedback visible briefly, then return the creator to the
           command centre without leaving a stale modal on screen. */
        window.setTimeout(() => {
          if (els.successDialog?.open) els.successDialog.close();
        }, 550);


      } else {

        if (els.successLink) {

          els.successLink.focus();

          els.successLink.select();

        }


        if (els.successCopyStatus) {

          els.successCopyStatus.textContent =
            "Link selected. Press Ctrl+C to copy.";

          els.successCopyStatus.hidden =
            false;

        }


        toast(
          "Link selected. Press Ctrl+C to copy.",
          "error"
        );

      }

    }
  );

}


/* =========================================================
   EVENT LISTENERS
========================================================= */

function setupEventListeners() {

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


  initSourcePicker();
  initRedditAutofill();


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

}


/* =========================================================
   STARTUP
========================================================= */

function initialiseDashboard() {

  console.log(
    "[Boztik Deliver] Dashboard initialising..."
  );


  setupDropzone();

  setupDashboardTabs();

  setupConfirmation();

  setupSuccessDialog();

  setupSuccessCopy();

  setupEditDialog();

  setupEventListeners();


  initialiseAuthentication();

}


/* =========================================================
   START
========================================================= */

initialiseDashboard();