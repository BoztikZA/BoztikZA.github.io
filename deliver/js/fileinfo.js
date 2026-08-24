// Boztik Deliver — client-side file information panel
// No external dependencies. All parsing happens locally in the browser
// against bytes already fetched for preview/download — nothing is sent
// anywhere else.

const IMAGE_LABELS = { "image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP", "image/tiff": "TIFF", "image/gif": "GIF" };
const FILE_TYPE_LABELS = { zip: "Archive", pdf: "Document", psd: "Design file (Photoshop)", ai: "Design file (Illustrator)", eps: "Design file (EPS)" };

function extOf(name) { return (name.split(".").pop() || "").toLowerCase(); }
function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }

function aspectRatio(width, height) {
  const divisor = gcd(width, height) || 1;
  const w = width / divisor, h = height / divisor;
  // Keep small whole-number ratios readable; otherwise fall back to a decimal ratio.
  if (w <= 40 && h <= 40) return `${w}:${h}`;
  return `${(width / height).toFixed(2)}:1`;
}

function printSize(px, dpi) { return (px / dpi).toFixed(1); }

function qualitySummary(megapixels) {
  if (megapixels >= 20) return "Excellent for large prints";
  if (megapixels >= 12) return "Great for standard prints up to A3";
  if (megapixels >= 6) return "Good for prints up to A4 and digital use";
  if (megapixels >= 2) return "Suitable for smaller prints and digital use";
  return "Best suited for screen/digital use";
}

export function getImageDimensions(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("Could not read image dimensions"));
    img.src = url;
  });
}

// Minimal JPEG EXIF reader — reads only the APP1/Exif segment and a small,
// fixed set of tags. Not a general-purpose EXIF library by design.
const EXIF_TAGS = {
  0x010f: "make", 0x0110: "model", 0x0112: "orientation", 0x829a: "exposureTime",
  0x829d: "fNumber", 0x8827: "iso", 0x9003: "dateTaken", 0x920a: "focalLength", 0xa001: "colorSpace"
};

export async function parseExif(arrayBuffer) {
  try {
    const view = new DataView(arrayBuffer);
    if (view.getUint16(0) !== 0xffd8) return null; // not a JPEG
    let offset = 2;
    while (offset < view.byteLength - 4) {
      const marker = view.getUint16(offset);
      const size = view.getUint16(offset + 2);
      if (marker === 0xffe1) { // APP1
        const exifStart = offset + 4;
        if (view.getUint32(exifStart) !== 0x45786966) break; // "Exif"
        return readTiff(view, exifStart + 6);
      }
      if ((marker & 0xff00) !== 0xff00) break;
      offset += 2 + size;
    }
  } catch { /* corrupt or unreadable — treat as no EXIF */ }
  return null;
}

function readTiff(view, tiffStart) {
  const little = view.getUint16(tiffStart) === 0x4949;
  const get16 = o => view.getUint16(o, little);
  const get32 = o => view.getUint32(o, little);
  const ifdOffset = tiffStart + get32(tiffStart + 4);
  const count = get16(ifdOffset);
  const result = {};
  for (let i = 0; i < count; i++) {
    const entry = ifdOffset + 2 + i * 12;
    const tag = get16(entry);
    const key = EXIF_TAGS[tag];
    if (!key) continue;
    const type = get16(entry + 2);
    const numValues = get32(entry + 4);
    const valueOffset = entry + 8;
    try {
      if (type === 2) { // ASCII string
        const strOffset = numValues > 4 ? tiffStart + get32(valueOffset) : valueOffset;
        let str = "";
        for (let j = 0; j < numValues - 1; j++) str += String.fromCharCode(view.getUint8(strOffset + j));
        result[key] = str.trim();
      } else if (type === 3) { // SHORT
        result[key] = get16(valueOffset);
      } else if (type === 5 || type === 10) { // RATIONAL / SRATIONAL
        const ratOffset = tiffStart + get32(valueOffset);
        const num = type === 5 ? get32(ratOffset) : view.getInt32(ratOffset, little);
        const den = type === 5 ? get32(ratOffset + 4) : view.getInt32(ratOffset + 4, little);
        result[key] = den ? num / den : 0;
      }
    } catch { /* skip unreadable tag */ }
  }
  return Object.keys(result).length ? result : null;
}

