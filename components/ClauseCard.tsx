import RiskBadge from "./RiskBadge";
import type { Clause, ClauseCategory, RiskLevel } from "@/lib/types";

/*
 * One clause from the deterministic parser, with its classification when
 * available. The clause text is always shown verbatim — the explanation sits
 * beside it as a margin note, never replaces it.
 */

const CATEGORY_LABELS: Record<ClauseCategory, string> = {
  rent: "Rent",
  deposit: "Security deposit",
  termination: "Termination",
  maintenance: "Maintenance",
  utilities: "Utilities",
  renewal: "Renewal",
  other: "Other",
};

const NOTE_BORDERS: Record<RiskLevel, string> = {
  standard: "border-standard/50",
  unusual: "border-unusual/50",
  risky: "border-risky/50",
};

export default function ClauseCard({ clause }: { clause: Clause }) {
  return (
    <article
      id={`clause-${clause.id}`}
      className="rounded-lg border border-rule bg-card p-5"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-sm text-ink-muted">
          Clause {clause.order + 1}
          {clause.category ? ` · ${CATEGORY_LABELS[clause.category]}` : ""}
        </span>
        <span className="ml-auto">
          <RiskBadge riskLevel={clause.riskLevel} />
        </span>
      </div>

      <p className="mt-3 max-w-[68ch] whitespace-pre-line leading-relaxed text-ink">
        {clause.text}
      </p>

      {clause.explanation ? (
        <div
          className={`mt-4 border-l-2 pl-4 ${
            clause.riskLevel ? NOTE_BORDERS[clause.riskLevel] : "border-rule"
          }`}
        >
          <span className="text-sm text-ink-muted">In plain language</span>
          <p className="font-serif italic leading-relaxed text-ink-muted">
            {clause.explanation}
          </p>
        </div>
      ) : null}
    </article>
  );
}
