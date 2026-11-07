(() => {
  const host = document.getElementById("hm-spotlight-grid");
  if (!host) return;

  const API = "https://deliver-api.boztik.com/api/public/spotlight";
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));

  function trackFeaturedImpression(card) {
    if (!card || card.dataset.impressionSent) return;
    card.dataset.impressionSent = "1";
    fetch(API + "/impression", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_id: crypto.randomUUID().replace(/-/g, ""),
        profile_id: card.dataset.profileId
      }),
      keepalive: true
    }).catch(() => {});
  }

  fetch(API, { headers: { Accept: "application/json" } })
    .then(response => {
      if (!response.ok) throw new Error("Spotlight is temporarily unavailable.");
      return response.json();
    })
    .then(data => {
      const profiles = (data.profiles || []).slice(0, 3);
      if (!profiles.length) return;

      host.innerHTML = profiles.map(profile => {
        const profileUrl = new URL("spotlight/profile.html?slug=" + encodeURIComponent(profile.slug), location.href).href;
        return `
        <article class="hm-spotlight-card"
           data-profile-id="${escapeHtml(profile.id)}"
           data-featured="${profile.featured ? "1" : "0"}">
          <small>${profile.featured ? "Featured today" : escapeHtml(profile.category.replace(/-/g, " "))}</small>
          <a class="hm-spotlight-card-link" href="spotlight/profile.html?slug=${encodeURIComponent(profile.slug)}">
            <strong>${escapeHtml(profile.display_name)}</strong>
            <p>${escapeHtml(profile.tagline)}</p>
            <b>Discover their work ↗</b>
          </a>
          <button class="hm-spotlight-share" type="button"
            data-share-url="${escapeHtml(profileUrl)}"
            data-share-title="${escapeHtml(profile.display_name)}">Share profile ↗</button>
          <span class="hm-spotlight-share-status" role="status" aria-live="polite"></span>
        </article>`;
      }).join("");

      host.querySelectorAll(".hm-spotlight-share").forEach(button => {
        button.addEventListener("click", async () => {
          const url = button.dataset.shareUrl;
          const title = button.dataset.shareTitle;
          const status = button.parentElement.querySelector(".hm-spotlight-share-status");
          try {
            if (navigator.share) {
              await navigator.share({ title: title + " — Boztik Spotlight", text: "Discover " + title + " on Boztik Spotlight.", url });
              status.textContent = "Thanks for sharing.";
            } else if (navigator.clipboard?.writeText) {
              await navigator.clipboard.writeText(url);
              status.textContent = "Profile link copied.";
            } else {
              status.textContent = "Copy this link: " + url;
            }
          } catch (error) {
            if (error?.name !== "AbortError") status.textContent = "Copy this link: " + url;
          }
        });
      });

      const updateCountdowns=()=>{const now=Math.floor(Date.now()/1000);host.querySelectorAll("[data-countdown]").forEach(el=>{const left=Math.max(0,Number(el.dataset.countdown||0)-now),t=el.querySelector("time");if(t){const h=Math.floor(left/3600),m=Math.floor(left%3600/60),s=left%60;t.textContent=[h,m,s].map(v=>String(v).padStart(2,"0")).join(":");}if(!left){el.remove();const card=el.closest(".hm-spotlight-card");if(card){card.dataset.featured="0";card.querySelector("small").textContent="Spotlight creator";}}});};updateCountdowns();setInterval(updateCountdowns,1000);

      const featuredCard = host.querySelector('[data-featured="1"]');
      if (!featuredCard) return;
      if ("IntersectionObserver" in window) {
        const observer = new IntersectionObserver(entries => {
          if (entries.some(entry => entry.isIntersecting)) {
            trackFeaturedImpression(featuredCard);
            observer.disconnect();
          }
        }, { threshold: 0.4 });
        observer.observe(featuredCard);
      } else {
        trackFeaturedImpression(featuredCard);
      }
    })
    .catch(() => {});
})();
