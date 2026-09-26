# PlainLease

A GenAI assistant that reads a legal document with you before you sign it.
Upload a PDF or DOCX; the app splits it into clauses deterministically,
suggests the document type for your confirmation, then explains each clause in
plain language with a risk flag, and answers questions grounded in the actual
clause text. Built for a hackathon on making legal information accessible.

**Live:** https://promptwars-exclusive.vercel.app/

Supported document types (fixed set, `lib/documentTypes/config.ts`): rental
lease, freelance/client contract, terms & privacy policy, non-disclosure
agreement, employment offer letter.

## Architecture

```
Client (Next.js App Router, Tailwind)
  → /api/upload     extract text (unpdf / mammoth) → segmentClauses → detectType
  → /api/classify   batched Gemini classification over stored clauses
  → /api/ask        embed question + clauses → top-k cosine → grounded answer
  → /api/compare    same-type guard → category + embedding alignment → diff
  → /api/checklist  one call over classified clauses → red flags + lawyer questions
  → lib/store       in-memory session store (no persistence, MVP)
```

### Why the deterministic/LLM split exists

Clause segmentation (`lib/parser/segmentClauses.ts`) is a pure function with
no LLM call in it. The model never decides where a clause starts or ends —
it only classifies and explains clauses the parser already found. That makes
the pipeline auditable: every clause id in an answer or risk flag maps to a
deterministic slice of the uploaded text, and the parser is unit-testable
against real templates without an API key.

### Why type confirmation is a user step

The confirmed document type picks the category taxonomy classification runs
with. A wrong auto-detected type would silently mislabel every clause, so the
suggestion (with confidence) is shown for confirmation or override first
(`components/TypeConfirmBanner.tsx`), and `/api/classify` requires the
confirmed type.

### Grounding rules (all LLM output)

- Explanations and answers must be based on the clause text passed to the
  model; prompts forbid general legal knowledge.
- Q&A answers carry `citedClauseIds`, filtered server-side to excerpts the
  model actually saw.
- If the question isn't addressed by the document (best retrieval similarity
  below threshold), `/api/ask` skips the generation call entirely and returns
  `grounded: false` with a professional-referral message.
- A "not legal advice" disclaimer renders on every screen with AI content.

### Gemini layer

Shared client (`lib/gemini/client.ts`): model chain
(gemini-3.8-flash → 3.7 → 3.6, pin one with `GEMINI_MODEL`), backoff retry on
transient 429/5xx, fatal short-circuit on 400/401/403, and user-facing error
wording that distinguishes quota exhaustion (429) from demand spikes (503).
Embeddings use a separate chain (gemini-embedding-001 → text-embedding-004,
pin with `GEMINI_EMBED_MODEL`).

## Development

```bash
npm install
npm run dev        # local dev
npx vitest run     # unit + API route tests (fetch mocked; no key needed)
npm run build      # production build
```

Environment: `GEMINI_API_KEY` (server-side, required for classify/ask),
`NEXT_PUBLIC_APP_NAME` (display name). On Vercel these live in the project
dashboard. Note: Vercel bundles all route handlers into one function that
owns the in-memory store — do not add per-route function config, it splits
the store and uploads 404.

## Known limitations

- **In-memory store**: serverless cold starts or instance changes between
  upload and classify lose the document; the UI says "document expired" and
  offers re-upload. Firestore is the documented stretch fix.
- **Scans rejected**: image-only PDFs return 422 (no OCR).
- **Parser heuristics**: numbered markers, ALL-CAPS headings, paragraph
  breaks, plus a merge/split post-pass (fragments <40 chars merged, blobs
  >3000 chars split on line boundaries). Exotic layouts (inline numbering,
  multi-column) can still segment imperfectly.
- **Not legal advice**: the tool flags and explains; it certifies nothing
  about jurisdiction-specific compliance.

## Testing

107 tests cover the parser (synthetic + two real public deed templates),
type detection, classification, grounded Q&A, comparison, checklist, the
Gemini retry/fallback behavior, and all API route contracts including error
paths. The two real templates (`tests/fixtures/real-lease-*.txt`) are
publicly available deed formats from SBI and the Haryana jamabandi portal;
other fixtures are clearly-labeled synthetic text written for the tests.
