# Test fixtures

All texts in this directory are **synthetic** — written by the build agent for
this project. Per the fixture constraint (AGENTS.md constraint 5 / AGENTS2.md
constraint 6), no real legal text is copied: these imitate the structure of
each supported document type but contain no real persons, companies,
addresses, or signatures, and are clearly labelled as synthetic. Nothing here
is modelled on any real company's published terms.

## Lease (`lease`)

- `synthetic-numbered.txt` — clauses as numbered sections (`1.`, `2.`, …)
- `synthetic-caps-headers.txt` — clauses grouped under ALL-CAPS headings
- `synthetic-unstructured.txt` — prose paragraphs, no numbering or headings
  (also the "no clear numbering at all" case for the unstructured fallback)

## Other document types (parser tests)

- `synthetic-nda.txt` — synthetic mutual NDA (`nda`), clauses as numbered
  sections: confidential-info definition, obligations, exclusions,
  permitted/compelled disclosure, duration, return of materials, remedies,
  governing law
- `synthetic-freelance.txt` — synthetic freelance/client contract
  (`freelance_contract`), clauses grouped under ALL-CAPS headings:
  PAYMENT TERMS, IP OWNERSHIP, TERMINATION, CONFIDENTIALITY, DELIVERABLES,
  LIABILITY, and others
- `synthetic-tos.txt` — synthetic terms-of-service/privacy policy
  (`tos_privacy_policy`), clauses as numbered sections: data collection,
  data sharing, user rights, account termination, liability, dispute
  resolution, and others

## Binary fixtures (ingestion tests)

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
