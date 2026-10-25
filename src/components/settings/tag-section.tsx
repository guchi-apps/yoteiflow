"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, ExternalLink, Pencil, Plus, Trash2, X } from "lucide-react";

import { TagChip } from "@/components/tags/tag-chip";
import { tagSwatchClass } from "@/components/tags/tag-color";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  TAG_COLORS,
  TAG_COLOR_LABELS,
  type TagColor,
  type TagKind,
  type TagOption,
} from "@/services/notion/tag-options";

export type TagSectionState = {
  kind: TagKind;
  title: string;
  description: string;
  /** 選択肢を持つプロパティが無い場合は null。何を用意すればよいかを案内する。 */
  options: TagOption[] | null;
  missingMessage: string;
  /** Notion側で色を直してもらうための入口。DBが未選択なら null。 */
  databaseUrl: string | null;
};

/**
 * タグ・種類の一覧と、その追加・削除・改名・並び替え（docs/spec.md §9）。
 *
 * 色を変えられるのは追加のときだけ。Notion APIが既存の選択肢の色の変更を拒むため
 * （`Cannot update color of select with id: ...`）。作り直せば変えられるが、選択肢を消すと
 * それが付いていた既存ページからも外れてしまうので、DaySpanからはやらない。
 *
 * 名前と並び順はIDで指して書き戻すため、既存ページから外れない。並び順は入力画面の
 * チップ・買い物のカテゴリのタブ（§36）の並びをそのまま決める。
 */
