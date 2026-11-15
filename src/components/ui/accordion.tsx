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
  className,
}: {
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
    <div className={cn("rounded-xl border border-outline-variant", className)}>
      <button
        type="button"
        className="type-label-large flex min-h-11 w-full items-center justify-between gap-2 px-3 text-left"
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
      {expanded && <div className="flex flex-col gap-3 px-3 pb-3">{children}</div>}
    </div>
  );
}
