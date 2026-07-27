"use client";

// Renders a ChatMessage.body: plain text plus @[refType:id:label] chips. A chip
// with a deep-link target becomes a clickable Link; people (and Phase-1 court
// designs) render as non-navigating pills.
import Link from "next/link";
import { parseTokens, deepLinkFor } from "@/lib/chat/tokens";

export default function MessageBody({ body }: { body: string | null }) {
  if (!body) return null;
  const tokens = parseTokens(body);
  const chip = "inline-flex items-center rounded px-1 py-0.5 text-[13px] font-medium bg-wa-green/10 text-wa-dark align-baseline";

  return (
    <span className="whitespace-pre-wrap break-words">
      {tokens.map((t, i) => {
        if (t.kind === "text") return <span key={i}>{t.text}</span>;
        const href = deepLinkFor(t.refType, t.id);
        const label = `@${t.label}`;
        return href ? (
          <Link key={i} href={href} className={`${chip} hover:underline`}>
            {label}
          </Link>
        ) : (
          <span key={i} className={chip}>
            {label}
          </span>
        );
      })}
    </span>
  );
}
