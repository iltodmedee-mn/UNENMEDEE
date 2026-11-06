"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useActionState, useState } from "react";

import { saveArticle, type ActionResult } from "@/app/admin/actions";

const field = "w-full rounded-lg bg-primary px-3.5 py-2.5 text-sm text-primary shadow-xs ring-1 ring-primary ring-inset outline-none focus:ring-2 focus:ring-brand";

function toHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .split(/\n+/)
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join("");
}

export function ArticleEditor({ article }: { article: { id: number; title: string; tldr: string; content: string; isPublished: boolean; readerTitle: string | null; hasImpact: boolean } }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveArticle, null);
  const [content, setContent] = useState(article.content);
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [2, 3] } })],
    content: toHtml(article.content),
    immediatelyRender: false,
    editorProps: { attributes: { class: "prose max-w-none min-h-80 p-4 outline-none" } },
    // Stored as clean text (CLAUDE.md rule #3): paragraphs separated by blank lines.
    onUpdate: ({ editor: e }) => setContent(e.getText({ blockSeparator: "\n\n" })),
  });

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="id" value={article.id} />
      <input type="hidden" name="content" value={content} />
      <label className="flex flex-col gap-1.5 text-sm font-medium text-secondary">
        Гарчиг
        <input name="title" defaultValue={article.title} required minLength={5} className={field} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-secondary">
        TL;DR (мөр бүр нэг өгүүлбэр)
        <textarea name="tldr" defaultValue={article.tldr} rows={4} className={field} />
      </label>
      <div className="flex flex-col gap-1.5 text-sm font-medium text-secondary">
        Текст
        <div className="rounded-lg bg-primary ring-1 ring-primary ring-inset focus-within:ring-2 focus-within:ring-brand">
          <div className="flex gap-1 border-b border-secondary p-2">
            {[
              ["B", () => editor?.chain().focus().toggleBold().run()],
              ["I", () => editor?.chain().focus().toggleItalic().run()],
              ["H2", () => editor?.chain().focus().toggleHeading({ level: 2 }).run()],
              ["•", () => editor?.chain().focus().toggleBulletList().run()],
            ].map(([label, run]) => (
              <button key={label as string} type="button" onClick={run as () => void} className="rounded px-2 py-1 text-xs font-semibold text-secondary hover:bg-primary_hover">
                {label as string}
              </button>
            ))}
          </div>
          <EditorContent editor={editor} />
        </div>
        <p className="text-xs font-normal text-tertiary">
          Текстийг засвал нийтлэл дээр &quot;редакцийн засвартай&quot; гэж ил харагдана. SHA-256 хэш нь анх татсан эх текстийг баталсан хэвээр үлдэнэ.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm text-secondary">
        <input type="checkbox" name="published" defaultChecked={article.isPublished} className="size-4" /> Нийтэд харагдана
      </label>
      {(article.readerTitle || article.hasImpact) && (
        <label className="flex items-start gap-2 text-sm text-secondary">
          <input type="checkbox" name="clearReader" className="mt-0.5 size-4" />
          <span>
            AI-ийн энгийн гарчиг{article.readerTitle ? ` («${article.readerTitle}»)` : ""}
            {article.hasImpact ? " болон «Танд хамаатай юу?»" : ""}-г хасах. Уншигчид одоо тэдгээрийг харж байна; гарчгийг өөрчилбөл энгийн гарчиг өөрөө хасагдана.
          </span>
        </label>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-lg bg-brand-solid px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-solid_hover disabled:opacity-60">
          {pending ? "Хадгалж байна…" : "Хадгалах"}
        </button>
        {state && <p className={state.ok ? "text-sm text-success-primary" : "text-sm text-error-primary"}>{state.message}</p>}
      </div>
    </form>
  );
}
