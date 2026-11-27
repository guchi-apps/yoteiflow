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
  defaultOpen = false,
  action,
  badge,
  className,
}: {
  /** 見出しの後ろに添える印（「要確認」など・issue #1759）。未指定なら何も出さない。 */
  badge?: ReactNode;
  /** 最初から開いておく（既定は閉じる）。持ち物のように、中身を先に見せたい欄で使う（issue #1567）。 */
  defaultOpen?: boolean;
  /** 見出し行の右端（開閉の矢印の左）に置く操作。見出しのボタンの外に置くため、押しても開閉しない。 */
  action?: ReactNode;
  /** 枠を持たず、上の区切り線だけの行にする（予定の表示画面・issue #1563）。 */
  flat?: boolean;
  title: string;
  /** 見出しの右に添える一言。閉じていても何が入っているか分かるようにする。 */
  description?: string;
  children: ReactNode;
  forceOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const expanded = open || forceOpen;

  return (
    <div
      className={cn(
        flat ? "border-t border-outline-variant" : "rounded-xl border border-outline-variant",
        className,
      )}
    >
      <div className="flex min-h-11 items-center gap-1">
        <button
          type="button"
          className={cn(
            "type-label-large flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 text-left",
            flat ? "px-0" : "px-3",
          )}
          aria-expanded={expanded}
          onClick={() => setOpen(!expanded)}
        >
          <span className="flex min-w-0 items-baseline gap-2">
            {title}
            {badge}
            {description && (
              <span className="type-body-small truncate font-normal text-on-surface-variant">{description}</span>
            )}
          </span>
          {!action && (
            <ChevronDown className={cn("size-4 shrink-0 transition-transform", expanded && "rotate-180")} />
          )}
        </button>
        {action}
        {action && (
          <button
            type="button"
            aria-label={expanded ? "閉じる" : "開く"}
            className="flex size-9 shrink-0 items-center justify-center"
            onClick={() => setOpen(!expanded)}
          >
            <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} />
          </button>
        )}
      </div>
      {expanded && (
        <div className={cn("flex flex-col gap-3 pb-3", flat ? "px-0" : "px-3")}>{children}</div>
      )}
    </div>
  );
}
