import {
  AlertTriangle,
  BookOpenCheck,
  Code,
  FileText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import UploadDropzone from "@/components/UploadDropzone";
import Disclaimer from "@/components/Disclaimer";
import { TYPE_LABELS } from "@/lib/documentTypes/config";

const appName = process.env.NEXT_PUBLIC_APP_NAME ?? "PlainLease";

const STEPS = [
  {
    title: "Deep Scan",
    body: "Your document is read thoroughly, clause by clause, utilizing advanced natural language processing.",
  },
  {
    title: "Plain Translation",
    body: "Each complex legal clause gets a plain-language explanation, with unusual or heavily favored terms flagged immediately.",
  },
  {
    // Grounded Q&A (Phase 5) isn't shipped — describe a capability that
    // exists today rather than promising one that 404s.
    title: "You Confirm the Type",
    body: "We suggest what kind of document you uploaded; you confirm or correct it before analysis, so every category and flag comes from the right checklist.",
  },
];

export default function HomePage() {
  return (
    <div className="flex flex-1 flex-col bg-slate-50 text-slate-800 selection:bg-brand-100 selection:text-brand-900">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm">
              <BookOpenCheck className="h-5 w-5" aria-hidden />
            </div>
            <span className="font-serif text-2xl font-semibold tracking-tight text-slate-900">
              {appName}
            </span>
          </div>
          <div className="hidden items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-500 sm:flex">
            <ShieldCheck className="h-4 w-4" aria-hidden />
            Read before you sign
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-24 px-6 py-12 md:py-20">
        <section className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="opacity-0-init animate-fade-in-up">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-sm font-medium text-brand-600">
              <span className="h-2 w-2 animate-pulse rounded-full bg-brand-500" />
              AI-Powered Review
            </div>
            <h1 className="mb-6 font-serif text-5xl leading-[1.1] font-medium tracking-tight text-slate-900 md:text-6xl">
              Know exactly what you’re{" "}
              <span className="italic text-brand-600">signing.</span>
            </h1>
            <p className="max-w-lg text-lg leading-relaxed text-slate-600 md:text-xl">
              Upload your agreement before you sign. We translate legal jargon
              into plain words, flag unusual terms, and answer questions
              grounded in your actual document.
            </p>
            {/* The supported set is fixed (AGENTS2.md §1) — show it straight
                from the config so the page can't drift from the taxonomy. */}
            <div className="mt-6">
              <span className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
                Works with
              </span>
              <ul
                aria-label="Supported document types"
                className="mt-2 flex flex-wrap gap-2"
              >
                {Object.entries(TYPE_LABELS).map(([type, label]) => (
                  <li
                    key={type}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600"
                  >
                    {label}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="relative opacity-0-init animate-fade-in-up animate-delay-100">
            <div className="absolute -inset-1 rounded-[2rem] bg-gradient-to-r from-brand-100 to-blue-50 opacity-50 blur-lg" />
            <SampleClause />
          </div>
        </section>

        <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 opacity-0-init animate-fade-in-up animate-delay-200">
          <div className="rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
            <UploadDropzone />
          </div>
          <Disclaimer />
        </section>

        <section className="border-t border-slate-200 pt-10 opacity-0-init animate-fade-in-up animate-delay-300">
          <div className="mb-12 text-center">
            <h2 className="font-serif text-3xl font-medium text-slate-900 md:text-4xl">
              How it works
            </h2>
            <p className="mt-3 text-slate-500">
              Three simple steps to peace of mind.
            </p>
          </div>

          <div className="relative grid gap-6 md:grid-cols-3">
            <div
              aria-hidden
              className="absolute top-1/2 left-0 z-0 hidden h-0.5 w-full -translate-y-1/2 bg-gradient-to-r from-transparent via-slate-200 to-transparent md:block"
            />
            {STEPS.map((step, index) => (
              <div
                key={step.title}
                className="relative z-10 flex flex-col items-center rounded-2xl border border-slate-100 bg-white p-8 text-center shadow-sm"
              >
                <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-xl font-bold text-brand-600 shadow-inner ring-4 ring-white">
                  {index + 1}
                </div>
                <h3 className="mb-2 font-serif text-xl font-medium text-slate-900">
                  {step.title}
                </h3>
                <p className="text-sm leading-relaxed text-slate-600">
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="mt-auto border-t border-slate-800 bg-slate-900 py-8 text-slate-400">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-4 px-6 text-sm font-medium sm:flex-row">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-slate-800 text-slate-300">
              <BookOpenCheck className="h-3.5 w-3.5" aria-hidden />
            </div>
            <span className="text-slate-300">{appName}</span>
          </div>
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
            <span className="flex items-center gap-1.5">
              <Code className="h-4 w-4" aria-hidden /> Hackathon Project
            </span>
            <span className="flex items-center gap-1.5">
              <FileText className="h-4 w-4" aria-hidden /> 5 document types
              supported
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/*
 * Hero artefact: a synthetic sample clause (per the no-fabricated-legal-text
 * constraint, it is labelled as synthetic — a rental lease, one of the five
 * supported types) showing the product's core move — a flagged phrase plus
 * its plain-language translation.
 */
function SampleClause() {
  return (
    <figure className="relative flex flex-col gap-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50 md:p-8">
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-2 text-sm font-medium tracking-wider text-slate-500 uppercase">
          <FileText className="h-4 w-4" aria-hidden />
          Sample clause — synthetic rental lease
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-bold tracking-wide text-rose-600 uppercase">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          Unusual Term
        </span>
      </div>

      <blockquote className="font-serif text-lg leading-relaxed text-slate-800 md:text-xl">
        <span className="mr-2 font-sans text-base text-slate-400 select-none">
          11.
        </span>
        If the tenant wishes to vacate before the end of the term,{" "}
        <mark
          className="annotation-highlight cursor-help bg-transparent text-slate-900"
          title="Hover to see the annotation"
        >
          two months’ rent shall be deducted from the security deposit
        </mark>
        .
      </blockquote>

      <div className="relative rounded-xl border-l-4 border-rose-400 bg-slate-50 p-5">
        <div className="absolute -top-3 left-4 rounded-md bg-rose-100 p-1 text-rose-700">
          <Sparkles className="h-4 w-4" aria-hidden />
        </div>
        <p className="mt-1 font-serif text-base leading-relaxed text-slate-700 italic">
          <strong className="mb-1 block font-sans text-sm font-semibold text-rose-600 not-italic">
            Plain English Translation:
          </strong>
          If you leave early, two months’ rent comes out of your deposit — this
          is a harsh penalty worth questioning or negotiating before you sign.
        </p>
      </div>
    </figure>
  );
}
