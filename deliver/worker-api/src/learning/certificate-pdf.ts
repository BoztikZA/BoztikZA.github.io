// Boztik Learning — certificate PDF (A4 landscape, print-ready, vector only, standard fonts → tiny file).
// Colour use is deliberately restrained: warm paper, near-black green ink, neon green only for the emblem and fine detail.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export const GLOBAL_DISCLAIMER = [
  "Boztik courses are independently developed educational and skills-development programmes designed to provide practical knowledge and learning opportunities.",
  "These courses are not formally accredited by any recognised educational, professional or regulatory accreditation body.",
  "Certificates issued by Boztik are certificates of completion or achievement for independently provided training. They do not represent formally recognised academic qualifications, professional certifications, academic credits or licences.",
  "Completion of a Boztik course does not guarantee employment, professional recognition or acceptance by educational institutions or employers.",
  "Our mission is to make practical, accessible and valuable learning opportunities available to everyone, everywhere.",
];

export interface CertificateData {
  certificateId: string;
  learnerName: string;
  courseTitle: string;
  issuedAt: number; // unix seconds
  scorePercent: number;
  passMark: number;
  practicalPercent: number | null;
  practicalPassMark: number | null;
  verifyUrl: string;
}

const PAPER = rgb(0.984, 0.980, 0.965);
const INK = rgb(0.043, 0.075, 0.051);
const MUTED = rgb(0.33, 0.38, 0.34);
const NEON = rgb(0.557, 1, 0.239);       // #8eff3d — the Boztik neon green
const NEON_DEEP = rgb(0.255, 0.545, 0.063); // darker green that stays legible on paper
const PLATE = rgb(0.02, 0.031, 0.024);   // #050806

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** Dates are shown in South African time (UTC+2, no DST). */
export function formatCertificateDate(unix: number): string {
  const d = new Date((unix + 2 * 3600) * 1000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function spacedWidth(text: string, font: PDFFont, size: number, spacing: number): number {
  return font.widthOfTextAtSize(text, size) + spacing * Math.max(0, text.length - 1);
}
function drawSpacedCentered(page: PDFPage, text: string, cx: number, y: number, font: PDFFont, size: number, spacing: number, color = INK): void {
  let x = cx - spacedWidth(text, font, size, spacing) / 2;
  for (const ch of text) {
    page.drawText(ch, { x, y, size, font, color });
    x += font.widthOfTextAtSize(ch, size) + spacing;
  }
}
function drawCentered(page: PDFPage, text: string, cx: number, y: number, font: PDFFont, size: number, color = INK): void {
  page.drawText(text, { x: cx - font.widthOfTextAtSize(text, size) / 2, y, size, font, color });
}
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= maxWidth || !line) line = next;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

/** The Boztik Learning "ascent" mark: three rising bars and a spark, on a dark plate. */
function drawEmblem(page: PDFPage, cx: number, cy: number, r: number): void {
  page.drawCircle({ x: cx, y: cy, size: r, color: PLATE });
  page.drawCircle({ x: cx, y: cy, size: r - 2.2, borderColor: NEON, borderWidth: 0.6 });
  const bw = r * 0.26, gap = r * 0.12;
  const heights = [r * 0.5, r * 0.82, r * 1.14];
  const total = bw * 3 + gap * 2;
  let x = cx - total / 2;
  const base = cy - r * 0.52;
  for (const h of heights) {
    page.drawRectangle({ x, y: base, width: bw, height: h, color: NEON });
    x += bw + gap;
  }
  page.drawCircle({ x: cx + total / 2 - bw / 2, y: base + heights[2]! + r * 0.2, size: r * 0.09, color: NEON });
}

function drawSeal(page: PDFPage, cx: number, cy: number): void {
  page.drawCircle({ x: cx, y: cy, size: 34, borderColor: NEON_DEEP, borderWidth: 1.2 });
  page.drawCircle({ x: cx, y: cy, size: 30, borderColor: NEON_DEEP, borderWidth: 0.4 });
  page.drawCircle({ x: cx, y: cy, size: 24, color: PLATE });
  // a ring of small ticks
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const r1 = 31.2, r2 = i % 4 === 0 ? 33.4 : 32.4;
    page.drawLine({ start: { x: cx + Math.cos(a) * r1, y: cy + Math.sin(a) * r1 }, end: { x: cx + Math.cos(a) * r2, y: cy + Math.sin(a) * r2 }, thickness: 0.4, color: NEON_DEEP });
  }
  const bw = 4.2, gap = 2.2, hs = [8, 13, 18];
  let x = cx - (bw * 3 + gap * 2) / 2;
  for (const h of hs) { page.drawRectangle({ x, y: cy - 9, width: bw, height: h, color: NEON }); x += bw + gap; }
}

