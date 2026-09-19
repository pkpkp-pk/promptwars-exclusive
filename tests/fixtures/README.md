# Test fixtures

All lease texts in this directory are **synthetic** — written by the build
agent for this project. Per AGENTS.md constraint 5, no "real" legal text is
fabricated: these imitate the structure of Indian residential rent agreements
but contain no real persons, addresses, or signatures, and are clearly
labelled as synthetic.

- `synthetic-numbered.txt` — clauses as numbered sections (`1.`, `2.`, …)
- `synthetic-caps-headers.txt` — clauses grouped under ALL-CAPS headings
- `synthetic-unstructured.txt` — prose paragraphs, no numbering or headings
- `synthetic-lease.docx` — generated from `synthetic-numbered.txt` by
  `generate.mjs` (a real DOCX, for ingestion tests)
- `synthetic-lease.pdf` — generated from `synthetic-numbered.txt` by
  `generate.mjs` (a real text-based PDF, for ingestion tests)
- `blank.pdf` — a valid PDF with no text layer, standing in for a scanned
  document (for the "no selectable text" rejection path)

Regenerate the binary fixtures with:

```sh
node tests/fixtures/generate.mjs
```
