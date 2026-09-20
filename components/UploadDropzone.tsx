"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudUpload, FileType, HardDrive, ShieldCheck } from "lucide-react";
import type { DocumentType } from "@/lib/types";

const MAX_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = [".pdf", ".docx"] as const;

type AcceptedExtension = (typeof ACCEPTED_EXTENSIONS)[number];

interface UploadResponse {
  docId: string;
  clauseCount: number;
  suggestedType: DocumentType;
  suggestedTypeConfidence: number;
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
        "That file type isn’t supported. Upload a PDF or DOCX copy of your document.",
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
      try {
        // The review page may render outside the store-owning function, so
        // carry the filename along for the trip.
        window.sessionStorage.setItem(`plainlease:name:${data.docId}`, file.name);
        // Same trip for the type suggestion — the review page shows it (with
        // an override dropdown) before classification runs. Guarded because
        // the field is only as fresh as the deployed route.
        if (data.suggestedType) {
          window.sessionStorage.setItem(
            `plainlease:type:${data.docId}`,
            JSON.stringify({
              type: data.suggestedType,
              confidence: data.suggestedTypeConfidence,
            }),
          );
        }
      } catch {
        // Storage unavailable — the review page falls back to server-side
        // state and asks the user to pick a type outright.
      }
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
        className={`group relative flex cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-6 py-16 text-center transition-all focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-600 ${
          dragActive
            ? "border-brand-400 bg-brand-50"
            : "border-slate-200 bg-slate-50/50 hover:border-brand-300 hover:bg-brand-50"
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
        <div className="flex h-16 w-16 items-center justify-center rounded-full border border-slate-100 bg-white text-slate-400 shadow-sm transition-transform duration-300 group-hover:scale-110 group-hover:text-brand-600">
          <CloudUpload className="h-8 w-8" aria-hidden />
        </div>
        <div className="flex flex-col items-center gap-1">
          <span className="font-serif text-2xl font-medium text-slate-900">
            Upload your agreement
          </span>
          <span className="text-slate-500">
            Drag and drop, or{" "}
            <span className="font-semibold text-brand-600 underline underline-offset-4 group-hover:text-brand-700">
              browse files
            </span>
          </span>
        </div>
        <div className="mt-2 flex items-center gap-4 text-xs font-medium text-slate-400">
          <span className="flex items-center gap-1">
            <FileType className="h-3.5 w-3.5" aria-hidden /> PDF or DOCX
          </span>
          <span className="h-1 w-1 rounded-full bg-slate-300" />
          <span className="flex items-center gap-1">
            <HardDrive className="h-3.5 w-3.5" aria-hidden /> Max 10 MB
          </span>
          <span className="hidden h-1 w-1 rounded-full bg-slate-300 sm:block" />
          <span className="hidden items-center gap-1 sm:flex">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" aria-hidden />{" "}
            Secure session only
          </span>
        </div>
      </label>

      {file ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <span className="min-w-0 flex-1 truncate">
            {file.name}{" "}
            <span className="text-slate-500">({formatBytes(file.size)})</span>
          </span>
          <button
            type="button"
            onClick={analyze}
            disabled={uploading}
            className="rounded-md bg-brand-600 px-4 py-2 font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-50"
          >
            {uploading ? "Reading your document…" : "Analyze document"}
          </button>
          <button
            type="button"
            onClick={() => {
              setFile(null);
              setError(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
            className="rounded-md px-2 py-2 text-slate-500 underline underline-offset-2 hover:text-slate-800"
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
