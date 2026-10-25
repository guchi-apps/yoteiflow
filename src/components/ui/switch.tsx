"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        // M3のスイッチ。トラックは52×32dp。選択時はトラックの縁がなくなり塗りつぶしだけになる。
        "group/switch peer relative inline-flex h-8 w-13 shrink-0 items-center rounded-full border-2 border-outline transition-colors outline-none",
        "focus-visible:ring-3 focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        "data-checked:border-primary data-checked:bg-primary data-unchecked:bg-surface-container-highest",
        "data-disabled:cursor-not-allowed data-disabled:opacity-38",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "relative block size-4 translate-x-1.5 rounded-full bg-outline transition-all",
          // 選択時はつまみが24dpまで大きくなり、右端から4dpの位置に寄る（縁2px＋22px）。未選択は左端から8dp（縁2px＋6px）。
          "group-data-checked/switch:size-6 group-data-checked/switch:translate-x-[22px] group-data-checked/switch:bg-primary-foreground",
          // 状態レイヤー。つまみを40dp円で囲み、ホバー・フォーカス・押下で薄く色を乗せる。
          "before:absolute before:inset-[-12px] before:rounded-full before:bg-on-surface before:opacity-0 before:transition-opacity",
          "group-hover/switch:before:opacity-8 group-focus-visible/switch:before:opacity-10 group-active/switch:before:opacity-10",
          "group-data-checked/switch:before:inset-[-8px] group-data-checked/switch:before:bg-primary",
          "group-data-disabled/switch:before:opacity-0"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
