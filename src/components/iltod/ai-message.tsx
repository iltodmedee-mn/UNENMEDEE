import { Message, MessageAvatar, MessageContent } from "@/components/ui/message";
import { cx } from "@/utils/cx";

/**
 * Every AI-generated block renders as an ElevenLabs UI <Message> so readers can always
 * tell machine analysis apart from the government's original text. Markdown bodies go through
 * `AIMarkdownMessage` (ai-markdown.tsx): streamdown is large, so this file must not import it
 * (the home page's StoryList ships AIMessage to the browser).
 *
 * The header is a mono label with an optional right-hand note (the model that wrote it, or the
 * "AI-ийн үнэлгээ, буруутгал биш" reminder).
 */
export function AIMessage({
  tier,
  title,
  note,
  children,
  compact = false,
  className,
}: {
  tier: "tier1" | "tier2";
  title: string;
  note?: React.ReactNode;
  children?: React.ReactNode;
  /** Full width, no avatar column (inline summaries in the story list on phones). */
  compact?: boolean;
  className?: string;
}) {
  return (
    <Message from="assistant" className={cx("py-2", className)}>
      <MessageContent variant="contained" className="max-w-full flex-1 px-4 py-3.5 sm:px-5 sm:py-4">
        <p className="label-mono flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-tertiary">
          <span>{title}</span>
          {note && <span className="normal-case">{note}</span>}
        </p>
        {children}
      </MessageContent>
      {/* Phones get the full width for the text: the avatar column took 40 px from every AI block. */}
      {!compact && <MessageAvatar className="max-sm:hidden" src={tier === "tier2" ? "/avatars/ai-tier2.svg" : "/avatars/ai-tier1.svg"} name="AI" />}
    </Message>
  );
}

/** The brand square bullet list every AI summary uses. */
export function AIBullets({ items, className, render }: { items: string[]; className?: string; render?: (item: string, index: number) => React.ReactNode }) {
  return (
    <ul className={cx("mt-2 flex flex-col gap-2 text-md text-primary", className)}>
      {items.map((b, i) => (
        <li key={b} className="flex gap-2.5">
          <span aria-hidden className="mt-[0.55em] size-2 shrink-0 rounded-[2px] bg-brand-solid" />
          <span>{render ? render(b, i) : b}</span>
        </li>
      ))}
    </ul>
  );
}
