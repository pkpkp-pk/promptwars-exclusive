import type { Metadata } from "next";
import Link from "next/link";
import ReviewDocument from "@/components/ReviewDocument";
import { getClauses, getDocument } from "@/lib/store";

export const metadata: Metadata = {
  title: "Lease review",
};

/*
 * /review/[docId] — Phase 4. Passes along whatever the session store has
 * (clause text renders instantly when this function shares the store with
 * the API routes); the client container then drives classification via
 * /api/classify, so the page also works when it renders in a different
 * function than the store-owning one.
 */
export default async function ReviewPage({ params }: PageProps<"/review/[docId]">) {
  const { docId } = await params;
  const document = getDocument(docId);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <Link
        href="/"
        className="text-sm text-ink-muted underline underline-offset-2 hover:text-ink"
      >
        ← Upload another lease
      </Link>
      <div className="mt-8">
        <ReviewDocument
          docId={docId}
          filename={document?.filename}
          initialClauses={getClauses(docId)}
        />
      </div>
    </main>
  );
}
