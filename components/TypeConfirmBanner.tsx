"use client";

import { useId, useState } from "react";
import { FileCheck, FileText } from "lucide-react";
import type { DocumentType } from "@/lib/types";
import { TYPE_LABELS } from "@/lib/documentTypes/config";

/*
 * Document-type confirmation (AGENTS2.md §2 constraint 4). The type decides
 * which category taxonomy classification runs with, so it is never applied
 * silently: the user sees the suggestion (with its confidence), can override
 * it via the dropdown, and must confirm before /api/classify is called. Once
 * confirmed, the banner shows the chosen type compactly — it is the taxonomy
 * the on-screen category labels came from.
 */

interface TypeConfirmBannerProps {
  /** Gemini's suggestion from /api/upload, when one is known. */
  suggestedType?: DocumentType;
  /** Confidence of the suggestion, 0-1, when known. */
  suggestedTypeConfidence?: number;
  /**
   * Dropdown's starting point: the type confirmed in an earlier visit when
   * the store still remembers it, else the suggestion. It can also resolve
   * after hydration (sessionStorage fallback), which is why it is a prop
   * rather than initial state.
   */
  initialSelected?: DocumentType;
  /** Set once the user has confirmed — renders the compact confirmed form. */
  confirmedType?: DocumentType;
  /** Called with the chosen type when the user presses Confirm. */
  onConfirm: (type: DocumentType) => void;
  /** True while classification is in flight — keeps the controls inert. */
  disabled?: boolean;
}

export default function TypeConfirmBanner({
  suggestedType,
  suggestedTypeConfidence,
  initialSelected,
  confirmedType,
  onConfirm,
  disabled = false,
}: TypeConfirmBannerProps) {
  const selectId = useId();
  // An explicit pick wins over the suggestion, even one that arrives late —
  // the user's choice must never be silently swapped out from under them.
  const [override, setOverride] = useState<DocumentType | null>(null);
  const selectedType = override ?? initialSelected;

  if (confirmedType) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-rule bg-card px-4 py-3 text-sm">
        <FileCheck className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
        <span className="text-ink-muted">Analyzed as</span>
        <span className="font-medium text-ink">{TYPE_LABELS[confirmedType]}</span>
      </div>
    );
  }

  return (
    <section
      aria-label="Confirm document type"
      className="rounded-lg border border-rule bg-card p-5"
    >
      <p className="text-sm text-ink-muted">
        {suggestedType ? (
          <>
            We think this is a{" "}
            <strong className="font-medium text-ink">
              {TYPE_LABELS[suggestedType]}
            </strong>
            {typeof suggestedTypeConfidence === "number"
              ? ` (${Math.round(suggestedTypeConfidence * 100)}% confident)`
              : null}
            . The document type decides which categories we look for, so
            confirm or correct it before we analyze.
          </>
        ) : (
          <>
            We couldn’t tell what kind of document this is. Pick the closest
            match below — the type decides which categories we look for.
          </>
        )}
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={selectId} className="text-sm text-ink-muted">
            Document type
          </label>
          <select
            id={selectId}
            value={selectedType ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              setOverride(value ? (value as DocumentType) : null);
            }}
            disabled={disabled}
            className="rounded-md border border-rule bg-card px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50"
          >
            {/* Placeholder only while nothing is selected — once a type is
                in play, "no choice" is not a useful option to offer. */}
            {selectedType ? null : (
              <option value="">Select a document type…</option>
            )}
            {(Object.keys(TYPE_LABELS) as DocumentType[]).map((type) => (
              <option key={type} value={type}>
                {TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => selectedType && onConfirm(selectedType)}
          disabled={disabled || !selectedType}
          className="rounded-md bg-ink px-4 py-2 font-medium text-paper transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50"
        >
          Confirm and analyze
        </button>
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-muted">
        <FileText className="h-3.5 w-3.5" aria-hidden />
        Wrong type means wrong category labels — that’s why this step is yours,
        not ours.
      </p>
    </section>
  );
}