function cornerBracket(page: PDFPage, x: number, y: number, dx: number, dy: number): void {
  const len = 22;
  page.drawLine({ start: { x, y }, end: { x: x + dx * len, y }, thickness: 1.6, color: NEON_DEEP });
  page.drawLine({ start: { x, y }, end: { x, y: y + dy * len }, thickness: 1.6, color: NEON_DEEP });
}

export async function renderCertificatePdf(c: CertificateData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Boztik Learning — Certificate of Achievement — ${c.certificateId}`);
  pdf.setAuthor("Boztik Learning");
  pdf.setSubject(c.courseTitle);
  pdf.setProducer("Boztik Learning Hub");
  pdf.setCreator("Boztik Learning Hub");
  const page = pdf.addPage([841.89, 595.28]);
  const W = 841.89, H = 595.28, cx = W / 2;
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const serifItalic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const serifBold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const sansBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: PAPER });
  // Borders: heavy outer, hairline inner, corner brackets.
  page.drawRectangle({ x: 18, y: 18, width: W - 36, height: H - 36, borderColor: INK, borderWidth: 1.6 });
  page.drawRectangle({ x: 25, y: 25, width: W - 50, height: H - 50, borderColor: NEON_DEEP, borderWidth: 0.5 });
  cornerBracket(page, 31, 31, 1, 1); cornerBracket(page, W - 31, 31, -1, 1);
  cornerBracket(page, 31, H - 31, 1, -1); cornerBracket(page, W - 31, H - 31, -1, -1);

  // Header
  drawEmblem(page, cx, H - 78, 26);
  drawSpacedCentered(page, "BOZTIK LEARNING", cx, H - 124, sansBold, 10.5, 4.2);
  drawSpacedCentered(page, "CERTIFICATE OF ACHIEVEMENT", cx, H - 168, serifBold, 25, 3.2);
  page.drawLine({ start: { x: cx - 38, y: H - 180 }, end: { x: cx + 38, y: H - 180 }, thickness: 1.2, color: NEON_DEEP });

  drawCentered(page, "This certifies that", cx, H - 205, serifItalic, 13, MUTED);

  // Learner name: shrink to fit the page width.
  let nameSize = 40;
  while (nameSize > 22 && serifItalic.widthOfTextAtSize(c.learnerName, nameSize) > W - 220) nameSize -= 2;
  drawCentered(page, c.learnerName, cx, H - 247, serifItalic, nameSize, INK);
  const nameW = Math.min(W - 200, Math.max(280, serifItalic.widthOfTextAtSize(c.learnerName, nameSize) + 60));
  page.drawLine({ start: { x: cx - nameW / 2, y: H - 258 }, end: { x: cx + nameW / 2, y: H - 258 }, thickness: 0.6, color: INK });

  drawCentered(page, "has successfully completed the course and passed the assessment for", cx, H - 281, serifItalic, 12.5, MUTED);

  // Course title (up to two lines)
  let titleSize = 21;
  let titleLines = wrap(c.courseTitle, sansBold, titleSize, W - 180);
  if (titleLines.length > 2) { titleSize = 17; titleLines = wrap(c.courseTitle, sansBold, titleSize, W - 160).slice(0, 2); }
  let ty = H - 312;
  for (const line of titleLines) { drawCentered(page, line, cx, ty, sansBold, titleSize, INK); ty -= titleSize + 5; }

  // Details row
  const rowTop = ty - 14;
  const cols: { label: string; value: string }[] = [
    { label: "DATE OF COMPLETION", value: formatCertificateDate(c.issuedAt) },
    { label: c.practicalPercent != null ? "WRITTEN SCORE" : "EXAMINATION SCORE", value: `${c.scorePercent}%` },
    { label: c.practicalPercent != null ? "WRITTEN PASS MARK" : "REQUIRED PASS MARK", value: `${c.passMark}%` },
  ];
  if (c.practicalPercent != null) {
    cols.push({ label: "PRACTICAL SCORE", value: `${c.practicalPercent}%${c.practicalPassMark != null ? ` (pass ${c.practicalPassMark}%)` : ""}` });
  }
  const colW = 170;
  const startX = cx - (colW * cols.length) / 2;
  cols.forEach((col, i) => {
    const mid = startX + colW * i + colW / 2;
    drawSpacedCentered(page, col.label, mid, rowTop, sansBold, 6.4, 1.6, MUTED);
    drawCentered(page, col.value, mid, rowTop - 20, sansBold, 15, INK);
    if (i > 0) page.drawLine({ start: { x: startX + colW * i, y: rowTop + 8 }, end: { x: startX + colW * i, y: rowTop - 26 }, thickness: 0.4, color: NEON_DEEP });
  });

  // Identity row: ID + verification (left), seal (centre), issuer (right)
  const idY = rowTop - 70;
  const leftX = 70;
  drawSpacedLeft(page, "CERTIFICATE ID", leftX, idY, sansBold, 6.4, 1.6, MUTED);
  page.drawText(c.certificateId, { x: leftX, y: idY - 14, size: 12.5, font: sansBold, color: INK });
  drawSpacedLeft(page, "VERIFY THIS CERTIFICATE", leftX, idY - 32, sansBold, 6.4, 1.6, MUTED);
  page.drawText(c.verifyUrl, { x: leftX, y: idY - 45, size: 8.6, font: sans, color: NEON_DEEP });
  drawSeal(page, cx, idY - 14);
  const rightX = W - 70;
  const issuer = "Boztik Learning";
  page.drawLine({ start: { x: rightX - 150, y: idY - 6 }, end: { x: rightX, y: idY - 6 }, thickness: 0.5, color: INK });
  page.drawText(issuer, { x: rightX - serifItalic.widthOfTextAtSize(issuer, 14), y: idY + 2, size: 14, font: serifItalic, color: INK });
  const issuerLabel = "ISSUED ONLINE BY BOZTIK";
  drawSpacedRight(page, issuerLabel, rightX, idY - 19, sansBold, 6.4, 1.6, MUTED);
  page.drawText("www.boztik.com/learning", { x: rightX - sans.widthOfTextAtSize("www.boztik.com/learning", 8.6), y: idY - 32, size: 8.6, font: sans, color: MUTED });

  // Disclaimer (verbatim global text)
  const dTop = idY - 78;
  page.drawLine({ start: { x: 70, y: dTop + 10 }, end: { x: W - 70, y: dTop + 10 }, thickness: 0.4, color: NEON_DEEP });
  let y = dTop;
  const dSize = 7.2, dLead = 9.2, dWidth = W - 140;
  GLOBAL_DISCLAIMER.forEach((para, i) => {
    const font = i === GLOBAL_DISCLAIMER.length - 1 ? serifItalic : serif;
    for (const line of wrap(para, font, dSize, dWidth)) { page.drawText(line, { x: 70, y, size: dSize, font, color: MUTED }); y -= dLead; }
    y -= 2.2;
  });
  if (y < 30) throw new Error("certificate layout overflow"); // guards against future copy/layout drift

  return pdf.save();
}

function drawSpacedLeft(page: PDFPage, text: string, x: number, y: number, font: PDFFont, size: number, spacing: number, color = INK): void {
  let cur = x;
  for (const ch of text) { page.drawText(ch, { x: cur, y, size, font, color }); cur += font.widthOfTextAtSize(ch, size) + spacing; }
}
function drawSpacedRight(page: PDFPage, text: string, xRight: number, y: number, font: PDFFont, size: number, spacing: number, color = INK): void {
  drawSpacedLeft(page, text, xRight - spacedWidth(text, font, size, spacing), y, font, size, spacing, color);
}
