"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * 選択肢1つぶんのチップ。
 *
 * **色を持つのは選ばれているものだけ**にする（issue #570）。以前は逆で、未選択がNotionの
 * タグ色で塗られ、選択中だけが secondary-container だった。色付きが並ぶ中でいちばん色の弱い
 * ものが選択中という並びになり、押した手応えが色に出ない。タスクのタグ選び
 * （`components/tags/tag-picker.tsx` の `TagToggle`）は既にこの規則で、同じ操作の見え方が
 * アプリの中で2通りある状態でもあった。
 *
 * 手掛かりは3つ重ねる。塗り（選んだものだけ色を持つ）、チェック（色を読み分けにくい状況でも
 * 分かる。色だけに意味を持たせない）、輪郭（タグ色の塗りは18%と淡く、塗りだけでは枠が立たない）。
 *
 * タグ色を持たない選択肢（未設定・購入予定日・優先度）は、選択中を secondary-container で塗る。
 */
export function ChoiceChip({
  selected,
  colorClass,
  onClick,
  children,
}: {
  selected: boolean;
  /** Notionのタグ色。持たない選択肢では省く。 */
  colorClass?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "type-label-large flex items-center gap-1 rounded-md border px-3 py-1 transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        selected
          ? cn(
              "border-current font-medium",
              colorClass ?? "bg-secondary-container text-on-secondary-container",
            )
          : "border-outline-variant text-on-surface-variant hover:bg-on-surface/8",
      )}
    >
      {selected && <Check className="size-3.5 shrink-0" aria-hidden />}
      {children}
    </button>
  );
}
