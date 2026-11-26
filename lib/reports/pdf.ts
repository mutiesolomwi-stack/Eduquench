import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/** The standard PDF fonts only cover Latin-1; anything else is replaced so a name can never crash an export. */
export const pdfSafe = (v: unknown): string => String(v ?? "").replace(/[\r\n\t]+/g, " ").replace(/[^\x20-\x7E -ÿ]/g, "?");

export async function tablePdf(opts: { title: string; subtitle?: string; columns: { key: string; header: string; width: number }[]; rows: Record<string, unknown>[] }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 842, H = 595, M = 36, rowH = 18, size = 9; // A4 landscape
  const total = opts.columns.reduce((a, c) => a + c.width, 0), scale = (W - 2 * M) / total;
  const fit = (t: string, w: number, f = font) => { let s = t; while (s.length > 1 && f.widthOfTextAtSize(s, size) > w - 6) s = s.slice(0, -1); return s === t ? s : s.slice(0, -1) + "…".replace("…", "."); };
  let page = doc.addPage([W, H]), y = H - M, n = 0;
  const head = () => {
    page.drawText(pdfSafe(opts.title), { x: M, y: y - 14, size: 15, font: bold, color: rgb(0.043, 0.239, 0.569) });
    if (opts.subtitle) page.drawText(pdfSafe(opts.subtitle), { x: M, y: y - 30, size: 9, font, color: rgb(0.27, 0.33, 0.42) });
    y -= 46; let x = M;
    page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: rowH, color: rgb(0.91, 0.96, 1) });
    for (const c of opts.columns) { page.drawText(fit(pdfSafe(c.header), c.width * scale, bold), { x: x + 3, y, size, font: bold }); x += c.width * scale; }
    y -= rowH;
  };
  head();
  for (const r of opts.rows) {
    if (y < M + rowH) { page = doc.addPage([W, H]); y = H - M; head(); }
    let x = M;
    for (const c of opts.columns) { page.drawText(fit(pdfSafe(r[c.key]), c.width * scale), { x: x + 3, y, size, font }); x += c.width * scale; }
    page.drawLine({ start: { x: M, y: y - 4 }, end: { x: W - M, y: y - 4 }, thickness: 0.3, color: rgb(0.83, 0.87, 0.91) });
    y -= rowH; n++;
  }
  const pages = doc.getPages(); const stamp = `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · ${n} rows · Eduquench`;
  pages.forEach((p, i) => p.drawText(`${stamp} · page ${i + 1} of ${pages.length}`, { x: M, y: 16, size: 7, font, color: rgb(0.4, 0.4, 0.4) }));
  return doc.save();
}
