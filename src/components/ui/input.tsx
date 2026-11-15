"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import {
  fieldShell,
  fieldLabel,
  fieldControl,
  fieldStack,
  FieldClearButton,
} from "@/components/ui/field"

// iOSのSafariは日付・時刻系inputを固有の幅で描画し、width:100% や min-width:0 を無視する。
// ネイティブの外観を切ると通常の要素として幅に従うため、この種のtypeだけ外観を落とす。
const NATIVE_SIZED_TYPES = new Set(["date", "time", "datetime-local", "month", "week"])

function Input({
  className,
  type,
  label,
  id,
  variant = "filled",
  onClear,
  ref,
  ...props
}: React.ComponentProps<"input"> & {
  label?: string
  /** M3のテキストフィールドは Filled と Outlined の2種類。ラベル付きの既定はFilled。 */
  variant?: "filled" | "outlined" | "flat"
  /**
   * 渡すと、文字が入っている間だけ右端に ✕ を出す（issue #446）。
   * 消したあとの値は呼び出し側が決めるため、ここでは空にする合図だけを渡す。
   * 枠を持たない（`label` の無い）形では出さない。✕ を置く右端がそもそも無いため。
   */
  onClear?: () => void
}) {
  const autoId = React.useId()
  const inputId = id ?? autoId

  // ✕ を押したあとはカーソルを欄へ戻す。そのまま打ち直せるようにするため。
  // 呼び出し側が渡す ref も潰さずに両方へ入れる（tag-picker が ref を渡している）。
  const innerRef = React.useRef<HTMLInputElement | null>(null)
  const setRef = (node: HTMLInputElement | null) => {
    innerRef.current = node
    if (typeof ref === "function") ref(node)
    else if (ref) ref.current = node
  }

  const inputEl = (
    <input
      id={inputId}
      type={type}
      data-slot="input"
      ref={setRef}
      className={cn(
        label ? cn(fieldControl, "h-6", variant === "flat" && "text-sm") : undefined,
        // 外観を落とすと iOS でも幅の指定どおりに描画され、ダイアログからはみ出さなくなる。
        type && NATIVE_SIZED_TYPES.has(type) && "appearance-none [-webkit-appearance:none]",
        !label &&
          "h-14 w-full min-w-0 rounded-xs border border-outline bg-transparent px-4 text-base text-foreground transition-colors outline-none placeholder:text-muted-foreground hover:border-on-surface focus-visible:border-primary focus-visible:shadow-[inset_0_0_0_1px_var(--color-primary)] disabled:pointer-events-none disabled:opacity-38 md:text-sm",
        className
      )}
      {...props}
    />
  )

  if (!label) return inputEl

  if (onClear === undefined) {
    return (
      <div data-slot="field" className={fieldShell(variant, variant === "flat" ? "h-10" : "h-14")}>
        <label htmlFor={inputId} className={fieldLabel}>
          {label}
        </label>
        {inputEl}
      </div>
    )
  }

  // 空の欄に ✕ は出さない。押しても何も起きないボタンを置かないため。
  // ただし枠の形は値の有無で変えない。同じ位置の子要素が label から div へ入れ替わると
  // Reactが input を作り直し、1文字目を打った瞬間にフォーカスと変換中の文字が飛ぶ。
  const showClear = String(props.value ?? "") !== ""

  return (
    <div data-slot="field" className={fieldShell(variant, variant === "flat" ? "h-10 items-center" : "h-14 items-center", "row")}>
      <div className={fieldStack}>
        <label htmlFor={inputId} className={fieldLabel}>
          {label}
        </label>
        {inputEl}
      </div>
      {showClear && (
        <FieldClearButton
          label={label}
          onClear={() => {
            onClear()
            innerRef.current?.focus()
          }}
        />
      )}
    </div>
  )
}

export { Input }
