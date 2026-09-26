"use client";

import { Scale } from "lucide-react";
import type { ClauseDiff } from "@/lib/types";

/*
 * Comparison results (Phase 6). One card per aligned clause pair: the
 * material difference the model found, which document it favors, and both
 * source texts side by side so the claim is checkable without leaving the
 * page. A clause present in only one document renders a single side.
 */

const FAVORS_LABEL: Record<ClauseDiff["favors"], string> = {
  A: "Favors first document",
  B: "Favors second document",
  neutral: "Equivalent",
};

const FAVORS_CLASS: Record<ClauseDiff["favors"], string> = {
  A: "border-blue-200 bg-blue-50 text-blue-700",
  B: "border-violet-200 bg-violet-50 text-violet-700",
  neutral: "border-slate-200 bg-slate-50 text-slate-600",
};

export default function ComparisonView({
  diffs,
  nameA,
  nameB,
}: {
  diffs: ClauseDiff[];
  nameA: string;
  nameB: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      {diffs.map((diff, index) => (
        <article key={index} className="rounded-2xl border border-rule bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
              {diff.category.replaceAll("_", " ")}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${FAVORS_CLASS[diff.favors]}`}
            >
              <Scale className="h-3 w-3" aria-hidden />
              {FAVORS_LABEL[diff.favors]}
            </span>
          </div>
          <p className="mt-3 text-ink">{diff.materialDifference}</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <blockquote className="rounded-lg border-l-4 border-blue-300 bg-slate-50 p-3 text-sm text-ink-muted">
              <strong className="mb-1 block text-xs font-semibold uppercase tracking-wide">{nameA}</strong>
              {diff.docAText ?? <em>Not addressed in this document.</em>}
            </blockquote>
            <blockquote className="rounded-lg border-l-4 border-violet-300 bg-slate-50 p-3 text-sm text-ink-muted">
              <strong className="mb-1 block text-xs font-semibold uppercase tracking-wide">{nameB}</strong>
              {diff.docBText ?? <em>Not addressed in this document.</em>}
            </blockquote>
          </div>
        </article>
      ))}
    </div>
  );
}
