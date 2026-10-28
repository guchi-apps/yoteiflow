"use client";

import { useMemo, useRef, useState } from "react";
import { useOffline } from "next/offline";
import { Plus, Sparkles, Trash2 } from "lucide-react";

import { ItemFormActions } from "@/components/calendar/item-form-actions";
import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import { readErrorMessage } from "@/components/calendar/response-error";
import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { tagChipClass } from "@/components/tags/tag-color";
import { ChoiceChip } from "@/components/shopping/choice-chip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { shouldAutoPickCategory } from "@/lib/ai-shopping-category";
import { addDays, parseDateKey, toDateKey } from "@/lib/calendar-range";
import type { TagOption } from "@/services/notion/tag-options";
import { SHOPPING_PRIORITIES, type ShoppingItem, type ShoppingPriority } from "@/types/shopping";

/** 開くときに渡す下書き。新規は選んでいるカテゴリから、編集は既存の項目から始める。 */
export type ShoppingDraft =
  | { mode: "create"; category: string | null; wishlisted: boolean }
  | { mode: "edit"; item: ShoppingItem };

/**
 * 買い物リストの項目の入力（docs/spec.md §36）。
 *
 * 予定・タスク・日付リマインドの入力（`ItemDialog`）へは混ぜない。あちらは日時の欄が主で、
 * 種類を切り替えても入力する軸は変わらないのに対し、買い物の項目は日付も時刻も持たない。
 * 同じダイアログに入れると、切り替えたときに欄がまるごと入れ替わる。
 */
