// Generates the binary test fixtures from the synthetic lease text:
//   synthetic-lease.pdf  — real text-based PDF (pdf-lib)
//   synthetic-lease.docx — real DOCX (docx)
//   blank.pdf            — valid PDF with no text layer (scan stand-in)
// Everything here is synthetic (AGENTS.md constraint 5) — see README.md.
import { readFileSync, writeFileSync } from "node:fs";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { PDFDocument, StandardFonts } from "pdf-lib";

const here = (name) => new URL(name, import.meta.url);
const numbered = readFileSync(here("./synthetic-numbered.txt"), "utf8");

// --- synthetic-lease.pdf --------------------------------------------------
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
const pageWidth = 595.28;
const pageHeight = 841.89;
const margin = 56;
const size = 10;
const leading = 14;
const maxChars = 88; // simple greedy wrap — keeps every line inside the page

let page = pdf.addPage([pageWidth, pageHeight]);
let y = pageHeight - margin;

const lines = [];
for (const rawLine of numbered.split("\n")) {
  const trimmed = rawLine.trim();
  if (trimmed === "") {
    lines.push("");
    continue;
  }
  let current = "";
  for (const word of trimmed.split(/\s+/)) {
    if (current === "") {
      current = word;
    } else if (`${current} ${word}`.length <= maxChars) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = `  ${word}`; // continuation lines are indented
    }
  }
  lines.push(current);
}

for (const line of lines) {
  if (y < margin) {
    page = pdf.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
  }
  if (line !== "") {
    // Helvetica (WinAnsi) can't encode ₹ or typographic quotes — normalise.
    const safe = line.replaceAll("₹", "Rs.").replaceAll(/[“”]/g, '"').replaceAll("’", "'");
    page.drawText(safe, { x: margin, y, size, font });
  }
  y -= leading;
}
writeFileSync(here("./synthetic-lease.pdf"), await pdf.save());

// --- synthetic-lease.docx -------------------------------------------------
const paragraphs = numbered
  .split(/\n\s*\n/)
  .map((block) => block.trim())
  .filter(Boolean)
  .map((text) => new Paragraph({ children: [new TextRun(text)] }));

const docx = new Document({ sections: [{ children: paragraphs }] });
writeFileSync(here("./synthetic-lease.docx"), await Packer.toBuffer(docx));

// --- blank.pdf (no text layer) --------------------------------------------
const blank = await PDFDocument.create();
blank.addPage([pageWidth, pageHeight]);
writeFileSync(here("./blank.pdf"), await blank.save());

console.log("wrote synthetic-lease.pdf, synthetic-lease.docx, blank.pdf");
