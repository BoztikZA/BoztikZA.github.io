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

      host.innerHTML = profiles.map(profile => `
        <a class="hm-spotlight-card"
           href="spotlight/profile.html?slug=${encodeURIComponent(profile.slug)}"
           data-profile-id="${escapeHtml(profile.id)}"
           data-featured="${profile.featured ? "1" : "0"}">
          <small>${profile.featured ? "Featured today" : escapeHtml(profile.category.replace(/-/g, " "))}</small>
          <strong>${escapeHtml(profile.display_name)}</strong>
          <p>${escapeHtml(profile.tagline)}</p>
          <b>Discover their work ↗</b>
        </a>`).join("");

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
