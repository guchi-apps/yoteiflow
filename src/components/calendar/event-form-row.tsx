import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * 予定の入力・表示画面の1行（issue #1563）。Googleカレンダーのように、左にアイコン列を置き、
 * 行どうしは区切り線だけで分ける。枠付きのカードや塗りの面は持たない。
 *
 * 中身が縮まない要素（保存先カレンダーのチップ列）を含むため、本文側に min-w-0 を置く。
 * `divider` を偽にすると上の線を引かない（先頭の行・直前の行と1まとまりの行）。
 */
export function FormRow({
  icon,
  children,
  divider = true,
  className,
}: {
  icon?: ReactNode;
  children: ReactNode;
  divider?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-start gap-3 py-1",
        divider && "border-t border-outline-variant",
        className,
      )}
    >
      <span
        aria-hidden
        className="flex h-10 w-6 shrink-0 items-center justify-center text-on-surface-variant [&_svg]:size-5"
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** 終日・仮予定の選択カード（issue #1568）。押すと色が変わり、選択中だと分かる。 */
export function ToggleCard({
  pressed,
  onToggle,
  children,
}: {
  pressed: boolean;
  onToggle: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      className={cn(
        "min-h-10 rounded-lg border px-4 text-sm transition-colors select-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        pressed
          ? "border-primary-container bg-primary-container font-bold text-on-primary-container"
          : "border-outline text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
