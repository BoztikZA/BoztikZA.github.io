// Same alphabet and shape as deliver/js/shared.js's deliveryId() — chosen
// to avoid visually ambiguous characters (no 0/O, 1/I, etc.). Kept
// identical on purpose so BZ- links continue to look the same to clients
// regardless of which backend created them.
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function randomToken(length: number): string {
  const values = crypto.getRandomValues(new Uint8Array(length));
  return [...values].map((v) => ALPHABET[v % ALPHABET.length]).join("");
}

export function newDeliveryId(): string {
  return `BZ-${randomToken(8)}`;
}

/** Duplicate IDs get their own fresh random suffix rather than the current
 *  system's `-COPY-XXXX` appended to the original ID — avoids leaking any
 *  relationship to the source delivery's ID (Phase 2 §15 security note). */
export function newDuplicateDeliveryId(): string {
  return `BZ-${randomToken(8)}`;
}

export function newFileId(): string {
  return randomToken(4).toLowerCase();
}

export function newUploadId(): string {
  return randomToken(12).toLowerCase();
}

export function sanitizeFilename(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^\w.\- ]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 120) || "file";
}

export function r2KeyFor(deliveryId: string, fileId: string, filename: string): string {
  return `deliveries/${deliveryId}/${fileId}-${sanitizeFilename(filename)}`;
}
