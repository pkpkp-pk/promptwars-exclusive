"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ClauseCard from "./ClauseCard";
import ChatPanel from "./ChatPanel";
import Disclaimer from "./Disclaimer";
import TypeConfirmBanner from "./TypeConfirmBanner";
import type { ChecklistResult, Clause, DocumentType, RiskLevel } from "@/lib/types";
import { TYPE_LABELS } from "@/lib/documentTypes/config";

/*
 * Review screen container (Phase 4). The clause text comes from the
 * deterministic parser; the category/risk/explanation data comes from
 * POST /api/classify. On Vercel the API routes are bundled into one function
 * that owns the document store, while this page may render elsewhere — so
 * the page passes stored clauses as an optional fast path, and this
 * component always drives classification itself, with a session cache so a
 * refresh doesn't re-pay the Gemini call.
 *
 * Classification waits for the user to confirm a document type
 * (AGENTS2.md §2 constraint 4): the confirmed type picks the category
 * taxonomy, so it is part of the classify request AND the cache key — a
 * cached run from a different type can never leak its labels into this one.
 *
 * The Q&A panel (Phase 5) will slot in below the clause list.
 */

const GENERIC_ERROR =
  "Something went wrong while analyzing your document. Please try again.";

const CACHE_KEY = (docId: string, type: DocumentType) =>
  `plainlease:doc:${docId}:${type}`;
const NAME_KEY = (docId: string) => `plainlease:name:${docId}`;
const TYPE_KEY = (docId: string) => `plainlease:type:${docId}`;

const BAR_CLASSES: Record<RiskLevel, string> = {
  standard: "bg-standard",
  unusual: "bg-unusual",
  risky: "bg-risky",
};

type Status = "confirming" | "classifying" | "ready" | "error" | "missing";

const DOCUMENT_TYPES = Object.keys(TYPE_LABELS) as DocumentType[];

function isDocumentType(value: unknown): value is DocumentType {
  return (
    typeof value === "string" && DOCUMENT_TYPES.includes(value as DocumentType)
  );
}

function allClassified(clauses: Clause[]): boolean {
  return clauses.length > 0 && clauses.every((clause) => clause.riskLevel !== undefined);
}

function readCache(docId: string, type: DocumentType): Clause[] | null {
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY(docId, type));
    if (!raw) return null;
    const clauses = JSON.parse(raw) as Clause[];
    return Array.isArray(clauses) && clauses.length > 0 ? clauses : null;
  } catch {
    return null;
  }
}

function writeCache(docId: string, type: DocumentType, clauses: Clause[]): void {
  try {
    window.sessionStorage.setItem(CACHE_KEY(docId, type), JSON.stringify(clauses));
  } catch {
    // Storage unavailable (private mode, quota) — caching is optional.
  }
}

function RiskSummary({ clauses }: { clauses: Clause[] }) {
  const counts: Record<RiskLevel | "unreviewed", number> = {
    standard: 0,
    unusual: 0,
    risky: 0,
    unreviewed: 0,
  };
  for (const clause of clauses) {
    if (clause.riskLevel) counts[clause.riskLevel] += 1;
    else counts.unreviewed += 1;
  }

  const parts: string[] = [];
  if (counts.risky) parts.push(`${counts.risky} risky`);
  if (counts.unusual) parts.push(`${counts.unusual} unusual`);
  if (counts.standard) parts.push(`${counts.standard} standard`);
  if (counts.unreviewed) parts.push(`${counts.unreviewed} not yet reviewed`);

  return (
    <div className="rounded-lg border border-rule bg-card p-4">
      <div className="flex flex-wrap gap-1">
        {clauses.map((clause) => {
          const riskLabel = clause.riskLevel ?? "not yet reviewed";
          return (
            <a
              key={clause.id}
              href={`#clause-${clause.id}`}
              title={`Clause ${clause.order + 1} · ${riskLabel}`}
              aria-label={`Clause ${clause.order + 1}, ${riskLabel}`}
              className={`h-2 w-6 rounded-full transition-opacity hover:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
                clause.riskLevel ? BAR_CLASSES[clause.riskLevel] : "bg-rule"
              }`}
            />
          );
        })}
      </div>
      <p className="mt-3 text-sm text-ink-muted">{parts.join(" · ")}</p>
    </div>
  );
}

function readFilename(docId: string): string | undefined {
  try {
    return window.sessionStorage.getItem(NAME_KEY(docId)) ?? undefined;
  } catch {
    return undefined;
  }
}

