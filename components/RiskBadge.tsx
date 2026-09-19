import type { RiskLevel } from "@/lib/types";

/*
 * Color-coded risk pill (Phase 4). An undefined riskLevel means the clause
 * hasn't been classified yet — shown honestly as "Not yet reviewed", never
 * defaulted to a guessed level.
 */

const BADGE_CLASSES: Record<RiskLevel, string> = {
  standard: "border-standard/40 text-standard",
  unusual: "border-unusual/40 text-unusual",
  risky: "border-risky/40 text-risky",
};

const LABELS: Record<RiskLevel, string> = {
  standard: "Standard",
  unusual: "Unusual",
  risky: "Risky",
};

export default function RiskBadge({ riskLevel }: { riskLevel?: RiskLevel }) {
  if (!riskLevel) {
    return (
      <span className="rounded-full border border-rule px-2.5 py-0.5 text-xs font-medium text-ink-muted">
        Not yet reviewed
      </span>
    );
  }

  return (
    <span
      className={`rounded-full border bg-card px-2.5 py-0.5 text-xs font-medium ${BADGE_CLASSES[riskLevel]}`}
    >
      {LABELS[riskLevel]}
    </span>
  );
}
