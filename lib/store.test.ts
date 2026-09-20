import { afterEach, describe, expect, it } from "vitest";
import {
  clearDocuments,
  getClauses,
  getDocument,
  saveDocument,
  setConfirmedType,
  updateClauses,
} from "./store";
import type { Clause, Document } from "./types";

afterEach(() => {
  clearDocuments();
});

function leaseDocument(id: string, rawText: string): Document {
  return {
    id,
    filename: "document.pdf",
    rawText,
    uploadedAt: "2026-09-19T00:00:00.000Z",
    suggestedType: "lease",
    suggestedTypeConfidence: 0.9,
  };
}

describe("document store", () => {
  it("stores and returns a document and its clauses", () => {
    const document = leaseDocument("d1", "1. Alpha.");
    const clauses: Clause[] = [{ id: "d1-c0", docId: "d1", text: "1. Alpha.", order: 0 }];

    saveDocument(document, clauses);

    expect(getDocument("d1")).toEqual(document);
    expect(getClauses("d1")).toEqual(clauses);
  });

  it("returns undefined for unknown document ids", () => {
    expect(getDocument("missing")).toBeUndefined();
    expect(getClauses("missing")).toBeUndefined();
  });

  it("replaces the stored clauses when classification results come back", () => {
    const document = leaseDocument("d2", "1. Alpha.\n2. Beta.");
    saveDocument(document, [
      { id: "d2-c0", docId: "d2", text: "1. Alpha.", order: 0 },
      { id: "d2-c1", docId: "d2", text: "2. Beta.", order: 1 },
    ]);

    updateClauses("d2", [
      {
        id: "d2-c0",
        docId: "d2",
        text: "1. Alpha.",
        order: 0,
        category: "rent",
        riskLevel: "standard",
        explanation: "Sets the monthly rent.",
      },
      {
        id: "d2-c1",
        docId: "d2",
        text: "2. Beta.",
        order: 1,
        category: "deposit",
        riskLevel: "risky",
        explanation: "Forfeits the deposit.",
      },
    ]);

    const stored = getClauses("d2");
    expect(stored?.map((clause) => clause.riskLevel)).toEqual(["standard", "risky"]);
    expect(getDocument("d2")).toEqual(document);
  });

  it("ignores clause updates for unknown documents", () => {
    expect(() =>
      updateClauses("missing", [{ id: "missing-c0", docId: "missing", text: "x", order: 0 }]),
    ).not.toThrow();
    expect(getDocument("missing")).toBeUndefined();
  });

  it("stamps the confirmed type on a stored document without touching the suggestion", () => {
    const document: Document = {
      ...leaseDocument("d3", "1. Alpha."),
      suggestedType: "nda",
      suggestedTypeConfidence: 0.4,
    };
    saveDocument(document, [{ id: "d3-c0", docId: "d3", text: "1. Alpha.", order: 0 }]);

    // The user overrides a low-confidence "nda" suggestion with "lease".
    setConfirmedType("d3", "lease");

    expect(getDocument("d3")?.confirmedType).toBe("lease");
    // The original suggestion stays visible for the confirmation banner.
    expect(getDocument("d3")?.suggestedType).toBe("nda");
  });

  it("ignores confirmed-type updates for unknown documents", () => {
    expect(() => setConfirmedType("missing", "lease")).not.toThrow();
    expect(getDocument("missing")).toBeUndefined();
  });
});
