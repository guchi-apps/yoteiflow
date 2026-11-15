"use client";

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * 見出しを押して中身を開閉する枠。入力ダイアログの補助的な欄を、既定では畳んで見せないために使う。
 * `forceOpen` の間は閉じられない（入力エラーなど、見えないと気付けない内容があるとき）。
 */
export function Accordion({
  title,
  description,
  children,
  forceOpen = false,
  flat = false,
  className,
}: {
  /** 枠を持たず、上の区切り線だけの行にする（予定の表示画面・issue #1563）。 */
  flat?: boolean;
  title: string;
  /** 見出しの右に添える一言。閉じていても何が入っているか分かるようにする。 */
  description?: string;
  children: ReactNode;
  forceOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const expanded = open || forceOpen;

  return (
    <div
      className={cn(
        flat ? "border-t border-outline-variant" : "rounded-xl border border-outline-variant",
        className,
      )}
    >
      <button
        type="button"
        className={cn(
          "type-label-large flex min-h-11 w-full items-center justify-between gap-2 text-left",
          flat ? "px-0" : "px-3"
        )}
        aria-expanded={expanded}
        onClick={() => setOpen(!expanded)}
      >
        <span className="flex min-w-0 items-baseline gap-2">
          {title}
          {description && (
            <span className="type-body-small truncate font-normal text-on-surface-variant">{description}</span>
          )}
        </span>
        <ChevronDown className={cn("size-4 shrink-0 transition-transform", expanded && "rotate-180")} />
      </button>
      {expanded && (
        <div className={cn("flex flex-col gap-3 pb-3", flat ? "px-0" : "px-3")}>{children}</div>
      )}
    </div>
  );
}