export function TagSection({ state }: { state: TagSectionState }) {
  const router = useRouter();

  const [options, setOptions] = useState(state.options);
  const [name, setName] = useState("");
  const [color, setColor] = useState<TagColor>("default");
  // 改名の欄は押されたときだけ出す。全行に入力欄を並べると、一覧を読むための画面が
  // 入力の画面に変わってしまう。
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (request: Promise<Response>) => {
    setBusy(true);
    setError(null);
    try {
      const response = await request;
      const body = (await response.json().catch(() => null)) as {
        options?: TagOption[];
        message?: string;
      } | null;

      if (!response.ok) {
        setError(body?.message ?? "Notionへ反映できませんでした。");
        return false;
      }

      setOptions(body?.options ?? []);
      // 入力画面や一覧が持っている候補も古くなる。サーバー側の取得をやり直させる。
      router.refresh();
      return true;
    } catch {
      setError("Notionへ反映できませんでした。");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    if (options?.some((option) => option.name === trimmed)) {
      setError(`「${trimmed}」はすでにあります。`);
      return;
    }

    const added = await send(
      fetch("/api/notion/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: state.kind, name: trimmed, color }),
      }),
    );

    if (added) setName("");
  };

  const remove = async (target: string) => {
    // Notionでは選択肢を消すと、それが付いていたページからも外れる。取り消せないため確認する。
    const confirmed = window.confirm(
      `「${target}」を削除します。\nこれが付いているNotionのページからも外れます。よろしいですか？`,
    );
    if (!confirmed) return;

    await send(
      fetch(
        `/api/notion/tags?kind=${state.kind}&name=${encodeURIComponent(target)}`,
        { method: "DELETE" },
      ),
    );

  };

  const startRename = (option: TagOption) => {
    setEditingId(option.id);
    setEditingName(option.name);
    setError(null);
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditingName("");
  };

  /**
   * 名前を変える。
   *
   * IDで指すため、それが付いているNotionのページの値も一緒に変わる（選択肢を消して
   * 作り直すのとは違い、ページから外れない）。
   */
  const rename = async (option: TagOption) => {
    const trimmed = editingName.trim();
    if (!trimmed || trimmed === option.name) {
      cancelRename();
      return;
    }

    const renamed = await send(
      fetch("/api/notion/tags", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: state.kind, optionId: option.id, name: trimmed }),
      }),
    );

    if (!renamed) return;
    cancelRename();
  };

  /**
   * 1つぶん上下へ動かす。
   *
   * ドラッグにしないのは、この一覧が縦スクロールの中にあり、掴んだつもりのスクロールと
   * 取り違えやすいため（同じ理由でカレンダーの一覧でもドラッグを避けている）。
   * 送るのは並べ替えたあとの全件のIDで、Notionはその順をそのまま定義順にする。
   */
  const move = async (index: number, delta: number) => {
    if (!options) return;
    const target = index + delta;
    if (target < 0 || target >= options.length) return;

    const reordered = [...options];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved);

    await send(
      fetch("/api/notion/tags", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: state.kind, order: reordered.map((item) => item.id) }),
      }),
    );
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="type-title-medium">{state.title}</h2>
          <p className="type-body-small text-on-surface-variant">{state.description}</p>
        </div>

        {error && (
          <p className="type-body-medium rounded-lg bg-error-container/70 px-3 py-2 text-on-error-container">
            {error}
          </p>
        )}

        {options === null ? (
          <p className="type-body-medium text-on-surface-variant">{state.missingMessage}</p>
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-rule">
              {options.map((option, index) => (
                <li key={option.id} className="flex flex-col gap-1 py-2">
                  {editingId === option.id ? (
                    <div className="flex min-w-0 items-center gap-2">
                      <Input
                        className="h-10 min-w-0 flex-1"
                        aria-label={`${option.name} の名前`}
                        value={editingName}
                        disabled={busy}
                        autoFocus
                        onChange={(event) => setEditingName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            rename(option);
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            cancelRename();
                          }
                        }}
                      />
                      <Button
                        size="icon-sm"
                        aria-label="名前を保存"
                        disabled={busy || !editingName.trim()}
                        onClick={() => rename(option)}
                      >
                        <Check className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="やめる"
                        disabled={busy}
                        onClick={cancelRename}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex min-w-0 items-center gap-2">
                      <TagChip name={option.name} color={option.color} />
                      <span className="type-body-small text-on-surface-variant">
                        {TAG_COLOR_LABELS[option.color]}
                      </span>
                      <span className="flex-1" />
                      {/* 並び替えは1つずつ。この一覧は縦スクロールの中にあり、ドラッグにすると
                          掴んだつもりのスクロールと取り違えやすい。 */}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${option.name} を上へ`}
                        disabled={busy || index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${option.name} を下へ`}
                        disabled={busy || index === options.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${option.name} の名前を変更`}
                        disabled={busy}
                        onClick={() => startRename(option)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="destructive"
                        size="icon-sm"
                        aria-label={`${option.name} を削除`}
                        disabled={busy}
                        onClick={() => remove(option.name)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  )}

                </li>
              ))}

              {options.length === 0 && (
                <li className="type-body-medium py-2 text-on-surface-variant">
                  まだ登録されていません。
                </li>
              )}
            </ul>

            <div className="flex flex-col gap-2 border-t border-rule pt-4">
              <Label htmlFor={`tag-name-${state.kind}`}>新しく追加</Label>

              <div className="flex min-w-0 items-center gap-2">
                <Input
                  id={`tag-name-${state.kind}`}
                  className="h-10 min-w-0 flex-1"
                  placeholder="名前"
                  value={name}
                  disabled={busy}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      add();
                    }
                  }}
                />
                <Button size="sm" disabled={busy || !name.trim()} onClick={add}>
                  <Plus className="size-4" />
                  追加
                </Button>
              </div>

              <ColorPicker value={color} onChange={setColor} disabled={busy} />

              <p className="type-body-small text-on-surface-variant">
                色を選べるのは追加のときだけです（Notionが既存の選択肢の色の変更を受け付けないため）。
                名前と並び順は上の一覧から変えられます。名前を変えても、それが付いているNotionの
                ページからは外れません。
              </p>

              {state.databaseUrl && (
                <a
                  href={state.databaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="type-body-small flex items-center gap-1 text-primary hover:underline"
                >
                  <ExternalLink className="size-3.5" />
                  Notionで開く
                </a>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** 色見本から選ぶ。名前だけの一覧では、Notion上でどう見えるかが分からないため。 */
export function ColorPicker({
  value,
  onChange,
  disabled,
}: {
  value: TagColor;
  onChange: (color: TagColor) => void;
  disabled: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="色"
      className="flex min-w-0 flex-wrap items-center gap-1.5"
    >
      {TAG_COLORS.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          aria-label={TAG_COLOR_LABELS[option]}
          title={TAG_COLOR_LABELS[option]}
          disabled={disabled}
          onClick={() => onChange(option)}
          className={cn(
            "size-8 rounded-full transition-[outline-color,outline-width]",
            "outline-2 outline-offset-2 focus-visible:outline-primary disabled:opacity-38",
            value === option ? "outline-on-surface" : "outline-transparent",
            tagSwatchClass(option),
          )}
        />
      ))}
    </div>
  );
}
