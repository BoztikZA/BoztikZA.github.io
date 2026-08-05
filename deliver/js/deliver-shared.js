/**
 * Boztik Deliver — shared utilities
 * Used by both the client delivery page and the admin dashboard.
 * Requires: window.BOZTIK_DELIVER_CONFIG (deliver-config.js) and the
 * Supabase JS SDK (loaded via CDN script tag before this file).
 */

(function () {
  "use strict";

  const cfg = window.BOZTIK_DELIVER_CONFIG;

  /** Singleton Supabase client, created lazily and reused everywhere. */
  let _client = null;
  function getSupabaseClient() {
    if (!_client) {
      if (!window.supabase || !window.supabase.createClient) {
        throw new Error(
          "Supabase SDK not loaded. Make sure the CDN <script> tag is included before deliver-shared.js."
        );
      }
      _client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          storageKey: "boztik-deliver-auth"
        }
      });
    }
    return _client;
  }

  /**
   * Generates a random, non-sequential delivery ID in the form
   * "BZ-8FQX92K" using an unambiguous charset (no 0/O/1/I).
   */
  function generateDeliveryId() {
    const charset = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    let suffix = "";
    const bytes = new Uint8Array(8);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    for (let i = 0; i < 8; i++) {
      suffix += charset[bytes[i] % charset.length];
    }
    return `BZ-${suffix}`;
  }

  /** Formats a byte count as a human-readable string (e.g. "142.3 MB"). */
  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return "—";
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const value = bytes / Math.pow(1024, i);
    return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  /** Formats an ISO date string as a friendly local date/time. */
  function formatDate(isoString) {
    if (!isoString) return "—";
    const d = new Date(isoString);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  /**
   * Returns a countdown object { expired, label } describing the time
   * remaining until expiresAt (ISO string).
   */
  function getCountdown(expiresAt) {
    const now = Date.now();
    const target = new Date(expiresAt).getTime();
    const diff = target - now;

    if (diff <= 0) {
      return { expired: true, label: "Expired" };
    }

    const hours = Math.floor(diff / 3_600_000);
    const minutes = Math.floor((diff % 3_600_000) / 60_000);
    const seconds = Math.floor((diff % 60_000) / 1000);

    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      const remHours = hours % 24;
      return { expired: false, label: `${days}d ${remHours}h remaining` };
    }
    if (hours > 0) {
      return { expired: false, label: `${hours}h ${minutes}m remaining` };
    }
    return { expired: false, label: `${minutes}m ${seconds}s remaining` };
  }

  /** Basic HTML-escaping for any user-supplied text rendered into the DOM. */
  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /** Builds the public shareable link for a delivery ID. */
  function buildDeliveryLink(deliveryId) {
    return `${cfg.PUBLIC_BASE_URL}?id=${encodeURIComponent(deliveryId)}`;
  }

  /** Small toast/notification helper shared across Deliver pages. */
  function showToast(message, variant = "success") {
    let container = document.getElementById("deliver-toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "deliver-toast-container";
      container.setAttribute("aria-live", "polite");
      container.className = "deliver-toast-container";
      document.body.appendChild(container);
    }
    const toast = document.createElement("div");
    toast.className = `deliver-toast deliver-toast--${variant}`;
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    setTimeout(() => {
      toast.classList.remove("is-visible");
      setTimeout(() => toast.remove(), 300);
    }, 3800);
  }

  window.BoztikDeliver = {
    getSupabaseClient,
    generateDeliveryId,
    formatBytes,
    formatDate,
    getCountdown,
    escapeHtml,
    buildDeliveryLink,
    showToast,
    config: cfg
  };
})();
