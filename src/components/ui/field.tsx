import { X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * M3のテキストフィールドの見た目をまとめる。Input / Textarea / Select で同じ形を使う。
 *
 * ラベルは枠線の上へ絶対配置せず、枠の中に通常のフローで積む。
 * 絶対配置は left/top が効かない環境で文字が縦に潰れる崩れ方をするうえ、
 * 枠線を切り欠く分だけ下地の色にも依存するため、この画面では採らない。
 */

/**
 * ラベル付きフィールドの外枠。
 *
 * `layout` はラベルと入力欄の積み方。既定の `stack` は縦に積むだけ、`row` は右端に
 * ✕（`FieldClearButton`）を並べるために横並びにし、ラベルと入力欄は呼び出し側が
 * 内側の縦積みへ入れる。`stack` の `flex-col` を `flex-row` で打ち消さないのは、
 * どちらも flex-direction で、どちらが勝つかがTailwindの出力順に依存するため
 * （クラスを書いた順では決まらない）。`items-*` も同じ理由で `row` の基底には
 * 入れず、呼び出し側で指定する。
 */
export function fieldShell(
  variant: "filled" | "outlined" | "flat" = "filled",
  className?: string,
  layout: "stack" | "row" = "stack",
) {
  return cn(
    "group/field flex w-full min-w-0 transition-colors",
    layout === "stack" ? "flex-col justify-center gap-0.5 px-4" : "flex-row gap-1 pr-1 pl-4",
    "has-disabled:pointer-events-none has-disabled:opacity-38",
    variant === "filled" &&
      // 下端の線をフォーカスで2dpへ太らせたいが、border幅を変えると中身が1pxずれる。
      // 既存の1px枠はそのままに、内側へもう1px重ねてshadowで太さを表現する。
      "rounded-t-xs border-b border-outline bg-muted hover:bg-muted/70 focus-within:border-primary focus-within:shadow-[inset_0_-1px_0_var(--color-primary)]",
    // Googleカレンダー風の行（issue #1563）。面も枠も持たず、行の区切り線は呼び出し側が引く。
    variant === "flat" &&
      "rounded-none border-b border-transparent bg-transparent px-0 focus-within:border-primary",
    variant === "outlined" &&
      "rounded-xs border border-outline bg-transparent hover:border-on-surface focus-within:border-primary focus-within:shadow-[inset_0_0_0_1px_var(--color-primary)]",
    "has-aria-invalid:border-destructive has-aria-invalid:shadow-[inset_0_0_0_1px_var(--color-destructive)]",
    className
  )
}

/** 枠の中の上部に置く見出し。常に表示して、何の欄か分からなくならないようにする。 */
export const fieldLabel =
  "truncate text-xs leading-4 text-muted-foreground select-none group-focus-within/field:text-primary group-has-aria-invalid/field:text-destructive"

/** 枠の中の入力部分。枠は外側が持つため、入力欄自身は線も背景も持たない。 */
export const fieldControl =
  "w-full min-w-0 border-0 bg-transparent p-0 text-base text-foreground outline-none placeholder:text-muted-foreground disabled:pointer-events-none md:text-sm"

/** `row` の枠の中で、ラベルと入力欄を縦に積む内側の箱。 */
export const fieldStack = "flex min-w-0 flex-1 flex-col justify-center gap-0.5"

/**
 * 入力欄の右端に置く ✕（issue #446）。文字が入っているときだけ出す。
 *
 * 押した時点で入力欄からフォーカスが外れると、場所欄では候補ごと閉じてしまう
 * （`location-input.tsx` の地図ボタン・候補ボタンと同じ理由で `preventDefault`）。
 * 色はM3のトレーリングアイコンに合わせ、ghostの `text-primary` から
 * `on-surface-variant` へ寄せる（競合するクラスは `cn` = tailwind-merge が後勝ちで解決する）。
 */
export function FieldClearButton({
  label,
  className,
  onClear,
}: {
  /** 何の欄を消すのか。読み上げのために欄の見出しをそのまま渡す。 */
  label: string
  className?: string
  onClear: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={`${label}を消す`}
      className={cn(
        "self-center text-on-surface-variant hover:bg-on-surface/8 hover:text-foreground active:bg-on-surface/12",
        className
      )}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClear}
    >
      <X />
    </Button>
  )
}
