"use client";

import { Send01 } from "@untitledui/icons";
import Link from "next/link";
import { useState, useTransition } from "react";

import { publishFiltered, runFilter, type FilterResult } from "@/app/admin/actions";
import { RiskBadge } from "@/components/iltod/badges";
import { SpinMeter } from "@/components/iltod/spin-meter";
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "@/components/ui/conversation";
import { Message, MessageAvatar, MessageContent } from "@/components/ui/message";
import { Response } from "@/components/ui/response";
import { ShimmeringText } from "@/components/ui/shimmering-text";
import { tldrSentences } from "@/lib/format";

type ChatItem =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "assistant"; result: FilterResult; published?: string | null; publishError?: string };

let nextId = 1;

function ResultMessage({ item, onPublish, publishing }: { item: Extract<ChatItem, { role: "assistant" }>; onPublish: () => void; publishing: boolean }) {
  const r = item.result;
  if (!r.ok) {
    return (
      <Message from="assistant">
        <MessageContent>
          <p className="text-error-primary">⚠️ {r.error}</p>
        </MessageContent>
        <MessageAvatar src="/avatars/ai-tier1.svg" name="AI" />
      </Message>
    );
  }
  return (
    <>
      <Message from="assistant">
        <MessageContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <RiskBadge score={r.riskScore ?? 0} />
            <span className="text-xs text-tertiary">{r.providers} · ${r.costUsd?.toFixed(5)}</span>
          </div>
          <p className="font-semibold text-primary">{r.input?.title}</p>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {tldrSentences(r.tldr ?? "").map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          {r.facts && r.facts.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-success-primary">✅ Баримт</p>
              <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5">
                {r.facts.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="text-xs font-semibold text-warning-primary">🎭 Пи-ар шүүлтүүр</p>
            <p className="mt-1">{r.spin}</p>
          </div>
          <SpinMeter neutrality={r.neutrality ?? null} />
          {r.riskReason && <p className="text-xs text-tertiary">Эрсдэлийн үндэслэл: {r.riskReason}</p>}
        </MessageContent>
        <MessageAvatar src="/avatars/ai-tier1.svg" name="DS" />
      </Message>
      {r.deepMarkdown && (
        <Message from="assistant">
          <MessageContent>
            <p className="text-xs font-semibold text-tertiary uppercase">⚡ Гүнзгий шинжилгээ</p>
            <Response className="prose max-w-none">{r.deepMarkdown}</Response>
          </MessageContent>
          <MessageAvatar src="/avatars/ai-tier2.svg" name="Gk" />
        </Message>
      )}
      <div className="flex items-center gap-3 pb-2 pl-10">
        {item.published ? (
          <Link href={`/article/${item.published}`} className="text-sm font-semibold text-success-primary hover:underline">
            ✓ Нийтлэгдлээ: нийтлэлийг харах →
          </Link>
        ) : (
          <button
            type="button"
            onClick={onPublish}
            disabled={publishing}
            className="rounded-lg bg-brand-solid px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-solid_hover disabled:opacity-60"
          >
            {publishing ? "Нийтэлж байна…" : "Нийтлэх"}
          </button>
        )}
        {item.publishError && <p className="text-sm text-error-primary">{item.publishError}</p>}
      </div>
    </>
  );
}

export function FilterChat() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [draft, setDraft] = useState("");
  const [deep, setDeep] = useState(false);
  const [thinking, startThinking] = useTransition();
  const [publishingId, setPublishingId] = useState<number | null>(null);

  const submit = () => {
    const text = draft.trim();
    if (!text || thinking) return;
    setItems((xs) => [...xs, { id: nextId++, role: "user", text }]);
    setDraft("");
    startThinking(async () => {
      const result = await runFilter(text, deep);
      setItems((xs) => [...xs, { id: nextId++, role: "assistant", result }]);
    });
  };

  const publish = async (item: Extract<ChatItem, { role: "assistant" }>) => {
    const r = item.result;
    if (!r.ok || !r.input) return;
    setPublishingId(item.id);
    let res: Awaited<ReturnType<typeof publishFiltered>>;
    try {
      res = await publishFiltered({
      title: r.input.title,
      url: r.input.url,
      sourceDomain: r.input.sourceDomain,
      text: r.input.text,
      tldr: r.tldr ?? "",
      facts: r.facts ?? [],
      spin: r.spin ?? "",
      neutrality: r.neutrality ?? null,
      riskScore: r.riskScore ?? 0,
      amounts: r.amounts ?? [],
      deepMarkdown: r.deepMarkdown ?? null,
      });
    } catch (err) {
      // A thrown action (network, a server crash) used to leave the button on "publishing" for good.
      res = { ok: false, message: err instanceof Error ? err.message : String(err) };
    } finally {
      setPublishingId(null);
    }
    setItems((xs) => xs.map((x) => (x.id === item.id && x.role === "assistant" ? { ...x, published: res.ok ? res.slug : null, publishError: res.ok ? undefined : res.message } : x)));
  };

  return (
    <div className="flex h-[70vh] min-h-[520px] flex-col overflow-hidden rounded-3xl bg-primary ring-1 ring-secondary ring-inset">
      <Conversation className="flex-1">
        <ConversationContent className="flex flex-col">
          {items.length === 0 ? (
            <ConversationEmptyState
              icon={<span className="text-3xl">🧠</span>}
              title="Тархи угаалтын шүүлтүүр"
              description="Төрийн мэдээний URL эсвэл улс төрийн мэдэгдлийн текстийг оруулахад AI баримтыг пи-араас салгаж, эрсдэлтэй бол гүнзгий шинжилгээ хийнэ."
            />
          ) : (
            items.map((item) =>
              item.role === "user" ? (
                <Message key={item.id} from="user">
                  <MessageContent>
                    <p className="break-words whitespace-pre-wrap">{item.text.length > 600 ? `${item.text.slice(0, 600)}…` : item.text}</p>
                  </MessageContent>
                </Message>
              ) : (
                <ResultMessage key={item.id} item={item} publishing={publishingId === item.id} onPublish={() => publish(item)} />
              ),
            )
          )}
          {thinking && (
            <Message from="assistant">
              <MessageContent>
                <ShimmeringText text={deep ? "Баримтыг салгаад гүнзгий шинжилж байна…" : "Баримтыг пи-араас салгаж байна…"} />
              </MessageContent>
              <MessageAvatar src="/avatars/ai-tier1.svg" name="AI" />
            </Message>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <form
        className="flex flex-col gap-2 border-t border-secondary bg-secondary_alt p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          rows={3}
          placeholder="https://mof.gov.mn/... эсвэл мэдэгдлийн текст (Ctrl+Enter илгээх)"
          className="w-full resize-none rounded-xl bg-primary px-3.5 py-2.5 text-sm text-primary ring-1 ring-primary ring-inset outline-none focus:ring-2 focus:ring-brand"
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-secondary">
            <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} className="size-4" /> ⚡ Гүнзгий шинжилгээ заавал хийх
          </label>
          <button
            type="submit"
            disabled={thinking || !draft.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-white hover:bg-brand-solid_hover disabled:opacity-50"
          >
            Шинжлэх <Send01 className="size-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
