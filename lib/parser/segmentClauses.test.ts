import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { segmentClauses } from "./segmentClauses";

const fixture = (name: string) =>
  readFileSync(new URL(`../../tests/fixtures/${name}`, import.meta.url), "utf8");

const numbered = fixture("synthetic-numbered.txt");
const capsHeaders = fixture("synthetic-caps-headers.txt");
const unstructured = fixture("synthetic-unstructured.txt");
const nda = fixture("synthetic-nda.txt");
const freelance = fixture("synthetic-freelance.txt");
const tos = fixture("synthetic-tos.txt");

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

  it("groups each ALL-CAPS heading with the body that follows it", () => {
    const clauses = segmentClauses(capsHeaders, "doc-4");
    // title + preamble, then 8 headed sections
    expect(clauses).toHaveLength(9);
    expect(clauses[1]?.text).toMatch(/^RENT\b/);
    expect(clauses[1]?.text).toContain("Rs. 22,000");
    expect(clauses[8]?.text).toMatch(/^SUBLETTING/);
    expect(clauses[8]?.text).toContain("prior written consent");
  });

  it("keeps the document title with the opening preamble clause", () => {
    const clauses = segmentClauses(capsHeaders, "doc-5");
    expect(clauses[0]?.text).toContain("RENTAL AGREEMENT");
    expect(clauses[0]?.text).toContain("made at Bengaluru");
  });

  it("merges an ALL-CAPS title into the opening clause of an unstructured lease", () => {
    const clauses = segmentClauses(unstructured, "doc-6");
    expect(clauses[0]?.text).toContain("MEMORANDUM OF TENANCY");
    expect(clauses[0]?.text).toContain("Sunita Deshmukh");
  });

  /*
   * AGENTS2.md Phase 2: tests must cover samples from at least 3 of the 5
   * document types plus one unstructured document. The lease fixtures above
   * cover `lease` (numbered, ALL-CAPS headings, unstructured); the three
   * below add `nda`, `freelance_contract`, and `tos_privacy_policy`.
   */

  it("splits a numbered NDA into one clause per numbered section, in order", () => {
    const clauses = segmentClauses(nda, "doc-8");
    // preamble + sections 1–10 (the witness line joins section 10)
    expect(clauses).toHaveLength(11);
    expect(clauses[0]?.text).toContain("This Non-Disclosure Agreement is made at Hyderabad");
    expect(clauses[1]?.text).toMatch(/^1\. "Confidential Information" means/);
    expect(clauses[10]?.text).toMatch(/^10\. This Agreement shall be governed/);
    expect(clauses.map((clause) => clause.order)).toEqual(
      clauses.map((_, index) => index),
    );
  });

  it("merges ALL-CAPS headings into the body that follows them in a freelance contract", () => {
    const clauses = segmentClauses(freelance, "doc-9");
    // title + preamble, then 9 headed sections
    expect(clauses).toHaveLength(10);
    expect(clauses[0]?.text).toContain("FREELANCE SERVICES AGREEMENT");
    expect(clauses[0]?.text).toContain("Tanvi Creative Works");
    expect(clauses[1]?.text).toMatch(/^INDEPENDENT CONTRACTOR STATUS\b/);
    expect(clauses[4]?.text).toMatch(/^PAYMENT TERMS\b/);
    expect(clauses[4]?.text).toContain("Rs. 2,40,000");
    expect(clauses[9]?.text).toMatch(/^GOVERNING LAW\b/);
    expect(clauses[9]?.text).toContain("courts at Pune");
  });

  it("splits a numbered terms-of-service into one clause per section, in order", () => {
    const clauses = segmentClauses(tos, "doc-10");
    // preamble + sections 1–10
    expect(clauses).toHaveLength(11);
    expect(clauses[0]?.text).toContain("Zephyra Notes");
    expect(clauses[1]?.text).toMatch(/^1\. Acceptance of Terms/);
    expect(clauses[3]?.text).toMatch(/^3\. Information We Collect/);
    expect(clauses[7]?.text).toMatch(/^7\. Account Termination/);
    expect(clauses[10]?.text).toMatch(/^10\. Dispute Resolution/);
    expect(clauses[10]?.text).toContain("binding arbitration");
    expect(clauses.map((clause) => clause.order)).toEqual(
      clauses.map((_, index) => index),
    );
  });

  it("collapses source line wraps into flowing prose with no internal line breaks", () => {
    // PDF extraction keeps the page's hard line breaks; clause text must not.
    const wrapped =
      "3. That the Tenant shall pay to the Owner a monthly\nmaintenance charge of Rs.(Amount in\nNumbers) towards the maintenance of Generator & Elevator, Salaries towards guards,\nCharges for Electricity Maintenance for Common Areas\nand towards maintaining the lawn.";
    const [clause] = segmentClauses(wrapped, "doc-7");
    expect(clause?.text).toBe(
      "3. That the Tenant shall pay to the Owner a monthly maintenance charge of Rs.(Amount in Numbers) towards the maintenance of Generator & Elevator, Salaries towards guards, Charges for Electricity Maintenance for Common Areas and towards maintaining the lawn.",
    );
  });

  it("never returns an empty clause", () => {
    const clauses = segmentClauses("\n\n   \n1. Only clause.\n\n", "doc-3");
    expect(clauses.map((clause) => clause.text)).toEqual(["1. Only clause."]);
  });
});