export function ShoppingItemDialog({
  draft,
  categoryOptions,
  timeZone,
  onClose,
  onSaved,
}: {
  draft: ShoppingDraft;
  /** 登録済みのカテゴリ。ここに無い名前も、この画面から足せる。 */
  categoryOptions: TagOption[];
  /**
   * 「今日」「明日」を決めるためのタイムゾーン（`UiSetting.timeZone`）。
   * 端末の時計に任せると、サーバー（UTC）とブラウザ（JST）で日付が食い違う。
   */
  timeZone: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = draft.mode === "edit" ? draft.item : null;
  const [wishlisted, setWishlisted] = useState(
    existing?.wishlisted ?? (draft.mode === "create" && draft.wishlisted),
  );
  const contentRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const [name, setName] = useState(existing?.name ?? "");
  const [memo, setMemo] = useState(existing?.memo ?? "");
  const [category, setCategory] = useState<string | null>(
    draft.mode === "edit" ? draft.item.category : draft.category,
  );
  const [priority, setPriority] = useState<ShoppingPriority>(existing?.priority ?? null);
  const [plannedDate, setPlannedDate] = useState<string | null>(existing?.plannedDate ?? null);

  // 「今日」「明日」の日付は設定タイムゾーンから決める（CLAUDE.md「日付・時刻の解釈」）。
  const { todayKey, tomorrowKey } = useMemo(() => {
    const today = createCalendarDateUtils(timeZone).todayKey();
    return { todayKey: today, tomorrowKey: toDateKey(addDays(parseDateKey(today), 1)) };
  }, [timeZone]);

  // 日付の欄を出すか。「今日」「明日」以外の日付が入っているときは、最初から出す
  // （出さないと、入っている日付がどこにも見えない）。
  const [pickingDate, setPickingDate] = useState(
    () =>
      existing?.plannedDate != null &&
      existing.plannedDate !== todayKey &&
      existing.plannedDate !== tomorrowKey,
  );

  // 新しいカテゴリの追加。入力の途中で思いついた売り場を、設定画面へ回らずに足せるようにする
  // （タスクのタグ・場所の登録と同じ理由）。押されるまで欄は出さない。
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  // 一覧の取得を待たずに開けるため、開いた時点では選択肢が空で、あとから届くことがある
  // （issue #724）。足したあとはサーバーが返した全量を優先し、それまでは届いた値に追従する。
  const [addedCategories, setCategories] = useState<TagOption[] | null>(null);
  const categories = addedCategories ?? categoryOptions;

  const offline = useOffline();

  // アイテム名の入力が終わったとき、カテゴリをJevに選ばせる（issue #725・docs/spec.md §36）。
  // 利用者が選んだ・名前を打ち直したときは、遅れて届いた答えで書き換えないよう番号で捨てる。
  const lastAskedName = useRef<string | null>(null);
  const pickRequestId = useRef(0);
  const [picking, setPicking] = useState(false);
  const [aiPicked, setAiPicked] = useState(false);

  /** 利用者が選んだとき。飛んでいる判定は捨てる。 */
  const chooseCategory = (next: string | null) => {
    pickRequestId.current += 1;
    setPicking(false);
    setAiPicked(false);
    setCategory(next);
  };

  const autoPickCategory = async () => {
    const trimmed = name.trim();
    if (
      !shouldAutoPickCategory({
        name,
        // AIが選んだだけのカテゴリは、名前を打ち直したあとなら選び直させる。
        category: aiPicked ? null : category,
        lastAskedName: lastAskedName.current,
        categoryCount: categories.length,
        offline,
      })
    ) {
      return;
    }

    lastAskedName.current = trimmed;
    const id = ++pickRequestId.current;
    setPicking(true);
    try {
      const response = await fetch("/api/shopping/category-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, categories: categories.map((option) => option.name) }),
      });
      // 手で選べば済むので、失敗はエラー帯に出さない（入力のたびに出ると邪魔になる）。
      if (!response.ok) return;
      const result = (await response.json()) as { category?: string | null };
      if (id !== pickRequestId.current || !result.category) return;
      setCategory(result.category);
      setAiPicked(true);
    } catch {
      // 通信できないときも手動選択のまま続ける
    } finally {
      if (id === pickRequestId.current) setPicking(false);
    }
  };

  const close = () => {
    setOpen(false);
    setTimeout(onClose, 150);
  };

  const finish = () => {
    setOpen(false);
    setTimeout(onSaved, 150);
  };

  const send = async (path: string, init: RequestInit, fallback: string) => {
    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, init);
      if (!response.ok) {
        setError(await readErrorMessage(response, fallback));
        return;
      }
      finish();
    } catch {
      setError(fallback);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("アイテム名を入力してください。");
      return;
    }

    const body = {
      name: trimmed,
      memo: memo.trim() || null,
      category,
      priority,
      // 欲しいものには買う日を持たせない。買うものへ変えたあとに日付を決める。
      plannedDate: wishlisted ? null : plannedDate,
      wishlisted,
      // 購入済みは買うものだけの状態。欲しいものへ変えたときに残ると、買うものへ戻した直後に
      // 一覧から隠れてしまうため、分類変更と同時に未購入へ戻す。
      ...(wishlisted ? { bought: false } : {}),
    };

    if (existing) {
      await send(
        `/api/shopping/${existing.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        "保存できませんでした。",
      );
      return;
    }

    await send(
      "/api/shopping",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      "保存できませんでした。",
    );
  };

  const remove = async () => {
    if (!existing) return;
    await send(`/api/shopping/${existing.id}`, { method: "DELETE" }, "削除できませんでした。");
  };

  /**
   * カテゴリを1つ足して、そのまま選んだ状態にする。
   *
   * 足しただけで選ばれないと、続けてチップを押す手間が増える。足す理由はいま入れている
   * 項目に付けることなので、選ぶところまでを1つの操作にする。
   */
  const addCategory = async () => {
    const trimmed = newCategory.trim();
    if (!trimmed) return;
    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/notion/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "shopping", name: trimmed }),
      });
      if (!response.ok) {
        setError(await readErrorMessage(response, "カテゴリを追加できませんでした。"));
        return;
      }
      const body = (await response.json()) as { options?: TagOption[] };
      setCategories(body.options ?? categories);
      chooseCategory(trimmed);
      setNewCategory("");
      setAddingCategory(false);
    } catch {
      setError("カテゴリを追加できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        ref={contentRef}
        position="bottom"
        className="max-h-[85dvh] gap-3 overflow-y-auto"
        // 編集では項目名や予定日が埋まっており、開いてすぐ文字を打つとは限らない。Radixの既定で
        // 最初の入力欄へ移すとスマートフォンでキーボードが開くため、シート自身へフォーカスを置く。
        onOpenAutoFocus={
          existing
            ? (event) => {
                event.preventDefault();
                contentRef.current?.focus();
              }
            : undefined
        }
      >
        <DialogTitle>
          {existing ? (wishlisted ? "欲しいもの" : "買うもの") : wishlisted ? "欲しいものを追加" : "買うものを追加"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          アイテム名・メモ・カテゴリ・優先度を入力します。買うものでは購入予定日も入力できます。
        </DialogDescription>

        {error && (
          <p className="type-body-small rounded-xl bg-error-container px-4 py-3 text-on-error-container">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <span className="type-label-large text-on-surface-variant">分類</span>
          <div className="flex flex-wrap gap-1.5">
            <ChoiceChip selected={!wishlisted} onClick={() => setWishlisted(false)}>
              買うもの
            </ChoiceChip>
            <ChoiceChip selected={wishlisted} onClick={() => setWishlisted(true)}>
              欲しいもの
            </ChoiceChip>
          </div>
        </div>

        <Input
          label="アイテム名"
          value={name}
          autoFocus={!existing}
          onChange={(event) => {
            pickRequestId.current += 1;
            setPicking(false);
            setName(event.target.value);
          }}
          onBlur={autoPickCategory}
        />

        <Textarea
          label="メモ"
          rows={2}
          placeholder="2本・低脂肪じゃないほう"
          value={memo}
          onChange={(event) => setMemo(event.target.value)}
        />

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="type-label-large text-on-surface-variant">カテゴリ</span>
            {picking && (
              <span className="type-label-small text-on-surface-variant" role="status">
                判定中…
              </span>
            )}
            {!picking && aiPicked && (
              <span className="type-label-small flex items-center gap-1 text-on-surface-variant">
                <Sparkles className="size-3" aria-hidden />
                AIが選びました
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <ChoiceChip selected={category === null} onClick={() => chooseCategory(null)}>
              未設定
            </ChoiceChip>
            {categories.map((option) => (
              <ChoiceChip
                key={option.id}
                selected={category === option.name}
                colorClass={tagChipClass(option.color)}
                onClick={() => chooseCategory(option.name)}
              >
                {option.name}
              </ChoiceChip>
            ))}
            {/* 一覧に無い名前が付いたままの項目を編集したとき、その名前も選べる状態で出す。
                出さないと、保存し直しただけでカテゴリが外れる。 */}
            {category !== null && !categories.some((option) => option.name === category) && (
              <ChoiceChip selected onClick={() => chooseCategory(category)}>
                {category}
              </ChoiceChip>
            )}

            {!addingCategory && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 rounded-md px-2.5"
                disabled={busy || offline}
                onClick={() => setAddingCategory(true)}
              >
                <Plus className="size-3.5" />
                カテゴリを追加
              </Button>
            )}
          </div>

          {addingCategory && (
            <div className="flex items-end gap-2">
              <Input
                label="新しいカテゴリ"
                className="flex-1"
                value={newCategory}
                onChange={(event) => setNewCategory(event.target.value)}
              />
              <Button
                size="sm"
                className="h-10"
                disabled={busy || !newCategory.trim()}
                onClick={addCategory}
              >
                追加
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-10"
                disabled={busy}
                onClick={() => {
                  setAddingCategory(false);
                  setNewCategory("");
                }}
              >
                やめる
              </Button>
            </div>
          )}
        </div>

        {!wishlisted && (
          <>
        {/* 購入予定日（docs/spec.md §36）。「今日買う」「明日買う」がいちばん多い指定なので、
            そこはチップ1つで済ませる。それ以外の日は「日付を指定」を押したときだけ日付の欄を出す
            （未定のときに空の欄が常に並ぶと、入力が要るように見えるため・issue #726）。
            チップと欄はどちらも同じ値を指しており、押した値と保存される値が食い違わない。 */}
        <div className="flex flex-col gap-2">
          <span className="type-label-large text-on-surface-variant">購入予定日</span>
          <div className="flex flex-wrap gap-1.5">
            <ChoiceChip
              selected={!pickingDate && plannedDate === null}
              onClick={() => {
                setPickingDate(false);
                setPlannedDate(null);
              }}
            >
              未定
            </ChoiceChip>
            <ChoiceChip
              selected={!pickingDate && plannedDate === todayKey}
              onClick={() => {
                setPickingDate(false);
                setPlannedDate(todayKey);
              }}
            >
              今日
            </ChoiceChip>
            <ChoiceChip
              selected={!pickingDate && plannedDate === tomorrowKey}
              onClick={() => {
                setPickingDate(false);
                setPlannedDate(tomorrowKey);
              }}
            >
              明日
            </ChoiceChip>
            <ChoiceChip selected={pickingDate} onClick={() => setPickingDate(true)}>
              日付を指定
            </ChoiceChip>
          </div>
          {/* 日付の欄には ✕（クリア）を出さない。消す操作は「未定」のチップが受けており、
              欄にも置くと同じことをする出口が2つ並ぶ（CLAUDE.md「入力欄の ✕」）。 */}
          {pickingDate && (
            <Input
              label="日付"
              type="date"
              value={plannedDate ?? ""}
              onChange={(event) => setPlannedDate(event.target.value || null)}
            />
          )}
        </div>
          </>
        )}

        <div className="flex flex-col gap-2">
          <span className="type-label-large text-on-surface-variant">優先度</span>
          <div className="flex flex-wrap gap-1.5">
            <ChoiceChip selected={priority === null} onClick={() => setPriority(null)}>
              未設定
            </ChoiceChip>
            {SHOPPING_PRIORITIES.map((value) => (
              <ChoiceChip
                key={value}
                selected={priority === value}
                onClick={() => setPriority(value)}
              >
                {value}
              </ChoiceChip>
            ))}
          </div>
        </div>

        {/* 削除は必ず確認を挟む（docs/spec.md §7）。押し間違えても画面上に戻す手立てが無い。
            Notionのゴミ箱からは戻せるため、その旨も出す。 */}
        {confirming ? (
          <div className="flex flex-col gap-3 pt-2">
            <p className="type-body-medium">
              「{existing?.name}」を削除しますか？Notionのゴミ箱からは元に戻せます。
            </p>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="flex-1"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                やめる
              </Button>
              <Button variant="destructive" className="flex-1" disabled={busy} onClick={remove}>
                <Trash2 className="size-4" />
                削除する
              </Button>
            </div>
          </div>
        ) : (
          <ItemFormActions
            saveDisabled={busy || offline || !name.trim()}
            onSave={save}
            onDelete={existing ? () => setConfirming(true) : undefined}
            deleteDisabled={busy || offline}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
