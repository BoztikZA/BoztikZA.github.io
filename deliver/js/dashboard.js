import {
  formatBytes,
  formatDate,
  toast,
  escapeHtml
} from "./shared.js";

import {
  listDeliveries,
  deleteDelivery,
  duplicateDelivery
} from "./api.js";

const $ = id => document.getElementById(id);

const els = {
  list: $("delivery-list"),
  empty: $("delivery-empty"),

  total: $("delivery-total"),
  active: $("delivery-active"),
  expired: $("delivery-expired"),

  monthlyViews: $("delivery-monthly-views"),
  monthlyDownloads: $("delivery-monthly-downloads"),

  lifetimeViews: $("delivery-lifetime-views"),
  lifetimeDownloads: $("delivery-lifetime-downloads"),

  refresh: $("delivery-refresh")
};

let deliveries = [];


/* =========================================================
   HELPERS
========================================================= */

function isExpired(delivery) {
  if (!delivery?.expires_at) {
    return false;
  }

  return new Date(delivery.expires_at).getTime() <= Date.now();
}


function getCurrentMonthTotals(items) {

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


function formatLastActivity(value) {

  if (!value) {
    return "Never";
  }

  return formatDate(value);
}


/* =========================================================
   DASHBOARD SUMMARY
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

  const monthly =
    getCurrentMonthTotals(
      deliveries
    );

  const lifetime =
    getLifetimeTotals(
      deliveries
    );


  if (els.total) {
    els.total.textContent =
      total;
  }

  if (els.active) {
    els.active.textContent =
      active;
  }

  if (els.expired) {
    els.expired.textContent =
      expired;
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
   DELIVERY CARD
========================================================= */

function renderDelivery(delivery) {

  const expired =
    isExpired(delivery);

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


  const card =
    document.createElement("article");

  card.className =
    "delivery-card";


  card.innerHTML = `

    <div class="delivery-card-main">

      <div class="delivery-card-heading">

        <div>

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

        <span class="
          delivery-status
          ${expired ? "expired" : "active"}
        ">
          ${expired ? "Expired" : "Active"}
        </span>

      </div>


      <div class="delivery-meta">

        <span>
          ID:
          <strong>
            ${escapeHtml(
              delivery.id
            )}
          </strong>
        </span>

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

      </div>


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


      <div class="delivery-last-activity">

        <span>
          Last opened:
          <strong>
            ${formatLastActivity(
              delivery.last_viewed_at
            )}
          </strong>
        </span>

        <span>
          Last downloaded:
          <strong>
            ${formatLastActivity(
              delivery.last_downloaded_at
            )}
          </strong>
        </span>

      </div>


      <div class="delivery-files">

        <strong>
          Files:
        </strong>

        <span>
          ${
            delivery.delivery_files?.length ||
            1
          }
        </span>

        <span>
          ${formatBytes(
            delivery.file_size || 0
          )}
        </span>

      </div>


      <div class="delivery-actions">

        <button
          type="button"
          class="btn-open-delivery"
          data-id="${escapeHtml(
            delivery.id
          )}"
        >
          Open Delivery
        </button>

        <button
          type="button"
          class="btn-copy-link"
          data-id="${escapeHtml(
            delivery.id
          )}"
        >
          Copy Link
        </button>

        <button
          type="button"
          class="btn-duplicate"
          data-id="${escapeHtml(
            delivery.id
          )}"
        >
          Duplicate
        </button>

        <button
          type="button"
          class="btn-delete danger"
          data-id="${escapeHtml(
            delivery.id
          )}"
        >
          Delete
        </button>

      </div>

    </div>

  `;


  /* =======================================================
     OPEN DELIVERY
  ======================================================= */

  card
    .querySelector(
      ".btn-open-delivery"
    )
    .addEventListener(
      "click",
      () => {

        const url =
          buildDeliveryUrl(
            delivery.id
          );

        window.open(
          url,
          "_blank",
          "noopener,noreferrer"
        );

      }
    );


  /* =======================================================
     COPY LINK
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
            "Clipboard error:",
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
            "Duplicate failed:",
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
      async event => {

        const confirmed =
          window.confirm(
            `Delete "${delivery.project_name || "this delivery"}"?\n\nThis cannot be undone.`
          );

        if (!confirmed) {
          return;
        }

        const button =
          event.currentTarget;

        button.disabled =
          true;

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
            "Delete failed:",
            error
          );

          toast(
            "Could not delete delivery.",
            "error"
          );

          button.disabled =
            false;

        }

      }
    );


  return card;
}


/* =========================================================
   DELIVERY URL
========================================================= */

function buildDeliveryUrl(id) {

  const base =
    new URL(
      "index.html",
      window.location.href
    );

  base.searchParams.set(
    "id",
    id
  );

  return base.href;
}


/* =========================================================
   RENDER LIST
========================================================= */

function renderList() {

  if (!els.list) {
    return;
  }

  els.list.innerHTML = "";


  if (!deliveries.length) {

    if (els.empty) {
      els.empty.hidden =
        false;
    }

    return;
  }


  if (els.empty) {
    els.empty.hidden =
      true;
  }


  deliveries.forEach(
    delivery => {

      els.list.appendChild(
        renderDelivery(
          delivery
        )
      );

    }
  );

}


/* =========================================================
   LOAD
========================================================= */

async function load() {

  try {

    if (els.refresh) {

      els.refresh.disabled =
        true;

      els.refresh.textContent =
        "Refreshing…";

    }


    deliveries =
      await listDeliveries();


    renderSummary();

    renderList();

  } catch (error) {

    console.error(
      "Failed to load deliveries:",
      error
    );

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
   REFRESH BUTTON
========================================================= */

if (els.refresh) {

  els.refresh.addEventListener(
    "click",
    load
  );

}


/* =========================================================
   INITIAL LOAD
========================================================= */

load();