"use client";

import { Ban, Equal, Menu, Minus, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * 優先度の選択（issue #1661）。セレクターではなく、押して選ぶバッジで出す。
 * 「なし」は2回押しで解除するのではなく専用のボタンにする。
 * 色だけに意味を持たせないよう、線の本数（高3・中2・低1）と文字を添える。
 */
const OPTIONS: {
  value: string | null;
  label: string;
  Icon: LucideIcon;
  idle: string;
  selected: string;
}[] = [
  { value: null, label: "なし", Icon: Ban, idle: "text-on-surface-variant", selected: "border-secondary-container bg-secondary-container text-on-secondary-container" },
  { value: "高", label: "高", Icon: Menu, idle: "text-error", selected: "border-error-container bg-error-container text-error" },
  { value: "中", label: "中", Icon: Equal, idle: "text-amber-700 dark:text-amber-400", selected: "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300" },
  { value: "低", label: "低", Icon: Minus, idle: "text-travel", selected: "border-travel/20 bg-travel/15 text-travel" },
];

export function TaskPriorityBadges({
  value,
  onChange,
  disabled,
}: {
  /** 「高」「中」「低」。未設定は null。 */
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="優先度" className="flex flex-wrap gap-2 py-1">
      {OPTIONS.map(({ value: optionValue, label, Icon, idle, selected }) => {
        const isSelected = optionValue === value;

        return (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={disabled}
            onClick={() => onChange(optionValue)}
            className={cn(
              "inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 text-sm select-none",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
              isSelected ? cn(selected, "font-bold") : "border-outline hover:bg-muted",
            )}
          >
            <Icon aria-hidden className={cn("size-4.5", !isSelected && idle)} strokeWidth={2.5} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