interface TypeSuggestion {
  type: DocumentType;
  confidence?: number;
}

function readStoredType(docId: string): TypeSuggestion | null {
  try {
    const raw = window.sessionStorage.getItem(TYPE_KEY(docId));
    if (!raw) return null;
    // sessionStorage holds whatever was last written — validate before it
    // reaches the banner, or a stale/foreign entry gets shown as a suggestion.
    const parsed = JSON.parse(raw) as { type?: unknown; confidence?: unknown };
    if (!isDocumentType(parsed.type)) return null;
    return {
      type: parsed.type,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : undefined,
    };
  } catch {
    return null;
  }
}

export default function ReviewDocument({
  docId,
  filename,
  initialClauses,
  suggestedType,
  suggestedTypeConfidence,
  confirmedType: previouslyConfirmed,
}: {
  docId: string;
  filename?: string;
  initialClauses?: Clause[];
  /** Upload-time suggestion, when the store-owning instance still has the document. */
  suggestedType?: DocumentType;
  suggestedTypeConfidence?: number;
  /** Set when this instance's store already recorded a user confirmation. */
  confirmedType?: DocumentType;
}) {
  const [displayName, setDisplayName] = useState(filename);
  const [clauses, setClauses] = useState<Clause[] | undefined>(initialClauses);
  const [status, setStatus] = useState<Status>("confirming");
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [confirmedType, setConfirmedType] = useState<DocumentType | undefined>(undefined);
  const [checklist, setChecklist] = useState<ChecklistResult | null>(null);
  const [checklistBusy, setChecklistBusy] = useState(false);
  const [checklistError, setChecklistError] = useState<string | null>(null);
  // Props are stable for a server-rendered page, so seeding from them keeps
  // the server and client markup identical before the sessionStorage check.
  const [suggestion, setSuggestion] = useState<TypeSuggestion | undefined>(
    suggestedType
      ? { type: suggestedType, confidence: suggestedTypeConfidence }
      : undefined,
  );
  const startedRef = useRef(false);

  const classify = useCallback(
    async (type: DocumentType) => {
      setStatus("classifying");
      setError(null);
      try {
        const response = await fetch("/api/classify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ docId, confirmedType: type }),
        });
        if (response.status === 404) {
          setStatus("missing");
          return;
        }
        if (!response.ok) {
          let message = GENERIC_ERROR;
          try {
            const body = (await response.json()) as { error?: string };
            if (body.error) message = body.error;
          } catch {
            // Not a JSON error body — keep the generic message.
          }
          throw new Error(message);
        }
        const body = (await response.json()) as { clauses: Clause[] };
        setClauses(body.clauses);
        setStatus("ready");
        if (allClassified(body.clauses)) writeCache(docId, type, body.clauses);
      } catch (error) {
        setStatus("error");
        setError(error instanceof Error && error.message ? error.message : GENERIC_ERROR);
      }
    },
    [docId],
  );

  // The one gate into classification: the type is confirmed by the user,
  // never assumed (AGENTS2.md §2 constraint 4).
  const handleConfirm = useCallback(
    (type: DocumentType) => {
      setConfirmedType(type);
      const cached = readCache(docId, type);
      if (cached) {
        // Same document, same type, same session — reuse the earlier run
        // instead of re-paying the Gemini call.
        setClauses(cached);
        setStatus("ready");
        return;
      }
      void classify(type);
    },
    [docId, classify],
  );

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    // Post-hydration only, so the server and client renders stay identical.
    // The body is async so the state updates land after mount rather than
    // synchronously inside the effect (react-hooks/set-state-in-effect).
    void (async () => {
      if (!displayName) {
        const stored = readFilename(docId);
        if (stored) setDisplayName(stored);
      }

      if (!suggestion) {
        // The server store is authoritative when it still has the document;
        // sessionStorage carries the suggestion across renders where this
        // page ran in a different instance than the store-owning one.
        const stored = readStoredType(docId);
        if (stored) setSuggestion(stored);
      }

      // Fast path: this instance already classified the document under a
      // confirmed type (an earlier visit in the same session) — show those
      // results instead of re-asking. The recorded type is required, not
      // just the classified clauses: without it the category labels would
      // be translated through a guessed taxonomy.
      if (previouslyConfirmed && clauses && allClassified(clauses)) {
        setConfirmedType(previouslyConfirmed);
        setStatus("ready");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 7: one call over the already-classified clauses — the route 409s
  // if classification hasn't run, so the button only appears on "ready".
  const loadChecklist = async () => {
    setChecklistBusy(true);
    setChecklistError(null);
    try {
      const response = await fetch("/api/checklist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ docId }),
      });
      const body = (await response.json()) as ChecklistResult & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Checklist failed.");
      setChecklist(body);
    } catch (err) {
      setChecklistError(err instanceof Error ? err.message : "Checklist failed.");
    } finally {
      setChecklistBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-serif text-3xl font-medium leading-tight tracking-tight">
          {displayName ?? "Your document"}
        </h1>
        <p className="mt-2 text-ink-muted">
          {clauses
            ? `${clauses.length} ${clauses.length === 1 ? "clause" : "clauses"} found in your document`
            : "Reading your document…"}
        </p>
      </header>

      <Disclaimer />

      <TypeConfirmBanner
        suggestedType={suggestion?.type}
        suggestedTypeConfidence={suggestion?.confidence}
        initialSelected={previouslyConfirmed ?? suggestion?.type}
        confirmedType={confirmedType}
        onConfirm={handleConfirm}
        disabled={status === "classifying"}
      />

      {status === "classifying" ? (
        <p className="flex items-center gap-2.5 text-ink-muted">
          <span className="h-2 w-2 rounded-full bg-ink-muted motion-safe:animate-pulse" />
          Reading your document and flagging risks…
        </p>
      ) : null}

      {status === "error" ? (
        <div className="rounded-lg border border-risky/30 bg-card p-5">
          <p className="text-risky">{error}</p>
          <button
            type="button"
            onClick={() => confirmedType && void classify(confirmedType)}
            className="mt-4 rounded-md bg-ink px-4 py-2 font-medium text-paper transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            Try again
          </button>
        </div>
      ) : null}

      {status === "missing" ? (
        <div className="rounded-lg border border-rule bg-card p-5">
          <p className="text-ink">
            We couldn’t find that document. It may have expired — nothing is
            stored long-term.
          </p>
          <Link
            href="/"
            className="mt-4 inline-block rounded-md bg-ink px-4 py-2 font-medium text-paper transition-opacity hover:opacity-85"
          >
            Upload your document again
          </Link>
        </div>
      ) : null}

      {clauses && clauses.length > 0 && status !== "missing" ? (
        <>
          <RiskSummary clauses={clauses} />
          {status === "ready" ? (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void loadChecklist()}
                disabled={checklistBusy}
                className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper transition-opacity hover:opacity-85 disabled:opacity-50"
              >
                {checklistBusy ? "Building checklist…" : checklist ? "Refresh checklist" : "Get pre-signing checklist"}
              </button>
              <Link
                href={`/compare?a=${docId}`}
                className="rounded-md border border-rule px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-card"
              >
                Compare with another document
              </Link>
            </div>
          ) : null}
          {checklistError ? (
            <p role="alert" className="text-sm text-risky">{checklistError}</p>
          ) : null}
          {checklist ? (
            <section aria-label="Pre-signing checklist" className="flex flex-col gap-4 rounded-2xl border border-rule bg-card p-5">
              <div>
                <h2 className="font-serif text-xl font-medium text-ink">Red flags</h2>
                {checklist.redFlags.length === 0 ? (
                  <p className="mt-1 text-sm text-ink-muted">No unusual or risky clauses found.</p>
                ) : (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink">
                    {checklist.redFlags.map((flag, index) => (
                      <li key={index}>{flag}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h2 className="font-serif text-xl font-medium text-ink">Questions for a lawyer</h2>
                {checklist.questionsForLawyer.length === 0 ? (
                  <p className="mt-1 text-sm text-ink-muted">Nothing ambiguous enough to need one.</p>
                ) : (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink">
                    {checklist.questionsForLawyer.map((question, index) => (
                      <li key={index}>{question}</li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          ) : null}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setCollapsed((value) => !value)}
              aria-expanded={!collapsed}
              className="rounded-md px-2 py-1 text-sm text-ink-muted underline underline-offset-2 transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              {collapsed ? "Expand all" : "Collapse all"}
            </button>
          </div>
          <div className="flex flex-col gap-4">
            {clauses.map((clause) => (
              <ClauseCard
                key={clause.id}
                clause={clause}
                confirmedType={confirmedType}
                collapsed={collapsed}
              />
            ))}
          </div>
          {/* Phase 5 Q&A — only once classification succeeded, so the clause
              list the answers cite is on screen. */}
          {status === "ready" ? <ChatPanel docId={docId} clauses={clauses} /> : null}
        </>
      ) : null}
    </div>
  );
}
