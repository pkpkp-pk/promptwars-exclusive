# AGENTS.md — Legal Document Copilot build spec

This file is the build brief for an AI coding agent (Claude Code, Cursor, etc.)
working in this repository. Read it in full before writing any code. Build the
phases in order — each phase has acceptance criteria; do not start the next
phase until the current one's criteria are met. If a phase's acceptance
criteria can't be verified (e.g. no test runner configured yet), set that up
first rather than skipping ahead.

## 1. What this is

A GenAI-powered assistant that helps someone understand, question, and
compare a legal document before signing or agreeing to it. Built for a
hackathon themed on making legal information and basic legal assistance more
accessible.

**Scope (locked, do not widen further without updating this file):** a
curated set of five document types, not open-ended "any legal document":

| Document type | Who's reading it |
|---|---|
| `lease` | A tenant reviewing a rental agreement |
| `freelance_contract` | A freelancer/gig worker reviewing a client contract |
| `tos_privacy_policy` | A consumer reviewing an app or service's terms |
| `nda` | Someone asked to sign a non-disclosure agreement |
| `employment_offer` | A candidate reviewing a job offer letter |

Each type has its own clause-category taxonomy (Section 6) so risk flagging
and checklists stay consistent and testable per type, instead of relying on
the model to invent categories on the fly. Depth-per-type beats a fully
generic system that can't reliably color-code its own output.

**Official use cases this must satisfy**, and the feature that satisfies each:

| Brief's use case | Feature |
|---|---|
| Simplifying complex legal documents | Phase 3 — plain-language clause explanations |
| Highlighting clauses/obligations/risks/inconsistencies | Phase 3 — per-clause risk classification |
| Answering questions based on provided legal documents | Phase 5 — grounded Q&A |
| Comparing contracts, agreements, or policies | Phase 6 — comparison mode (same type only) |
| Helping users understand options and next steps | Phase 7 — checklist output |
| Generating summaries, checklists, or actionable outputs | Phase 7 — checklist output |
| Helping users prep questions for a legal professional | Phase 7 — "questions for a lawyer" list |

## 2. Non-negotiable constraints

These override convenience or speed at every phase:

1. **Every LLM-generated explanation, risk flag, or answer must cite the
   specific clause it is based on.** Never let the model answer from its own
   general knowledge instead of the text actually in front of it.
2. **If a question isn't addressed by the document, say so explicitly** and
   suggest the user consult a professional. Never let the model guess.
3. **Clause segmentation must be a deterministic, pure function with no LLM
   call in it**, and must work the same regardless of document type. The LLM
   only classifies and explains clauses the deterministic layer already
   found — it never decides where a clause starts or ends.
4. **Document type is detected but always shown to the user as a
   confirmable suggestion, never applied silently.** A wrong auto-detected
   type changes which category taxonomy gets used downstream, so a
   misdetection must be easy to catch and fix before classification runs.
5. **A disclaimer — "this tool provides information, not legal advice" —
   must be visible on every screen that shows AI-generated content**, not
   just once on the landing page.
6. Do not fabricate sample legal text for demos. Use publicly available
   templates for each of the five types, or clearly-labeled synthetic
   examples the agent writes itself and marks as synthetic.

## 3. Tech stack

- Next.js (App Router) + TypeScript + Tailwind CSS
- Gemini API for type detection, classification, explanation, comparison,
  and Q&A
- Deployment target: Vercel
- Testing: Vitest (or Jest if already present) for unit tests
- Persistence: in-memory/session state for MVP. Add Firestore only if there's
  time left after Phase 5 — it is not required for the core demo.

If any of these conflict with what's already in this repo (an existing
framework, an existing test runner), follow what's already there and note the
deviation at the top of your first commit message.

## 4. Architecture

```
Client (Next.js)
  -> API routes
      -> Deterministic parser (pure functions, no LLM, type-agnostic)
          -> feeds clause text + confirmed document type to
      -> Gemini API (detect type / classify / explain / answer / compare)
  -> both write to
      -> Document store (session state, or Firestore if added)
  -> results (risk scores, answers, citations) flow back to the client
```

The deterministic parser and the Gemini layer are separate modules with no
shared mutable state. The parser's output — plus the user-confirmed document
type — is the *only* thing the Gemini layer reasons about for a given
document. This boundary is what prevents hallucination and is the main thing
a judge or reviewer should be able to verify by reading the code.

## 5. Repository structure

