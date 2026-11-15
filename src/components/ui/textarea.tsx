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

function Textarea({
  className,
  label,
  id,
  variant = "filled",
  onClear,
  ref,
  ...props
}: React.ComponentProps<"textarea"> & {
  label?: string
  variant?: "filled" | "outlined" | "flat"
  /** 渡すと、文字が入っている間だけ右上に ✕ を出す（issue #446）。Input と同じ扱い。 */
  onClear?: () => void
}) {
  const autoId = React.useId()
  const textareaId = id ?? autoId

  // ✕ を押したあとはカーソルを欄へ戻す。呼び出し側の ref も潰さない。
  const innerRef = React.useRef<HTMLTextAreaElement | null>(null)
  const setRef = (node: HTMLTextAreaElement | null) => {
    innerRef.current = node
    if (typeof ref === "function") ref(node)
    else if (ref) ref.current = node
  }

  const textareaEl = (
    <textarea
      id={textareaId}
      data-slot="textarea"
      ref={setRef}
      className={cn(
        label
          ? cn(fieldControl, "field-sizing-content min-h-16 resize-none", variant === "flat" && "min-h-12 text-sm")
          : "flex field-sizing-content min-h-16 w-full rounded-xs border border-outline bg-transparent px-4 py-3 text-base transition-colors outline-none placeholder:text-muted-foreground hover:border-on-surface focus-visible:border-primary focus-visible:shadow-[inset_0_0_0_1px_var(--color-primary)] disabled:cursor-not-allowed disabled:border-outline/38 disabled:opacity-38 aria-invalid:border-destructive aria-invalid:shadow-[inset_0_0_0_1px_var(--color-destructive)] md:text-sm",
        className
      )}
      {...props}
    />
  )

  if (!label) return textareaEl

  if (onClear === undefined) {
    return (
      <div data-slot="field" className={fieldShell(variant, variant === "flat" ? "py-1" : "py-2")}>
        <label htmlFor={textareaId} className={fieldLabel}>
          {label}
        </label>
        {textareaEl}
      </div>
    )
  }

  // 値の有無で枠の形は変えない（Input と同じ。入れ替えると textarea が作り直される）。
  const showClear = String(props.value ?? "") !== ""

  return (
    // 複数行の欄では ✕ を上端へ寄せる。行が増えても押す位置が動かないようにするため。
    <div data-slot="field" className={fieldShell(variant, variant === "flat" ? "items-start py-1" : "items-start py-2", "row")}>
      <div className={fieldStack}>
        <label htmlFor={textareaId} className={fieldLabel}>
          {label}
        </label>
        {textareaEl}
      </div>
      {showClear && (
        <FieldClearButton
          label={label}
          className="self-start"
          onClear={() => {
            onClear()
            innerRef.current?.focus()
          }}
        />
      )}
    </div>
  )
}

export { Textarea }
