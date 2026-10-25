"use client";

import { useRef, useState } from "react";
import { Check, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { TagOption } from "@/services/notion/tag-options";

import { tagChipClass, tagColorOf } from "./tag-color";

/**
 * 登録済みのタグ・種類から選ぶ入力欄（docs/spec.md §9）。
 *
 * 文字で書かせず選ばせるのは、同じつもりの名前が「仕事」「しごと」のように増えていくため。
 * 一方で、入力の途中に思いついた名前をその場で使えないと、閉じて設定画面へ回ることになる。
 * 登録済みは押して選ぶ、無い名前はここから足す、の両方を持たせる。
 *
 * ここで足した名前はNotionが選択肢として登録する（色はNotionが決める）。色を選んで
 * 登録したい場合は設定画面から行う。
 */
export function TagPicker({
  label,
  options,
  value,
  multiple,
  allowAdd = true,
  onChange,
}: {
  label: string;
  /** 登録済みの選択肢。 */
  options: TagOption[];
  /** 選択中の名前。multiple が false のときは0件か1件。 */
  value: string[];
  multiple: boolean;
  /** false のときは新しい名前を足す入力を出さない（選択肢が固定のとき）。 */
  allowAdd?: boolean;
  onChange: (next: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // 登録済みに無い名前も選択中でありうる（Notion側で直接付けた・この画面で足した）。
  // 消せなくなるので、登録済みの下に並べて同じように扱う。
  const extras = value.filter((name) => !options.some((option) => option.name === name));

  const toggle = (name: string) => {
    if (value.includes(name)) {
      onChange(value.filter((item) => item !== name));
      return;
    }
    onChange(multiple ? [...value, name] : [name]);
  };

  const commitDraft = () => {
    const name = draft.trim();
    if (!name) {
      setAdding(false);
      return;
    }

    if (!value.includes(name)) {
      onChange(multiple ? [...value, name] : [name]);
    }
    setDraft("");
    // 続けて足せるよう入力欄は開いたままにする。タグは複数付けることが多い。
    inputRef.current?.focus();
  };

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label>{label}</Label>

      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {options.map((option) => (
          <TagToggle
            key={option.id}
            name={option.name}
            selected={value.includes(option.name)}
            colorClass={tagChipClass(option.color)}
            onClick={() => toggle(option.name)}
          />
        ))}

        {extras.map((name) => (
          <TagToggle
            key={`extra-${name}`}
            name={name}
            selected
            colorClass={tagChipClass(tagColorOf(options, name))}
            onClick={() => toggle(name)}
          />
        ))}

        {allowAdd && !adding && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="h-8 rounded-md border-outline px-2"
            onClick={() => {
              setAdding(true);
              // 描画されてから当てる。開いた直後に入力を始められるようにする。
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
          >
            <Plus className="size-4" />
            追加
          </Button>
        )}
      </div>

      {allowAdd && adding && (
        <div className="flex min-w-0 items-center gap-2">
          <Input
            ref={inputRef}
            aria-label={`新しい${label}`}
            placeholder="新しい名前"
            className="h-10 min-w-0 flex-1"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // ダイアログの中にいる。Enterで保存まで走らないよう、ここで止める。
              if (event.key === "Enter") {
                event.preventDefault();
                commitDraft();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setDraft("");
                setAdding(false);
              }
            }}
          />
          <Button type="button" variant="secondary" size="sm" onClick={commitDraft}>
            追加
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="追加をやめる"
            onClick={() => {
              setDraft("");
              setAdding(false);
            }}
          >
            <X className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

/** 選ぶと色が付き、押し直すと外れるチップ。選択中かどうかを色の有無で示す。 */
function TagToggle({
  name,
  selected,
  colorClass,
  onClick,
}: {
  name: string;
  selected: boolean;
  colorClass: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "type-label-large flex h-8 max-w-full min-w-0 items-center gap-1 rounded-md px-2 transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        selected ? colorClass : "border border-outline text-on-surface-variant hover:bg-muted",
      )}
    >
      {selected && <Check className="size-3.5 shrink-0" aria-hidden />}
      <span className="truncate">{name}</span>
    </button>
  );
}
