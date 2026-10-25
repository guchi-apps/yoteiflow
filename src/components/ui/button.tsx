import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // M3のボタン。押下時は状態レイヤーで反応を示す。角は完全な丸ではなく8pxの角丸にする
  // （丸みが強すぎるため・issue #1383）。
  // 押している間だけ角丸を詰める（M3 Expressive のシェイプモーフ・issue #705）。押した手応えを
  // 色の変化だけでなく形でも返す。`rounded-*` を上書きしている呼び出し側には効かない。
  "group/button relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md active:rounded-sm border border-transparent text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-38 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px]",
  {
    variants: {
      variant: {
        // Filled: 主要な操作。1画面に1つを目安にする。
        default: "bg-primary text-primary-foreground hover:brightness-95 active:brightness-90",
        // Tonal: 主要ではないが目立たせたい操作。
        secondary:
          "bg-secondary-container text-on-secondary-container hover:brightness-95 active:brightness-95",
        outline:
          "border-outline bg-transparent text-primary hover:bg-primary/8 active:bg-primary/12",
        ghost: "bg-transparent text-primary hover:bg-primary/8 active:bg-primary/12",
        destructive:
          "bg-transparent text-destructive hover:bg-destructive/8 active:bg-destructive/12",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // M3の標準は高さ40dp。密度の高い場所では下の小さいサイズを使う。
        default: "h-10 gap-2 px-6 has-[>svg]:pl-4",
        xs: "h-7 gap-1 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-4",
        sm: "h-8 gap-1.5 px-4 text-[13px] [&_svg:not([class*='size-'])]:size-4",
        lg: "h-12 gap-2 px-6 text-base",
        icon: "size-10",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-4",
        "icon-sm": "size-9 [&_svg:not([class*='size-'])]:size-5",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
