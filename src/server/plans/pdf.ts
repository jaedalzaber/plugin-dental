// A small, dependency-free acceptance PDF (text on A4, standard Helvetica; characters outside Latin-1 print as "?").
// pdf-lib lives in core only, so this writes the few PDF objects by hand. A drawn signature is added as vector strokes.

export interface AcceptancePdfInput {
  businessName: string;
  patientName: string;
  planTitle: string;
  planId: string;
  /** One row per planned visit: the description and its price text. */
  rows: { text: string; amount: string }[];
  estimate: string;
  insurance: string;
  patientShare: string;
  signerName: string;
  acceptedAt: string;
  /** True when the patient typed their name instead of drawing. */
  typed: boolean;
  signatureFileId: string | null;
  /** Normalised pen strokes: each stroke is a list of [x, y] in 0..1 (y down). */
  strokes: number[][][];
  /** SHA-256 of the plan content at the time of acceptance. */
  hash: string;
}

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 48;
const LEADING = 14;
const WRAP = 88;

/** Latin-1 text with control characters removed and anything else outside the font replaced by "?". */
function latin1(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 63;
    if (c < 32) out += " ";
    else if (c > 255 || (c >= 127 && c <= 159)) out += "?";
    else out += ch;
  }
  return out;
}

const pdfText = (text: string): string => latin1(text).replace(/[\\()]/g, (m) => `\\${m}`);

function wrap(text: string): string[] {
  const words = latin1(text).split(/\s+/).filter((w) => w !== "");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const piece = word.length > WRAP ? word.slice(0, WRAP) : word;
    if (line !== "" && line.length + 1 + piece.length > WRAP) {
      lines.push(line);
      line = piece;
    } else line = line === "" ? piece : `${line} ${piece}`;
  }
  if (line !== "") lines.push(line);
  return lines.length > 0 ? lines : [""];
}

export function buildAcceptancePdf(input: AcceptancePdfInput): Uint8Array {
  const pages: string[][] = [[]];
  let y = PAGE_H - MARGIN;
  const room = (needed: number): void => {
    if (y - needed >= MARGIN) return;
    pages.push([]);
    y = PAGE_H - MARGIN;
  };
  const put = (op: string): void => {
    (pages[pages.length - 1] as string[]).push(op);
  };
  const line = (text: string, o: { bold?: boolean; size?: number; x?: number } = {}): void => {
    const size = o.size ?? 10;
    room(size + 4);
    put(`BT /${o.bold ? "F2" : "F1"} ${size} Tf ${o.x ?? MARGIN} ${y} Td (${pdfText(text)}) Tj ET`);
    y -= size + 4;
  };
  const para = (text: string, o: { bold?: boolean; size?: number } = {}): void => {
    for (const part of wrap(text)) line(part, o);
  };
  const gap = (n = LEADING): void => {
    y -= n;
  };

  line(input.businessName, { bold: true, size: 16 });
  line("Treatment plan acceptance", { size: 12 });
  gap();
  line(`Patient: ${input.patientName}`);
  line(`Plan: ${input.planTitle}`, { bold: true });
  line(`Plan reference: ${input.planId}`, { size: 8 });
  gap();
  line("Planned treatment", { bold: true });
  input.rows.forEach((row, i) => {
    const parts = wrap(`${i + 1}. ${row.text}`);
    room(parts.length * LEADING);
    const top = y;
    parts.forEach((p) => line(p));
    put(`BT /F1 10 Tf ${PAGE_W - MARGIN - 90} ${top} Td (${pdfText(row.amount)}) Tj ET`);
  });
  gap(6);
  line(`Estimated total: ${input.estimate}`, { bold: true });
  line(`Insurance estimate: ${input.insurance}`);
  line(`Patient share: ${input.patientShare}`);
  gap();
  para("I have read the treatment plan above, I understand the proposed treatment and its estimated cost, and I accept it. The estimate may change if the treatment needs to change.");
  gap();
  line(`Accepted by: ${input.signerName}`, { bold: true });
  line(`Accepted at: ${input.acceptedAt}`);
  line(input.typed ? "Signature: typed name" : "Signature: drawn (below)");
  if (input.signatureFileId) line(`Signature image file: ${input.signatureFileId}`, { size: 8 });
  line(`Plan content SHA-256: ${input.hash}`, { size: 8 });

  if (!input.typed && input.strokes.length > 0) {
    const boxW = 240;
    const boxH = 80;
    gap(6);
    room(boxH + 8);
    const x0 = MARGIN;
    const y0 = y - boxH;
    const clamp = (n: number): number => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
    put(`0.6 G ${x0} ${y0} ${boxW} ${boxH} re S 0 G 1.2 w 1 J 1 j`);
    for (const stroke of input.strokes) {
      const points = stroke.filter((p) => p.length >= 2);
      if (points.length === 0) continue;
      const at = (p: number[]): string => `${(x0 + clamp(p[0] ?? 0) * boxW).toFixed(1)} ${(y0 + (1 - clamp(p[1] ?? 0)) * boxH).toFixed(1)}`;
      const [first, ...rest] = points;
      put(rest.length === 0 ? `${at(first as number[])} m ${at(first as number[])} l S` : `${at(first as number[])} m ${rest.map((p) => `${at(p)} l`).join(" ")} S`);
    }
    y = y0 - 8;
  }

  // Objects: 1 catalog, 2 pages, 3 and 4 fonts, then a page and its content stream per page.
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  const add = (n: number, body: string): void => {
    offsets[n] = out.length;
    out += `${n} 0 obj\n${body}\nendobj\n`;
  };
  const pageObj = (i: number): number => 5 + i * 2;
  add(1, "<< /Type /Catalog /Pages 2 0 R >>");
  add(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  add(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  add(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  pages.forEach((ops, i) => {
    const content = ops.join("\n");
    add(pageObj(i), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageObj(i) + 1} 0 R >>`);
    add(pageObj(i) + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  const count = 5 + pages.length * 2;
  const xref = out.length;
  out += `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) out += `${String(offsets[n] ?? 0).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