```
/app
  page.tsx                    — landing page + upload dropzone
  /review/[docId]/page.tsx    — clause list, risk heatmap, Q&A panel
  /compare/page.tsx           — two-document comparison view (same type only)
  /api
    /upload/route.ts          — extract text, segment, suggest doc type
    /classify/route.ts
    /ask/route.ts
    /compare/route.ts
    /checklist/route.ts
/lib
  /parser
    segmentClauses.ts          — pure function, no external calls
    segmentClauses.test.ts
  /documentTypes
    config.ts                  — type -> category taxonomy map (Section 6)
    detectType.ts               — one Gemini call, returns suggestion + confidence
  /gemini
    classifyClauses.ts
    answerQuestion.ts
    compareClauses.ts
    generateChecklist.ts
  /embeddings
    embed.ts
    similarity.ts               — cosine similarity, in-memory, no vector DB
  /types
    index.ts
/components
  UploadDropzone.tsx
  TypeConfirmBanner.tsx        — shows suggested type + override dropdown
  ClauseCard.tsx
  RiskBadge.tsx
  ChatPanel.tsx
  ComparisonView.tsx
  Disclaimer.tsx
/tests
  fixtures/                     — sample documents per type for parser tests
```

## 6. Data models

```ts
type DocumentType =
  | 'lease' | 'freelance_contract' | 'tos_privacy_policy'
  | 'nda' | 'employment_offer';

// Section 6a — per-type category taxonomies, lives in /lib/documentTypes/config.ts
const CATEGORY_MAP: Record<DocumentType, string[]> = {
  lease: ['rent', 'deposit', 'termination', 'maintenance', 'utilities', 'renewal', 'subletting', 'other'],
  freelance_contract: ['payment_terms', 'ip_ownership', 'termination', 'confidentiality', 'deliverables', 'liability', 'other'],
  tos_privacy_policy: ['data_collection', 'data_sharing', 'user_rights', 'account_termination', 'liability', 'dispute_resolution', 'other'],
  nda: ['confidential_info_definition', 'obligations', 'duration', 'exceptions', 'remedies', 'other'],
  employment_offer: ['compensation', 'notice_period', 'non_compete', 'benefits', 'termination', 'ip_assignment', 'other'],
};

interface Document {
  id: string;
  filename: string;
  rawText: string;
  uploadedAt: string;
  suggestedType: DocumentType;
  suggestedTypeConfidence: number; // 0-1
  confirmedType?: DocumentType;     // set once the user confirms/overrides
}

type RiskLevel = 'standard' | 'unusual' | 'risky';

interface Clause {
  id: string;
  docId: string;
  text: string;
  order: number;
  category?: string;    // must be one of CATEGORY_MAP[confirmedType]
  riskLevel?: RiskLevel;
  explanation?: string;
}

interface QAExchange {
  question: string;
  answer: string;
  citedClauseIds: string[];
  grounded: boolean; // false when the question wasn't answerable from the doc
}

interface ClauseDiff {
  category: string;
  docAText?: string;
  docBText?: string;
  materialDifference: string;
  favors: 'A' | 'B' | 'neutral';
}

interface ChecklistResult {
  redFlags: string[];
  questionsForLawyer: string[];
}
```

## 7. API contracts

### `POST /api/upload`
- Request: `multipart/form-data`, field `file` (PDF or DOCX)
- Response: `{ docId: string, clauseCount: number, suggestedType: DocumentType, suggestedTypeConfidence: number }`
- Errors: `400` unsupported file type, `413` file too large (set a real limit,
  e.g. 10 MB)
- Internally: extract raw text, call `segmentClauses` (type-agnostic), call
  `detectType`, store `Document` + `Clause[]`. Type is *suggested*, not
  confirmed — the client must show it and let the user confirm/override
  before calling `/api/classify`.

### `POST /api/classify`
- Request: `{ docId: string, confirmedType: DocumentType }`
- Response: `{ clauses: Clause[] }` — each clause now has `category`
  (constrained to `CATEGORY_MAP[confirmedType]`), `riskLevel`, `explanation`
- Batch the Gemini call (one request covering all clauses, or chunked
  batches), not one request per clause.

### `POST /api/ask`
- Request: `{ docId: string, question: string }`
- Response: `QAExchange`
- Retrieval: embed the question, retrieve top-k clauses by cosine similarity,
  pass only those to Gemini as context. If similarity is below a threshold
  you define, skip the Gemini call and return `grounded: false` with a
  static "not addressed in this document" message.

### `POST /api/compare`
- Request: `{ docAId: string, docBId: string }`
- Response: `{ diffs: ClauseDiff[] }`
- **Validation: reject with `409` if `docA.confirmedType !== docB.confirmedType`.**
  Comparison only makes sense within a type.
- Align clauses across documents by category + embedding similarity before
  asking Gemini to explain the difference for each aligned pair.

### `POST /api/checklist`
- Request: `{ docId: string }`
- Response: `ChecklistResult`
- Derived from already-classified clauses (risky/unusual ones become red
  flags; ambiguous ones become lawyer questions) — one Gemini call over the
  classified clause list, not a fresh document read.

