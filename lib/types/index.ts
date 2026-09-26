// Data models from AGENTS2.md §6. These are the shared vocabulary for every
// phase: the parser produces Clause[], the Gemini layer fills in category /
// riskLevel / explanation, and the UI renders the results.
//
// Scope is five document types (AGENTS2.md §1). Categories are plain strings
// constrained at runtime to the confirmed type's taxonomy in
// /lib/documentTypes/config.ts — a union type here would only describe one
// type's taxonomy, so the config map is the single source of truth.

export type DocumentType =
  | "lease"
  | "freelance_contract"
  | "tos_privacy_policy"
  | "nda"
  | "employment_offer";

export interface Document {
  id: string;
  filename: string;
  rawText: string;
  uploadedAt: string;
  /** Gemini's suggestion from /api/upload — shown to the user, never applied silently.
   *  Absent when type detection failed at upload time (the doc is still stored;
   *  the user picks the type manually). */
  suggestedType?: DocumentType;
  suggestedTypeConfidence?: number; // 0-1
  /** Set once the user confirms or overrides the suggestion. */
  confirmedType?: DocumentType;
}

export type RiskLevel = "standard" | "unusual" | "risky";

export interface Clause {
  id: string;
  docId: string;
  text: string;
  order: number;
  /** Must be a member of CATEGORY_MAP[confirmedType] for the clause's document. */
  category?: string;
  riskLevel?: RiskLevel;
  explanation?: string;
}

export interface QAExchange {
  question: string;
  answer: string;
  citedClauseIds: string[];
  /** false when the question wasn't answerable from the document */
  grounded: boolean;
}

export interface ClauseDiff {
  category: string;
  docAText?: string;
  docBText?: string;
  materialDifference: string;
  favors: "A" | "B" | "neutral";
}

export interface ChecklistResult {
  redFlags: string[];
  questionsForLawyer: string[];
}