export async function estimatePdfPageCount(arrayBuffer) {
  try {
    const text = new TextDecoder("latin1").decode(arrayBuffer);
    const matches = text.match(/\/Type\s*\/Page(?!s)/g);
    return matches ? matches.length : null;
  } catch { return null; }
}

function row(label, value) { return value === undefined || value === null || value === "" ? "" : `<div class="fileinfo-item"><span>${label}</span><strong>${value}</strong></div>`; }
function rowWide(label, value) { return value === undefined || value === null || value === "" ? "" : `<div class="fileinfo-item fileinfo-item-wide"><span>${label}</span><strong>${value}</strong></div>`; }
function chip(value) { return value === undefined || value === null || value === "" ? "" : `<span class="fileinfo-chip">${value}</span>`; }

// Compact glance row (format / dimensions / size) shown immediately, plus a
// single collapsible <details> for everything else — full spec sheet and
// print/output estimates stay one click away instead of dominating the card.
export function buildImageInfoHTML({ fileName, sizeLabel, format, mimeType, width, height, exif }) {
  const megapixels = (width * height) / 1_000_000;
  const orientation = width === height ? "Square" : width > height ? "Landscape" : "Portrait";

  const chips = [
    chip(format),
    chip(`${width} × ${height}px`),
    chip(`${megapixels.toFixed(1)} MP`)
  ].join("");

  const rows = [
    row("Filename", fileName),
    row("File size", sizeLabel),
    row("Aspect ratio", aspectRatio(width, height)),
    row("Orientation", orientation),
    row("Color", exif?.colorSpace === 1 ? "RGB" : ""),
    row("MIME type", mimeType)
  ];
  if (exif) {
    const camera = [exif.make, exif.model].filter(Boolean).join(" ");
    rows.push(row("Camera", camera));
    rows.push(row("Focal length", exif.focalLength ? `${Math.round(exif.focalLength)}mm` : ""));
    rows.push(row("Aperture", exif.fNumber ? `f/${exif.fNumber.toFixed(1)}` : ""));
    rows.push(row("Shutter speed", exif.exposureTime ? (exif.exposureTime < 1 ? `1/${Math.round(1 / exif.exposureTime)}s` : `${exif.exposureTime}s`) : ""));
    rows.push(row("ISO", exif.iso));
    rows.push(row("Date captured", exif.dateTaken));
  }

  const print = width && height ? `
    <div class="fileinfo-print">
      <h5>Print &amp; output</h5>
      <div class="fileinfo-grid">
        ${row("300 DPI", `${printSize(width, 300)} × ${printSize(height, 300)} in`)}
        ${row("240 DPI", `${printSize(width, 240)} × ${printSize(height, 240)} in`)}
        ${row("150 DPI", `${printSize(width, 150)} × ${printSize(height, 150)} in`)}
        ${rowWide("Best for", qualitySummary(megapixels))}
      </div>
    </div>` : "";

  return `
    <div class="fileinfo-chips">${chips}</div>
    <details class="fileinfo-details" open>
      <summary>File details</summary>
      <div class="fileinfo-body">
        <div class="fileinfo-grid">${rows.join("")}</div>
        ${print}
      </div>
    </details>`;
}

export function buildGenericInfoHTML({ fileName, sizeLabel, format, mimeType, pageCount }) {
  const ext = extOf(fileName);

  const chips = [
    chip(FILE_TYPE_LABELS[ext] || format),
    chip(sizeLabel),
    ext === "pdf" && pageCount ? chip(`${pageCount} page${pageCount === 1 ? "" : "s"}`) : ""
  ].join("");

  const rows = [
    row("Filename", fileName),
    row("Format", format),
    row("MIME type", mimeType),
    ext === "pdf" ? row("Pages", pageCount) : ""
  ];

  return `
    <div class="fileinfo-chips">${chips}</div>
    <details class="fileinfo-details">
      <summary>File details</summary>
      <div class="fileinfo-body">
        <div class="fileinfo-grid">${rows.join("")}</div>
      </div>
    </details>`;
}

export function formatLabelFor(fileName, mimeType) {
  return IMAGE_LABELS[mimeType] || extOf(fileName).toUpperCase();
}