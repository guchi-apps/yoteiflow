import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * ヘッダー右上の再取得ボタン（issue #1271）。
 *
 * 取得中・保存中はアイコンが回り、それだけで「画面を更新している」ことを示す。以前はヘッダー
 * 直下に横へ流れるバー（`LinearProgress`）を出していたが、更新の入口と更新中の印が別の場所に
 * あり、押した操作との結び付きが読めなかったため、ボタンそのものへ寄せた。
 *
 * 回っている間は押しても何もしないが、`disabled` にはしない。`disabled` にすると基底の
 * `disabled:opacity-38` で薄くなり、回っている印そのものが見えにくくなる。押せないことは
 * `aria-disabled` で伝える。`disabled` は回っていないのに押せないとき（オフライン）にだけ使う。
 */
export function RefreshButton({
  spinning,
  disabled = false,
  onClick,
  className,
}: {
  spinning: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("size-10 md:size-9", className)}
      disabled={disabled && !spinning}
      aria-disabled={spinning || undefined}
      aria-busy={spinning}
      aria-label={spinning ? "更新中" : "再取得"}
      onClick={() => {
        if (!spinning) onClick();
      }}
    >
      <RefreshSpinIcon spinning={spinning} />
    </Button>
  );
}

/**
 * 回る更新アイコン。読み込み中の骨組み（`loading.tsx`）は押せる要素を持たないため、
 * ボタンを置かずアイコンだけをヘッダー右上へ置く。
 */
export function RefreshSpinIcon({ spinning, className }: { spinning: boolean; className?: string }) {
  return (
    <RefreshCw
      aria-hidden
      className={cn(
        "size-5",
        spinning && "animate-spin text-primary motion-reduce:[animation-duration:2.4s]",
        className,
      )}
    />
  );
}

/** 骨組みのヘッダー右上に置く、回り続ける更新アイコン。 */
export function LoadingRefreshMark({ className }: { className?: string }) {
  return (
    <span
      role="progressbar"
      aria-label="読み込み中"
      className={cn("grid size-10 shrink-0 place-items-center md:size-9", className)}
    >
      <RefreshSpinIcon spinning />
    </span>
  );
}
