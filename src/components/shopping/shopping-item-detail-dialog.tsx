"use client";

import { useMemo, useState } from "react";
import { useOffline } from "next/offline";
import {
  AlignLeft,
  ArrowRight,
  CalendarDays,
  ExternalLink,
  Flag,
  Heart,
  Pencil,
  ShoppingCart,
  Tag,
  Trash2,
} from "lucide-react";

import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import { readErrorMessage } from "@/components/calendar/response-error";
import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { FormRow } from "@/components/calendar/event-form-row";
import { TaskPriorityIcon } from "@/components/calendar/task-priority-badges";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LinkifiedText } from "@/components/ui/linkified-text";
import { addDays, parseDateKey, toDateKey } from "@/lib/calendar-range";
import { cn } from "@/lib/utils";
import { type ShoppingItem } from "@/types/shopping";

/** 買い物項目の表示画面。行を押したときは、入力画面へ直行させずここで内容を確認する。 */
export function ShoppingItemDetailDialog({
  item: initialItem,
  readOnly = false,
  timeZone,
  onClose,
  onEdit,
  onChanged,
  onDeleted,
}: {
  item: ShoppingItem;
  /** オフライン中も表示はできるが、Notionへ書き込む操作は止める。 */
  readOnly?: boolean;
  timeZone: string;
  onClose: () => void;
  onEdit: (item: ShoppingItem) => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [item, setItem] = useState(initialItem);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const offline = useOffline();
  const writesDisabled = readOnly || offline;

  // 「今日」「明日」は設定タイムゾーンから決める（CLAUDE.md「日付・時刻の解釈」）。
  const { todayKey, tomorrowKey } = useMemo(() => {
    const today = createCalendarDateUtils(timeZone).todayKey();
    return { todayKey: today, tomorrowKey: toDateKey(addDays(parseDateKey(today), 1)) };
  }, [timeZone]);
  // 開いたままアンマウントするとRadixの後始末が走らないことがあるため、閉じ切ってから返す。
  const closeThen = (callback: () => void) => {
    setOpen(false);
    setTimeout(callback, 150);
  };
  const close = () => closeThen(onClose);

  const patch = async (
    body: Partial<ShoppingItem>,
    fallback: string,
  ): Promise<boolean> => {
    if (writesDisabled) {
      setError(OFFLINE_WRITE_MESSAGE);
      return false;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/shopping/${encodeURIComponent(item.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        setError(await readErrorMessage(response, fallback));
        return false;
      }
      setItem((current) => ({ ...current, ...body }));
      onChanged();
      return true;
    } catch {
      setError(fallback);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const toggleBought = (bought: boolean) =>
    patch({ bought }, "購入済みを変更できませんでした。");
  const changeClassification = (wishlisted: boolean) =>
    patch(
      wishlisted
        ? { wishlisted: true, plannedDate: null, bought: false }
        : { wishlisted: false },
      wishlisted
        ? "欲しいものへ変更できませんでした。"
        : "買うものへ変更できませんでした。",
    );

  const remove = async () => {
    if (writesDisabled) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/shopping/${encodeURIComponent(item.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        setError(await readErrorMessage(response, "削除できませんでした。"));
        return;
      }
      closeThen(onDeleted);
    } catch {
      setError("削除できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const edit = () => closeThen(() => onEdit(item));

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent position="bottom" className="max-h-[85dvh] gap-3 overflow-x-hidden overflow-y-auto">
        {confirmingDelete ? (
          <>
            <DialogHeader>
              <DialogTitle>削除しますか？</DialogTitle>
              <DialogDescription>
                「{item.name}
                」をNotionのゴミ箱へ移します。Notionのゴミ箱から元に戻せます。
              </DialogDescription>
            </DialogHeader>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setConfirmingDelete(false)}
              >
                やめる
              </Button>
              <Button
                variant="destructive"
                disabled={busy || writesDisabled}
                onClick={remove}
              >
                削除
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="削除"
              className="absolute top-2 right-18"
              disabled={busy || writesDisabled}
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="編集"
              className="absolute top-2 right-10"
              disabled={busy || writesDisabled}
              onClick={edit}
            >
              <Pencil className="size-4" />
            </Button>

            <DialogHeader>
              <DialogTitle
                className={cn(
                  "pr-22",
                  item.bought && "text-on-surface-variant line-through",
                )}
              >
                {item.name}
              </DialogTitle>
              <DialogDescription className="sr-only">
                買い物項目の詳細
              </DialogDescription>
            </DialogHeader>

            <div className="flex min-w-0 flex-col gap-4 text-sm">
              {!item.wishlisted && (
                <label className="flex min-h-11 items-center gap-3 text-base select-none md:text-sm">
                  <Checkbox
                    checked={item.bought}
                    disabled={busy || writesDisabled}
                    onCheckedChange={(value) =>
                      void toggleBought(value === true)
                    }
                  />
                  購入済み
                </label>
              )}
              {writesDisabled && (
                <p className="text-xs text-on-surface-variant">
                  {OFFLINE_WRITE_MESSAGE}
                </p>
              )}
              {/* 購入予定日・優先度は表示のみ。変えるのは編集画面で行う（issue #1695。
                  issue #1457 の詳細画面での即時変更は撤去）。 */}
              <div className="flex min-w-0 flex-col">
                <FormRow icon={<ShoppingCart />} divider={false}>
                  <DetailText value={item.wishlisted ? "欲しいもの" : "買うもの"} />
                </FormRow>
                {item.category && (
                  <FormRow icon={<Tag />}>
                    <DetailText value={item.category} />
                  </FormRow>
                )}
                {!item.wishlisted && (
                  <FormRow icon={<CalendarDays />}>
                    <DetailText
                      value={`購入予定日: ${item.plannedDate ? formatPlannedDate(item.plannedDate, todayKey, tomorrowKey) : "未定"}`}
                    />
                  </FormRow>
                )}
                {item.priority && (
                  <FormRow icon={<Flag />}>
                    <div className="flex min-h-10 items-center gap-2">
                      <TaskPriorityIcon priority={item.priority} />
                      <span>優先度: {item.priority}</span>
                    </div>
                  </FormRow>
                )}
                {item.memo && (
                  <FormRow icon={<AlignLeft />}>
                    <DetailText value={item.memo} />
                  </FormRow>
                )}
              </div>
              <Button
                variant="outline"
                className="w-fit"
                disabled={busy || writesDisabled}
                onClick={() => void changeClassification(!item.wishlisted)}
              >
                {item.wishlisted ? (
                  <ArrowRight className="size-4" />
                ) : (
                  <Heart className="size-4" />
                )}
                {item.wishlisted ? "買うものへ" : "欲しいものへ"}
              </Button>
              {item.url && (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:underline"
                >
                  <ExternalLink className="size-3" />
                  Notionで開く
                </a>
              )}
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
            </div>
            <DialogFooter className="flex-col gap-2 sm:flex-col">
              {/* 右上の鉛筆だけでは押しにくいため、閉じるの上にも置く。枠付きにして
                  枠なしの「閉じる」と見分ける（issue #1695）。 */}
              <Button
                variant="outline"
                className="min-h-11 w-full"
                disabled={busy || writesDisabled}
                onClick={edit}
              >
                <Pencil className="size-4" />
                編集する
              </Button>
              <Button variant="ghost" className="w-full" onClick={close}>
                閉じる
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 「今日」「明日」はそのまま、ほかは「11月19日」の形で出す。 */
function formatPlannedDate(dateKey: string, todayKey: string, tomorrowKey: string): string {
  if (dateKey === todayKey) return "今日";
  if (dateKey === tomorrowKey) return "明日";
  const [, month, day] = dateKey.split("-").map(Number);
  return month && day ? `${month}月${day}日` : dateKey;
}

function DetailText({ value }: { value: string }) {
  return (
    <div className="flex min-h-10 min-w-0 items-center">
      <LinkifiedText as="span" text={value} />
    </div>
  );
}
