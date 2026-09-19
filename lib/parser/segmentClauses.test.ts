import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { segmentClauses } from "./segmentClauses";

const fixture = (name: string) =>
  readFileSync(new URL(`../../tests/fixtures/${name}`, import.meta.url), "utf8");

const numbered = fixture("synthetic-numbered.txt");

describe("segmentClauses", () => {
  it("splits a numbered lease into one clause per numbered section, in order", () => {
    const clauses = segmentClauses(numbered, "doc-1");
    // preamble + sections 1–8
    expect(clauses).toHaveLength(9);
    expect(clauses[0]?.text).toContain("This rental agreement is made at Mumbai");
    expect(clauses[1]?.text).toMatch(/^1\. The Tenant shall pay a monthly rent/);
    expect(clauses[8]?.text).toMatch(/^8\. This agreement may be renewed/);
  });

  it("stamps every clause with the doc id, a stable id, and its order", () => {
    const clauses = segmentClauses(numbered, "doc-1");
    expect(clauses.every((clause) => clause.docId === "doc-1")).toBe(true);
    expect(clauses.map((clause) => clause.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(clauses.map((clause) => clause.id)).size).toBe(9);
  });

  it("falls back to paragraph chunks when no numbering exists", () => {
    const clauses = segmentClauses(fixture("synthetic-unstructured.txt"), "doc-2");
    expect(clauses.length).toBeGreaterThan(3);
    expect(clauses.every((clause) => clause.text.length > 0)).toBe(true);
    expect(clauses.map((clause) => clause.order)).toEqual(
      clauses.map((_, index) => index),
    );
  });

  it("never returns an empty clause", () => {
    const clauses = segmentClauses("\n\n   \n1. Only clause.\n\n", "doc-3");
    expect(clauses.map((clause) => clause.text)).toEqual(["1. Only clause."]);
  });
});
