/*
 * Rendered on every screen that shows AI-generated content (constraint 4 in
 * AGENTS.md — not just the landing page). Keep the exact phrase.
 */
export default function Disclaimer() {
  return (
    <aside
      aria-label="Legal disclaimer"
      className="rounded-lg border border-rule bg-card px-4 py-3.5 text-sm leading-relaxed text-ink-muted"
    >
      <strong className="font-semibold text-ink">
        This tool provides information, not legal advice.
      </strong>{" "}
      It reads the text you upload and points out what that text says. For
      decisions about your lease, consult a legal professional.
    </aside>
  );
}