## 8. Build phases and acceptance criteria

- [ ] **Phase 0 — Scaffold.** Next.js + Tailwind app, deployed to Vercel,
  landing page with an upload dropzone. *Acceptance: a live URL loads and
  shows the dropzone.*
- [ ] **Phase 1 — Ingestion + type detection.** `/api/upload` extracts text
  from a real PDF/DOCX and returns a suggested type. *Acceptance: uploading
  one sample of each of the five types returns the correct type at least 4/5
  times; the UI shows the suggestion with an override dropdown before
  proceeding.*
- [ ] **Phase 2 — Deterministic segmentation.** `segmentClauses(rawText):
  Clause[]`. *Acceptance: unit tests pass against samples from at least 3 of
  the 5 types, plus one with no clear numbering at all, and the function has
  zero external calls and zero knowledge of document type.*
- [ ] **Phase 3 — Classification.** `/api/classify` returns category, risk
  level, and explanation per clause, using the confirmed type's taxonomy.
  *Acceptance: for each of the 5 types, every returned category is a valid
  member of that type's `CATEGORY_MAP` entry, and explanations are spot-
  checked against source clause text.*
- [ ] **Phase 4 — Review UI.** Clause list with color-coded risk badges and
  plain-language text. *Acceptance: works identically across all 5 types
  with no type-specific UI code beyond the category labels.*
- [ ] **Phase 5 — Grounded Q&A.** `/api/ask` end to end. *Acceptance: an
  in-document question returns a correct, cited answer; an out-of-scope
  question returns `grounded: false` and a professional-referral message.*
- [ ] **Phase 6 (stretch) — Comparison mode.** `/api/compare` + UI, same-type
  only. *Acceptance: comparing two same-type documents produces a diff list
  a human agrees is materially accurate; comparing two different types
  returns a clear error, not a nonsense diff.*
- [ ] **Phase 7 (stretch) — Checklist output.** `/api/checklist` + export.
  *Acceptance: red flags and lawyer questions are traceable to specific
  classified clauses, not generic boilerplate.*
- [ ] **Phase 8 — Polish.** Disclaimer visible on every AI-content screen,
  Phase 2 tests green across multiple types, README written (architecture,
  why the deterministic/LLM split and the type-confirmation step exist,
  known limitations).

## 9. Prompt guidelines

**Type detection prompt** must instruct the model to:
- Choose exactly one of the 5 supported types, or a `none_of_these` value if
  it genuinely doesn't match — never force-fit an unrelated document
- Return a confidence score alongside the choice

**Classification prompt** must instruct the model to:
- Return structured JSON only (category, riskLevel, explanation per clause)
- Choose `category` only from the confirmed type's taxonomy — never invent
  a new category name
- Base `explanation` strictly on the clause text provided, not general
  knowledge of that document type

**Q&A prompt** must instruct the model to:
- Answer only from the retrieved clause excerpts passed in context
- Explicitly say when retrieved context doesn't cover the question
- Always name which clause(s) the answer draws from

**Comparison prompt** must instruct the model to:
- Focus on material differences (obligations, amounts, deadlines, rights),
  not wording/style differences
- State which document is more favorable to the user for each difference,
  or "neutral" if genuinely equivalent

## 10. Testing requirements

- `segmentClauses`: unit tests covering numbered clauses, header-based
  clauses, and an unstructured fallback case, across at least 3 document
  types
- `detectType`: test against one clean sample per type plus one deliberately
  ambiguous document
- API route tests: valid/invalid file types, missing fields, oversized
  uploads, mismatched-type comparison requests
- A manual grounding checklist before demo day: run 5 real questions per
  type against a real document and confirm every answer cites a real clause

## 11. Environment variables

```
GEMINI_API_KEY=
NEXT_PUBLIC_APP_NAME=
# Optional, only if Firestore is added:
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
```

## 12. Definition of done (submission checklist)

- [ ] Live deployed link works with no setup required by the judge
- [ ] Upload -> type suggestion/confirm -> simplify -> risk-flag -> Q&A works
  end to end, demoed on at least 2 of the 5 supported types
- [ ] Disclaimer visible throughout, not just on landing
- [ ] README explains the architecture, the deterministic/LLM split, and why
  type confirmation is a user step rather than fully automatic
- [ ] At least the Phase 2 parser and Phase 1 type detection have passing
  automated tests

## 13. Explicitly out of scope for this build

- Document types beyond the 5 listed in Section 1
- Multi-document batch processing
- User accounts / authentication
- Jurisdiction-specific legal correctness guarantees — the tool flags and
  explains, it does not certify compliance with any specific law
