const MAX_DIMENSION = 2000;
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That image could not be decoded. Choose a valid JPG, PNG or WebP image."));
    };
    image.src = url;
  });
}

export async function prepareSpotlightImage(file) {
  if (!(file instanceof File) || !ACCEPTED_TYPES.has(file.type)) {
    throw new Error("Choose a JPG, PNG or WebP image.");
  }
  const image = await loadImage(file);
  if (!image.naturalWidth || !image.naturalHeight) throw new Error("That image has invalid dimensions.");
  const scale = Math.min(1, MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Your browser could not prepare this image. Try another browser or a smaller image.");
  context.drawImage(image, 0, 0, width, height);

  for (const quality of [0.9, 0.82, 0.72, 0.62]) {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", quality));
    if (blob && blob.size > 0 && blob.size <= MAX_BYTES && ACCEPTED_TYPES.has(blob.type)) {
      const name = file.name.replace(/\.[^.]+$/, "") || "spotlight-image";
      const extension = blob.type === "image/png" ? "png" : blob.type === "image/jpeg" ? "jpg" : "webp";
      return new File([blob], `${name}.${extension}`, { type: blob.type, lastModified: file.lastModified });
    }
  }
  throw new Error("This image could not be reduced below 5 MB. Choose a simpler or smaller image.");
}
