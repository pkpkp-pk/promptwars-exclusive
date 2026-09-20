"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ClauseCard from "./ClauseCard";
import Disclaimer from "./Disclaimer";
import type { Clause, RiskLevel } from "@/lib/types";

/*
 * Review screen container (Phase 4). The clause text comes from the
 * deterministic parser; the category/risk/explanation data comes from
 * POST /api/classify. On Vercel the API routes are bundled into one function
 * that owns the document store, while this page may render elsewhere — so
 * the page passes stored clauses as an optional fast path, and this
 * component always drives classification itself, with a session cache so a
 * refresh doesn't re-pay the Gemini call.
 *
 * The Q&A panel (Phase 5) will slot in below the clause list.
 */

const GENERIC_ERROR =
  "Something went wrong while analyzing your lease. Please try again.";

const CACHE_KEY = (docId: string) => `plainlease:doc:${docId}`;
const NAME_KEY = (docId: string) => `plainlease:name:${docId}`;

const BAR_CLASSES: Record<RiskLevel, string> = {
  standard: "bg-standard",
  unusual: "bg-unusual",
  risky: "bg-risky",
};

type Status = "classifying" | "ready" | "error" | "missing";

function allClassified(clauses: Clause[]): boolean {
  return clauses.length > 0 && clauses.every((clause) => clause.riskLevel !== undefined);
}

function readCache(docId: string): Clause[] | null {
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY(docId));
    if (!raw) return null;
    const clauses = JSON.parse(raw) as Clause[];
    return Array.isArray(clauses) && clauses.length > 0 ? clauses : null;
  } catch {
    return null;
  }
}

function writeCache(docId: string, clauses: Clause[]): void {
  try {
    window.sessionStorage.setItem(CACHE_KEY(docId), JSON.stringify(clauses));
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
      <div className="flex flex-wrap gap-1" aria-hidden="true">
        {clauses.map((clause) => (
          <span
            key={clause.id}
            className={`h-2 w-6 rounded-full ${
              clause.riskLevel ? BAR_CLASSES[clause.riskLevel] : "bg-rule"
            }`}
          />
        ))}
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

export default function ReviewDocument({
  docId,
  filename,
  initialClauses,
}: {
  docId: string;
  filename?: string;
  initialClauses?: Clause[];
}) {
  const [displayName, setDisplayName] = useState(filename);
  const [clauses, setClauses] = useState<Clause[] | undefined>(initialClauses);
  const [status, setStatus] = useState<Status>("classifying");
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const classify = useCallback(async () => {
    setStatus("classifying");
    setError(null);
    try {
      const response = await fetch("/api/classify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ docId }),
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
      if (allClassified(body.clauses)) writeCache(docId, body.clauses);
    } catch (error) {
      setStatus("error");
      setError(error instanceof Error && error.message ? error.message : GENERIC_ERROR);
    }
  }, [docId]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    // Post-hydration only, so the server and client renders stay identical.
    if (!displayName) {
      const stored = readFilename(docId);
      if (stored) setDisplayName(stored);
    }

    if (clauses && allClassified(clauses)) {
      setStatus("ready"); // already classified (server state)
      return;
    }
    const cached = readCache(docId);
    if (cached) {
      setClauses(cached);
      setStatus("ready");
      return;
    }
    void classify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-serif text-3xl font-medium leading-tight tracking-tight">
          {displayName ?? "Your lease"}
        </h1>
        <p className="mt-2 text-ink-muted">
          {clauses
            ? `${clauses.length} ${clauses.length === 1 ? "clause" : "clauses"} found in your document`
            : "Reading your document…"}
        </p>
      </header>

      <Disclaimer />

      {status === "classifying" ? (
        <p className="flex items-center gap-2.5 text-ink-muted">
          <span className="h-2 w-2 rounded-full bg-ink-muted motion-safe:animate-pulse" />
          Reading your lease and flagging risks…
        </p>
      ) : null}

      {status === "error" ? (
        <div className="rounded-lg border border-risky/30 bg-card p-5">
          <p className="text-risky">{error}</p>
          <button
            type="button"
            onClick={() => void classify()}
            className="mt-4 rounded-md bg-ink px-4 py-2 font-medium text-paper transition-opacity hover:opacity-85"
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
            Upload your lease again
          </Link>
        </div>
      ) : null}

      {clauses && clauses.length > 0 && status !== "missing" ? (
        <>
          <RiskSummary clauses={clauses} />
          <div className="flex flex-col gap-4">
            {clauses.map((clause) => (
              <ClauseCard key={clause.id} clause={clause} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
