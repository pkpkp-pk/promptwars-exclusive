"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CloudUpload } from "lucide-react";
import ComparisonView from "@/components/ComparisonView";
import Disclaimer from "@/components/Disclaimer";
import TypeConfirmBanner from "@/components/TypeConfirmBanner";
import type { Clause, ClauseDiff, DocumentType } from "@/lib/types";

/*
 * /compare?a=<docId> — Phase 6. Reached from a reviewed document ("Compare
 * with another document"). Flow: upload document B here, confirm B's type
 * (constraint 4 — never assumed, even when A's type is known), classify B,
 * then POST /api/compare and render the diff list. A cross-type confirmation
 * surfaces the route's 409 verbatim rather than producing a nonsense diff.
 */

type Stage =
  | "pick" // waiting for the second file
  | "confirm" // B uploaded — user confirms its type
  | "working" // classify B, then compare
  | "ready"
  | "error";

export default function ComparePage() {
  // useSearchParams must sit under a Suspense boundary for static generation.
  return (
    <Suspense>
      <ComparePageInner />
    </Suspense>
  );
}

function ComparePageInner() {
  const params = useSearchParams();
  const docAId = params.get("a") ?? "";
  const nameA = readName(docAId);

  const [stage, setStage] = useState<Stage>("pick");
  const [error, setError] = useState<string | null>(null);
  const [docB, setDocB] = useState<{
    id: string;
    name: string;
    suggestedType?: DocumentType;
    suggestedTypeConfidence?: number;
  } | null>(null);
  const [diffs, setDiffs] = useState<ClauseDiff[] | null>(null);

  const uploadB = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setStage("working");
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/upload", { method: "POST", body });
      const data = (await response.json()) as {
        docId?: string;
        suggestedType?: DocumentType;
        suggestedTypeConfidence?: number;
        error?: string;
      };
      if (!response.ok || !data.docId) throw new Error(data.error ?? "Upload failed.");
      try {
        window.sessionStorage.setItem(`plainlease:name:${data.docId}`, file.name);
      } catch {
        // Storage unavailable — cosmetic only.
      }
      setDocB({
        id: data.docId,
        name: file.name,
        suggestedType: data.suggestedType,
        suggestedTypeConfidence: data.suggestedTypeConfidence,
      });
      setStage("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setStage("pick");
    }
  };

  const confirmAndCompare = async (type: DocumentType) => {
    if (!docB) return;
    setError(null);
    setStage("working");
    try {
      const classify = await fetch("/api/classify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ docId: docB.id, confirmedType: type }),
      });
      const classifyBody = (await classify.json()) as { clauses?: Clause[]; error?: string };
      if (!classify.ok) {
        throw new Error(classifyBody.error ?? "Analysis of the second document failed.");
      }

      const compare = await fetch("/api/compare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ docAId, docBId: docB.id }),
      });
      const body = (await compare.json()) as { diffs?: ClauseDiff[]; error?: string };
      if (!compare.ok || !body.diffs) throw new Error(body.error ?? "Comparison failed.");
      setDiffs(body.diffs);
      setStage("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Comparison failed.");
      setStage(docB ? "confirm" : "pick");
    }
  };

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <Link href={docAId ? `/review/${docAId}` : "/"} className="text-sm text-ink-muted underline underline-offset-2 hover:text-ink">
        ← Back to review
      </Link>

      <header className="mt-8">
        <h1 className="font-serif text-3xl font-medium leading-tight tracking-tight">
          Compare two documents
        </h1>
        <p className="mt-2 text-ink-muted">
          First document: <strong className="text-ink">{nameA}</strong>. Upload the
          second one below — comparison works within one document type.
        </p>
      </header>

      <div className="mt-6">
        <Disclaimer />
      </div>

      {stage === "pick" || stage === "working" || error ? (
        <label className="mt-6 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 px-6 py-12 text-center transition-colors hover:border-brand-300 hover:bg-brand-50">
          <input
            type="file"
            accept=".pdf,.docx"
            className="sr-only"
            onChange={(event) => void uploadB(event.target.files?.[0])}
          />
          <CloudUpload className="h-8 w-8 text-slate-400" aria-hidden />
          <span className="font-serif text-xl font-medium text-slate-900">
            {stage === "working" && !error ? "Reading second document…" : "Upload the second document"}
          </span>
          <span className="text-sm text-slate-500">PDF or DOCX, max 10 MB</span>
        </label>
      ) : null}

      {stage === "confirm" && docB ? (
        <div className="mt-6 flex flex-col gap-3">
          <p className="text-sm text-ink-muted">
            Second document: <strong className="text-ink">{docB.name}</strong>
          </p>
          <TypeConfirmBanner
            suggestedType={docB.suggestedType}
            suggestedTypeConfidence={docB.suggestedTypeConfidence}
            initialSelected={docB.suggestedType}
            onConfirm={(type) => void confirmAndCompare(type)}
          />
        </div>
      ) : null}

      {stage === "working" && docB ? (
        <p className="mt-6 flex items-center gap-2.5 text-ink-muted">
          <span className="h-2 w-2 rounded-full bg-ink-muted motion-safe:animate-pulse" />
          Analyzing and comparing…
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-6 rounded-lg border border-risky/30 bg-card p-4 text-risky">
          {error}
        </p>
      ) : null}

      {stage === "ready" && diffs && docB ? (
        <div className="mt-8">
          {diffs.length === 0 ? (
            <p className="text-ink-muted">No material differences found between the two documents.</p>
          ) : (
            <ComparisonView diffs={diffs} nameA={nameA} nameB={docB.name} />
          )}
        </div>
      ) : null}
    </main>
  );
}

function readName(docId: string): string {
  try {
    return window.sessionStorage.getItem(`plainlease:name:${docId}`) ?? "First document";
  } catch {
    return "First document";
  }
}
