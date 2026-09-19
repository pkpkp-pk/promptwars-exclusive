import { readFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { clearDocuments, getClauses, getDocument } from "@/lib/store";
import { POST } from "./route";

const TEN_MB = 10 * 1024 * 1024;

afterEach(() => {
  clearDocuments();
});

function fixtureFile(name: string, uploadName: string, type: string): File {
  const bytes = readFileSync(new URL(`../../../tests/fixtures/${name}`, import.meta.url));
  return new File([bytes], uploadName, { type });
}

async function upload(file: File | null): Promise<Response> {
  const form = new FormData();
  if (file) form.set("file", file);
  return POST(new Request("http://localhost/api/upload", { method: "POST", body: form }));
}

it("rejects an upload with no file attached", async () => {
  const response = await upload(null);
  expect(response.status).toBe(400);
  const body = (await response.json()) as { error: string };
  expect(body.error).toMatch(/no file/i);
});

it("rejects unsupported file types", async () => {
  const response = await upload(new File(["plain text"], "notes.txt", { type: "text/plain" }));
  expect(response.status).toBe(400);
  const body = (await response.json()) as { error: string };
  expect(body.error).toMatch(/PDF or DOCX/);
});

it("rejects files larger than 10 MB", async () => {
  const oversize = new File([new Uint8Array(TEN_MB + 1)], "lease.pdf", {
    type: "application/pdf",
  });
  const response = await upload(oversize);
  expect(response.status).toBe(413);
});

it("extracts, segments and stores a text PDF end to end", async () => {
  const response = await upload(
    fixtureFile("synthetic-lease.pdf", "lease.pdf", "application/pdf"),
  );
  expect(response.status).toBe(200);

  const body = (await response.json()) as { docId: string; clauseCount: number };
  expect(body.docId).toBeTruthy();
  expect(body.clauseCount).toBe(9);

  const stored = getDocument(body.docId);
  expect(stored?.filename).toBe("lease.pdf");
  expect(stored?.rawText).toContain("monthly rent");
  expect(stored?.rawText.length).toBeGreaterThan(500);
  expect(getClauses(body.docId)).toHaveLength(9);
});

it("extracts, segments and stores a DOCX end to end", async () => {
  const response = await upload(
    fixtureFile(
      "synthetic-lease.docx",
      "lease.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
  );
  expect(response.status).toBe(200);

  const body = (await response.json()) as { docId: string; clauseCount: number };
  expect(body.clauseCount).toBe(9);
  expect(getDocument(body.docId)?.rawText).toContain("security deposit");
});

it("rejects a PDF with no text layer (a scan)", async () => {
  const response = await upload(fixtureFile("blank.pdf", "scanned.pdf", "application/pdf"));
  expect(response.status).toBe(422);
  const body = (await response.json()) as { error: string };
  expect(body.error).toMatch(/scan/i);
});
