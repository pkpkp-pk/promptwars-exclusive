import { Info } from "lucide-react";

/*
 * Rendered on every screen that shows AI-generated content (constraint 5 in
 * AGENTS2.md — not just the landing page). Keep the exact phrase.
 */
export default function Disclaimer() {
  return (
    <aside
      aria-label="Legal disclaimer"
      className="flex items-start gap-4 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm leading-relaxed text-amber-900 shadow-sm"
    >
      <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
      <div>
        <strong className="mb-0.5 block font-semibold">
          This tool provides information, not legal advice.
        </strong>
        It reads the text you upload and points out what that text says. For
        important decisions or legal disputes about your document, always
        consult a qualified legal professional.
      </div>
    </aside>
  );
}
