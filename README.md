# PlainLease

A GenAI assistant that helps someone understand, question, and compare a legal
document before signing or agreeing to it — built for a hackathon themed on
making legal information and basic legal assistance more accessible.

**This tool provides information, not legal advice.**

## Supported document types

Five, deliberately — not open-ended "any legal document":

| Type | Who's reading it |
|---|---|
| Rental lease | A tenant reviewing a rental agreement |
| Freelance / client contract | A freelancer or gig worker reviewing a client contract |
| Terms & privacy policy | A consumer reviewing an app or service's terms |
| Non-disclosure agreement | Someone asked to sign an NDA |
| Employment offer letter | A candidate reviewing a job offer |

Each type has its own clause-category taxonomy (`lib/documentTypes/config.ts`)
so risk flagging and checklists stay consistent and testable per type, instead
of relying on the model to invent categories on the fly.

## How it works

```
Client (Next.js)
  → API routes
      → Deterministic parser (pure functions, no LLM, type-agnostic)
          → feeds clause text + confirmed document type to
      → Gemini API (detect type / classify / explain)
  → both write to
      → Document store (in-memory session state)
  → results (risk levels, explanations, citations) flow back to the client
```

### Why the deterministic / LLM split exists

Clause segmentation (`lib/parser/segmentClauses.ts`) is a deterministic, pure
function with no LLM call in it and zero knowledge of document type. The LLM
only classifies and explains clauses the deterministic layer already found —
it never decides where a clause starts or ends. The parser's output, plus the
user-confirmed document type, is the *only* thing the Gemini layer reasons
about for a given document. This boundary is what prevents hallucination: the
model can't drift to general legal knowledge because it never sees anything
but the text in front of it, and the segmentation output is auditable and
unit-testable without any API calls.

### Why document-type confirmation is a user step

Type detection (`lib/documentTypes/detectType.ts`) is one Gemini call that
returns a **suggestion** with a confidence score — possibly `none_of_these`
→ see "Known limitations". A wrong auto-detected type changes which category
taxonomy gets used downstream, which silently changes every risk flag and
explanation the user sees. So the suggestion is always shown with an override
dropdown before classification runs, never applied silently. A misdetection
is easy to catch and fix; a silent one is not.

## Running locally

```bash
npm install
GEMINI_API_KEY=your-key npm run dev
```

Tests:

```bash
npm test
```

## Tooling choices

- **Next.js (App Router) + TypeScript + Tailwind** — one deployable unit for
  UI and API routes, typed data models shared across the boundary.
- **Gemini API** — cheap structured-JSON output (category enums, confidence
  scores) for classification and detection.
- **Vitest** — fast, zero-config, runs the same TS the app runs.
- **In-memory document store** — nothing persists long-term; a lease is
  sensitive personal data and the MVP demo needs no accounts.
- **unpdf / mammoth** — dependency-light PDF and DOCX text extraction.

## Known limitations

- In-memory store: documents vanish on redeploy/restart, and serverless
  instances don't share state. Fine for the demo, not production.
- Type detection is a single LLM call — it can misdetect; that's exactly why
  confirmation is a user step (4/5-or-better on clean samples is the bar, not
  perfection).
- Comparison mode is same-type only — cross-type diffs would be nonsense.
- Explanations are only as good as text extraction; scanned/image-only PDFs
  without a text layer yield nothing useful.
- No jurisdiction-specific correctness guarantees — the tool flags and
  explains, it does not certify compliance with any specific law.

## Deployment

Vercel. Set `GEMINI_API_KEY` (and optionally `NEXT_PUBLIC_APP_NAME`) in the
project's environment variables.
