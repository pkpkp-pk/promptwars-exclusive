"use client";

import { useMemo, useState } from "react";
import { MessageCircleQuestion, Send } from "lucide-react";
import type { Clause, QAExchange } from "@/lib/types";

/*
 * Grounded Q&A panel (Phase 5). Posts to /api/ask, which retrieves the
 * top-k clauses by embedding similarity before any generation call — an
 * off-document question comes back grounded: false with a referral, never a
 * guess (AGENTS2.md constraint 2). Every grounded answer renders its cited
 * clauses as jump links into the clause list above, so a claim is one click
 * away from its source text.
 */

interface ChatMessage extends QAExchange {
  id: number;
}

export default function ChatPanel({
  docId,
  clauses,
}: {
  docId: string;
  clauses: Clause[];
}) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    const trimmed = question.trim();
    if (!trimmed || asking) return;
    setAsking(true);
    setError(null);
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ docId, question: trimmed }),
      });
      if (!response.ok) {
        let message = "Something went wrong while answering. Please try again.";
        try {
          const body = (await response.json()) as { error?: string };
          if (body.error) message = body.error;
        } catch {
          // Non-JSON error body — keep the generic message.
        }
        throw new Error(message);
      }
      const exchange = (await response.json()) as QAExchange;
      setMessages((prev) => [...prev, { ...exchange, id: Date.now() }]);
      setQuestion("");
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Please try again.");
    } finally {
      setAsking(false);
    }
  };

  // Rebuilt only when the clause list changes, not per keystroke.
  const clauseById = useMemo(
    () => new Map(clauses.map((clause) => [clause.id, clause])),
    [clauses],
  );

  return (
    <section aria-label="Ask questions about this document" className="flex flex-col gap-4 rounded-2xl border border-rule bg-card p-5">
      <h2 className="flex items-center gap-2 font-serif text-xl font-medium text-ink">
        <MessageCircleQuestion className="h-5 w-5 text-ink-muted" aria-hidden />
        Ask your document
      </h2>

      {messages.map((message) => (
        <div key={message.id} className="flex flex-col gap-2 border-t border-rule pt-4">
          <p className="font-medium text-ink">{message.question}</p>
          <p className={message.grounded ? "text-ink" : "text-ink-muted italic"}>
            {message.answer}
          </p>
          {message.grounded && message.citedClauseIds.length > 0 ? (
            <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
              Based on:
              {message.citedClauseIds.map((id) => {
                const clause = clauseById.get(id);
                return (
                  <a
                    key={id}
                    href={`#clause-${id}`}
                    className="rounded-full border border-rule px-2 py-0.5 text-xs underline-offset-2 hover:underline"
                  >
                    Clause {clause !== undefined ? clause.order + 1 : "?"}
                  </a>
                );
              })}
            </p>
          ) : null}
        </div>
      ))}

      {error ? (
        <p role="alert" className="text-sm text-risky">{error}</p>
      ) : null}

      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        <input
          type="text"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="e.g. What’s the notice period?"
          aria-label="Question about the document"
          maxLength={1000}
          className="min-w-0 flex-1 rounded-md border border-rule bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        />
        <button
          type="submit"
          disabled={asking || question.trim().length === 0}
          className="flex items-center gap-1.5 rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper transition-opacity hover:opacity-85 disabled:opacity-50"
        >
          <Send className="h-4 w-4" aria-hidden />
          {asking ? "Asking…" : "Ask"}
        </button>
      </form>
    </section>
  );
}
