import { prepareSpotlightImage } from "../image-processing.js";

const API = "https://deliver-api.boztik.com/api/public/spotlight/submit";
const form = document.querySelector("#sp-submit-form");
const status = document.querySelector("#sp-submit-status");
const button = form.querySelector('button[type="submit"]');
const mainImage = document.querySelector("#sp-submit-main-image");
const galleryImages = document.querySelector("#sp-submit-showcase-images");
const previews = document.querySelector("#sp-submit-image-preview");
let previewUrls = [];

function normaliseWebsite(value) {
  const text = value.trim();
  if (!text) return "";
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : "https://" + text.replace(/^\/+/, "");
}

function showPreviews() {
  previewUrls.forEach(url => URL.revokeObjectURL(url));
  previewUrls = [];
  previews.replaceChildren();
  const files = [mainImage.files[0], ...Array.from(galleryImages.files || [])].filter(Boolean);
  files.forEach((file, index) => {
    const url = URL.createObjectURL(file);
    previewUrls.push(url);
    const item = document.createElement("figure");
    const image = document.createElement("img");
    image.src = url;
    image.alt = index === 0 ? "Preview of main profile image" : "Preview of showcase image " + index;
    const caption = document.createElement("figcaption");
    caption.textContent = index === 0 ? "Main image" : "Showcase " + index;
    item.append(image, caption);
    previews.append(item);
  });
}

mainImage.addEventListener("change", showPreviews);
galleryImages.addEventListener("change", () => {
  if (galleryImages.files.length > 2) {
    galleryImages.value = "";
    status.dataset.kind = "error";
    status.textContent = "Choose no more than two additional images.";
  }
  showPreviews();
});

form.querySelectorAll('input[type="url"]').forEach(input => {
  input.addEventListener("blur", () => { input.value = normaliseWebsite(input.value); });
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  status.textContent = "";
  status.dataset.kind = "";
  form.querySelectorAll('input[type="url"]').forEach(input => { input.value = normaliseWebsite(input.value); });
  if (!form.checkValidity()) {
    const invalid = form.querySelector(":invalid");
    invalid?.focus();
    form.reportValidity();
    return;
  }
  const files = [mainImage.files[0], ...Array.from(galleryImages.files || [])].filter(Boolean);
  if (galleryImages.files.length > 2) {
    status.dataset.kind = "error";
    status.textContent = "Choose no more than two additional images.";
    galleryImages.focus();
    return;
  }
  if (files.length > 3) {
    status.dataset.kind = "error";
    status.textContent = "Choose up to three images in total.";
    return;
  }
  if (files.some(file => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 20 * 1024 * 1024)) {
    status.dataset.kind = "error";
    status.textContent = "Choose JPG, PNG or WebP images no larger than 20 MB before optimization.";
    return;
  }
  const website = form.elements.website_url;
  if (website.value && !website.checkValidity()) {
    status.dataset.kind = "error";
    status.textContent = "Enter a valid website address.";
    website.focus();
    return;
  }
  const socialLinks = {};
  for (const key of ["youtube", "twitch", "instagram", "tiktok", "facebook", "linkedin", "x", "spotify", "pinterest"]) {
    const input = form.elements[key];
    if (input.value) {
      if (!input.checkValidity()) {
        status.dataset.kind = "error";
        status.textContent = "Check the " + key + " link or leave it blank.";
        input.focus();
        return;
      }
      socialLinks[key] = input.value;
    }
  }
  const payload = new FormData(form);
  payload.set("website_url", website.value);
  payload.set("social_links", JSON.stringify(socialLinks));
  button.disabled = true;
  status.textContent = "Optimizing images and sending your profile securely for review…";
  try {
    const optimized = await Promise.all(files.map(prepareSpotlightImage));
    payload.set("main_image", optimized[0], optimized[0].name);
    payload.delete("showcase_images");
    optimized.slice(1).forEach(file => payload.append("showcase_images", file, file.name));
    const response = await fetch(API, { method: "POST", body: payload });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "We couldn't submit your profile. Please try again.");
    form.reset();
    showPreviews();
    status.dataset.kind = "success";
    status.textContent = data.message || "Thank you. Your profile and images are queued for human review; nothing is published until approved.";
  } catch (error) {
    status.dataset.kind = "error";
    status.textContent = error.message || "We couldn't submit your profile. Please try again.";
  } finally {
    button.disabled = false;
  }
});

window.addEventListener("pagehide", () => previewUrls.forEach(url => URL.revokeObjectURL(url)));
