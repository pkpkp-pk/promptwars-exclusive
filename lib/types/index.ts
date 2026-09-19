// Data models from AGENTS.md §6. These are the shared vocabulary for every
// phase: the parser produces Clause[], the Gemini layer fills in category /
// riskLevel / explanation, and the UI renders the results.

export interface Document {
  id: string;
  filename: string;
  rawText: string;
  uploadedAt: string;
}

export type ClauseCategory =
  | "rent"
  | "deposit"
  | "termination"
  | "maintenance"
  | "utilities"
  | "renewal"
  | "other";

export type RiskLevel = "standard" | "unusual" | "risky";

export interface Clause {
  id: string;
  docId: string;
  text: string;
  order: number;
  category?: ClauseCategory;
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
  category: ClauseCategory;
  docAText?: string;
  docBText?: string;
  materialDifference: string;
  favors: "A" | "B" | "neutral";
}

export interface ChecklistResult {
  redFlags: string[];
  questionsForLawyer: string[];
}
