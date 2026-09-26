import { afterEach, describe, expect, it } from "vitest";
import {
  clearDocuments,
  getClauses,
  getComparison,
  getDocument,
  getEmbeddings,
  saveDocument,
  setComparison,
  setConfirmedType,
  setEmbeddings,
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

  it("evicts the oldest upload past the document cap", () => {
    for (let i = 0; i < 50; i++) {
      saveDocument(
        { ...leaseDocument(`old-${i}`, "x"), uploadedAt: `2026-09-${String(1 + (i % 28)).padStart(2, "0")}T00:00:00.000Z` },
        [],
      );
    }
    saveDocument(
      { ...leaseDocument("newest", "x"), uploadedAt: "2026-09-26T00:00:00.000Z" },
      [],
    );

    expect(getDocument("newest")).toBeDefined();
    expect(getDocument("old-0")).toBeUndefined(); // 2026-09-01, the oldest
    expect(getDocument("old-27")).toBeDefined(); // 2026-09-28, survives
  });

  it("caches embeddings per document and invalidates them on clause updates", () => {
    saveDocument(leaseDocument("d4", "1. Alpha."), [
      { id: "d4-c0", docId: "d4", text: "1. Alpha.", order: 0 },
    ]);

    expect(getEmbeddings("d4")).toBeUndefined();
    setEmbeddings("d4", [[1, 0]], [1]);
    expect(getEmbeddings("d4")).toEqual({ vectors: [[1, 0]], norms: [1] });

    updateClauses("d4", [{ id: "d4-c0", docId: "d4", text: "1. Alpha.", order: 0 }]);
    expect(getEmbeddings("d4")).toBeUndefined();
  });

  it("caches comparisons and drops them when a side's clauses change", () => {
    saveDocument(leaseDocument("a", "1. Alpha."), []);
    saveDocument(leaseDocument("b", "1. Beta."), []);
    const diffs = [{ category: "rent", docAText: "x", materialDifference: "d", favors: "A" as const }];

    setComparison("a", "b", diffs);
    expect(getComparison("a", "b")).toEqual(diffs);
    expect(getComparison("b", "a")).toBeUndefined(); // order-sensitive

    updateClauses("a", []);
    expect(getComparison("a", "b")).toBeUndefined();
  });

  it("drops a document's comparisons when it is evicted", () => {
    saveDocument(
      { ...leaseDocument("victim", "x"), uploadedAt: "2026-09-01T00:00:00.000Z" },
      [],
    );
    saveDocument(leaseDocument("other", "x"), []);
    setComparison("victim", "other", [
      { category: "rent", materialDifference: "d", favors: "neutral" },
    ]);

    for (let i = 0; i < 50; i++) {
      saveDocument(
        { ...leaseDocument(`filler-${i}`, "x"), uploadedAt: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T00:00:00.000Z` },
        [],
      );
    }

    expect(getDocument("victim")).toBeUndefined();
    expect(getComparison("victim", "other")).toBeUndefined();
  });
});
