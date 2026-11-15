import { Fragment } from "react";
import { ExternalLink } from "lucide-react";

import { splitTextWithLinks } from "@/lib/linkify";
import { cn } from "@/lib/utils";

/**
 * 説明・メモ欄など自由入力の複数行テキストを、折り返し・URLのリンク化を揃えて描画する（issue #833）。
 *
 * `whitespace-pre-wrap break-words` だけを場当たり的に足すと付け忘れが起きるため、この1箇所へ集約する。
 * `min-w-0` は常に足す（`flex-col` の直接の子になっている呼び出し元で、`overflow-wrap` だけでは
 * 長いURLがコンテナをはみ出す＝横スクロールする場合の保険。flexアイテムでなければ無害）。
 */
export function LinkifiedText({
  text,
  as: Tag = "p",
  className,
}: {
  text: string;
  as?: "p" | "span";
  className?: string;
}) {
  const segments = splitTextWithLinks(text);

  return (
    <Tag className={cn("min-w-0 break-words whitespace-pre-wrap", className)}>
      {segments.map((segment, index) =>
        segment.type === "link" ? (
          <a
            key={index}
            href={segment.label ?? segment.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xs text-primary underline decoration-primary/40 underline-offset-3 hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {segment.label ?? segment.url}
            <ExternalLink className="ml-1 inline size-3 shrink-0 align-[-1px]" />
          </a>
        ) : (
          <Fragment key={index}>{segment.value}</Fragment>
        ),
      )}
    </Tag>
  );
}
