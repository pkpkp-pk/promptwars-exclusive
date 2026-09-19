"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const MAX_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = [".pdf", ".docx"] as const;

type AcceptedExtension = (typeof ACCEPTED_EXTENSIONS)[number];

interface UploadResponse {
  docId: string;
  clauseCount: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const GENERIC_UPLOAD_ERROR =
  "We couldn’t read that file. Make sure it’s a PDF or DOCX under 10 MB, then try again.";

/** Prefer the route's own error message; fall back to the generic one. */
async function serverErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    // Not a JSON error body (e.g. an HTML error page) — use the generic message.
  }
  return GENERIC_UPLOAD_ERROR;
}

export default function UploadDropzone() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const pickFile = (candidate: File | undefined | null) => {
    setError(null);
    if (!candidate) return;
    const extension = candidate.name
      .slice(candidate.name.lastIndexOf("."))
      .toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(extension as AcceptedExtension)) {
      setFile(null);
      setError(
        "That file type isn’t supported. Upload a PDF or DOCX copy of your lease.",
      );
      return;
    }
    if (candidate.size > MAX_SIZE_BYTES) {
      setFile(null);
      setError(
        "That file is larger than 10 MB. Try a smaller scan or a text-based export.",
      );
      return;
    }
    setFile(candidate);
  };

  const analyze = async () => {
    if (!file || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/upload", { method: "POST", body });
      if (!response.ok) {
        throw new Error(await serverErrorMessage(response));
      }
      const data = (await response.json()) as UploadResponse;
      router.push(`/review/${data.docId}`);
    } catch (error) {
      setUploading(false);
      setError(
        error instanceof Error && error.message
          ? error.message
          : GENERIC_UPLOAD_ERROR,
      );
    }
  };

  return (
    <div>
      <label
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed bg-card px-6 py-10 text-center transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink ${
          dragActive
            ? "border-ink bg-paper"
            : "border-rule hover:border-ink-muted"
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setDragActive(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          pickFile(event.dataTransfer.files[0]);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx"
          className="sr-only"
          onChange={(event) => pickFile(event.target.files?.[0])}
        />
        <span className="font-serif text-xl font-medium">
          Drop your lease here
        </span>
        <span className="text-ink-muted">
          or <span className="underline underline-offset-2">browse files</span>
        </span>
        <span className="mt-2 max-w-[48ch] text-sm text-ink-muted">
          PDF or DOCX, up to 10 MB. Your document stays in this session and is
          not stored anywhere else.
        </span>
      </label>

      {file ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-rule bg-card px-4 py-3">
          <span className="min-w-0 flex-1 truncate">
            {file.name}{" "}
            <span className="text-ink-muted">({formatBytes(file.size)})</span>
          </span>
          <button
            type="button"
            onClick={analyze}
            disabled={uploading}
            className="rounded-md bg-ink px-4 py-2 font-medium text-paper transition-opacity hover:opacity-85 disabled:opacity-50"
          >
            {uploading ? "Reading your lease…" : "Analyze lease"}
          </button>
          <button
            type="button"
            onClick={() => {
              setFile(null);
              setError(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
            className="rounded-md px-2 py-2 text-ink-muted underline underline-offset-2 hover:text-ink"
          >
            Remove
          </button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-risky">
          {error}
        </p>
      ) : null}
    </div>
  );
}
