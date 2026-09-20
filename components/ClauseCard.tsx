import RiskBadge from "./RiskBadge";
import type { Clause, DocumentType, RiskLevel } from "@/lib/types";
import { categoryLabel } from "@/lib/documentTypes/config";

/*
 * One clause from the deterministic parser, with its classification when
 * available. The plain-language note leads — most readers want the meaning,
 * not the legalese — and the clause text follows verbatim under its own label,
 * so the summary never stands in for the source. Collapsed mode (the
 * review screen's "Collapse all") shows the header and note only; the text
 * comes back with "Expand all".
 */

const NOTE_BORDERS: Record<RiskLevel, string> = {
  standard: "border-standard/50",
  unusual: "border-unusual/50",
  risky: "border-risky/50",
};

export default function ClauseCard({
  clause,
  confirmedType,
  collapsed = false,
}: {
  clause: Clause;
  /** The type the user confirmed — category names are per-type (AGENTS2.md §6a). */
  confirmedType?: DocumentType;
  collapsed?: boolean;
}) {
  // Category labels only mean something inside their type's taxonomy, so
  // without a confirmed type fall back to the raw category name rather than
  // translating through a guessed taxonomy.
  const categoryText = !clause.category
    ? ""
    : ` · ${confirmedType ? categoryLabel(confirmedType, clause.category) : clause.category}`;

  return (
    <article
      id={`clause-${clause.id}`}
      tabIndex={-1}
      className="scroll-mt-6 rounded-lg border border-rule bg-card p-5"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-sm text-ink-muted">
          Clause {clause.order + 1}
          {categoryText}
        </span>
        <span className="ml-auto">
          <RiskBadge riskLevel={clause.riskLevel} />
        </span>
      </div>

      {clause.explanation ? (
        <div
          className={`mt-4 border-l-2 pl-4 ${
            clause.riskLevel ? NOTE_BORDERS[clause.riskLevel] : "border-rule"
          }`}
        >
          <span className="text-sm text-ink-muted">In plain language</span>
          <p className="mt-1 font-serif italic leading-relaxed text-ink-muted">
            {clause.explanation}
          </p>
        </div>
      ) : collapsed ? (
        <p className="mt-4 text-sm text-ink-muted">Not yet reviewed.</p>
      ) : null}

      {collapsed ? null : (
        <div className="mt-4">
          <span className="text-sm text-ink-muted">What the document says</span>
          <p className="mt-1 max-w-[68ch] whitespace-pre-line leading-relaxed text-ink">
            {clause.text}
          </p>
        </div>
      )}
    </article>
  );
}
