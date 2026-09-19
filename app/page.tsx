import UploadDropzone from "@/components/UploadDropzone";
import Disclaimer from "@/components/Disclaimer";

const appName = process.env.NEXT_PUBLIC_APP_NAME ?? "PlainLease";

const STEPS = [
  "Your lease is read clause by clause",
  "Each clause gets a plain-language explanation, with unusual or risky terms flagged",
  "Ask questions and get answers that quote the exact clause they come from",
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-rule">
        <div className="mx-auto flex w-full max-w-3xl items-baseline justify-between px-6 py-5">
          <span className="font-serif text-xl font-medium">{appName}</span>
          <span className="text-sm text-ink-muted">
            For renters reviewing a lease in India
          </span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-16 px-6 py-14">
        <section className="grid items-center gap-10 md:grid-cols-2">
          <div>
            <h1 className="font-serif text-4xl font-medium leading-tight tracking-tight md:text-5xl">
              Know what you’re signing.
            </h1>
            <p className="mt-5 max-w-[36ch] text-lg leading-relaxed text-ink-muted">
              Upload your rental agreement before you sign. Every clause in
              plain words, unusual terms flagged, and answers grounded in your
              actual document.
            </p>
          </div>
          <SampleClause />
        </section>

        <section className="flex flex-col gap-6">
          <UploadDropzone />
          <Disclaimer />
        </section>

        <section aria-labelledby="what-happens">
          <h2 id="what-happens" className="font-serif text-xl font-medium">
            What happens after you upload
          </h2>
          <ol className="mt-4 flex list-decimal flex-col gap-2.5 pl-5 text-ink-muted [&::marker]:text-ink-muted/60">
            {STEPS.map((step) => (
              <li key={step} className="max-w-[62ch] leading-relaxed">
                {step}
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap justify-between gap-2 px-6 py-6 text-sm text-ink-muted">
          <span>{appName} is a hackathon project.</span>
          <span>Residential leases only — not other legal documents.</span>
        </div>
      </footer>
    </div>
  );
}

/*
 * Hero artefact: a synthetic sample clause (per the no-fabricated-legal-text
 * constraint, it is labelled as synthetic) showing the product's core move —
 * a flagged phrase plus its plain-language margin note.
 */
function SampleClause() {
  return (
    <figure className="relative rounded-lg border border-rule bg-card p-6">
      <figcaption className="pr-20 text-sm text-ink-muted">
        Sample clause — synthetic, not from a real agreement
      </figcaption>
      <span className="absolute right-6 top-5 rounded-full border border-unusual/40 px-2.5 py-0.5 text-sm text-unusual">
        unusual
      </span>
      <blockquote className="mt-4 font-serif text-lg leading-relaxed">
        <span className="text-ink-muted">11. </span>
        If the tenant wishes to vacate before the end of the term,{" "}
        <mark className="annotate-mark">
          two months’ rent shall be deducted from the security deposit
        </mark>
        .
      </blockquote>
      <p className="annotate-note mt-5 border-l-2 border-unusual/50 pl-4 font-serif text-base italic leading-relaxed text-ink-muted">
        In plain words: leave early and two months’ rent comes out of your
        deposit — the kind of term worth questioning before you sign.
      </p>
    </figure>
  );
}
