"use client";

import { useOffline } from "next/offline";
import { useState } from "react";

import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { researchBasis, shiftAmountLabel, type TravelShift } from "@/lib/travel-follow";
import { rememberReplacePending } from "@/lib/travel-replace-pending";
import { resolveYahooPlace, yahooTransitLink } from "@/lib/yahoo-transit-link";
import type { PlaceItem } from "@/services/notion/places";
import type { TravelItem } from "@/types/calendar";

import { isoToLocalInput } from "./datetime-fields";
import { TravelMark } from "./travel-mark";
import { patchTravelTimes } from "./travel-time-patch";

/**
 * 予定を動かした直後に出す「紐づいている移動も変更しますか？」（issue #1301・docs/spec.md §29）。
 *
 * タスクは従来どおり自動で追随するが、移動は自動では動かさない。電車は新しい時刻に走っているとは
 * 限らず、DaySpanからダイヤを確かめる手段も無いため、利用者に選ばせる。
 *
 * - はい：所要時間を保ったまま同じだけずらす
 * - 調べ直す（公共交通のみ）：ずらした時刻でYahoo!乗換案内を開く。共有ボタンの「予定に紐づけて
 *   追加」で同じ予定を選んで戻ると、新しい移動ではなく元の移動の編集として開く
 *   （`travel-replace-pending.ts`）。#1053 で移動の入力画面からYahoo!の貼り付けを外したため、
 *   戻り道は共有拡張しか無い
 * - いいえ：移動は元の時刻のまま
 *
 * 予定の保存はこの画面を開く前に済んでいる。ここで失敗しても予定は動いたまま残る。
 */
export function LinkedTravelShiftDialog({
  eventId,
  eventTitle,
  shifts,
  places,
  timeZone,
  formatTime,
  onClose,
}: {
  eventId: string;
  eventTitle: string;
  shifts: TravelShift<TravelItem>[];
  places: PlaceItem[];
  timeZone: string;
  formatTime: (iso: string) => string;
  /** shifted は1件でもずらしたか（呼び出し側が移動の期間を取り直す）。 */
  onClose: (shifted: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 一部だけ保存できたまま閉じたときも、ずらせた分を取り直させる。
  const [partlyShifted, setPartlyShifted] = useState(false);
  const offline = useOffline();

  const close = (shifted: boolean) => {
    // 閉じ切ってから呼び出し元へ返す（開いたままアンマウントすると <body> の
    // pointer-events:none が残ることがある。DeleteItemDialog と同じ）。
    setOpen(false);
    setTimeout(() => onClose(shifted), 150);
  };

  const shiftAll = async () => {
    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }
    setBusy(true);
    setError(null);
    const errors: string[] = [];
    for (const shift of shifts) {
      const message = await patchTravelTimes(shift.travel, shift.start, shift.end);
      if (message) errors.push(`「${shift.travel.title}」${message}`);
    }
    setBusy(false);
    if (errors.length === 0) {
      close(true);
      return;
    }
    // 送る時刻は絶対値なので、もう一度「はい」を押しても保存済みの分が二重にずれることはない。
    setError(errors.join("\n"));
    if (errors.length < shifts.length) setPartlyShifted(true);
  };

  const single = shifts.length === 1;
  const amounts = new Set(shifts.map((shift) => shift.deltaMs));
  const commonAmount = amounts.size === 1 ? shiftAmountLabel(shifts[0].deltaMs) : null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close(partlyShifted)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>紐づいている移動も変更しますか？</DialogTitle>
          <DialogDescription>
            「{eventTitle}」の時刻を変えました。紐づくタスクは自動で合わせています。
          </DialogDescription>
        </DialogHeader>

        <ul className="flex min-w-0 flex-col gap-2">
          {shifts.map((shift) => {
            const transit = shift.travel.mode === "PUBLIC_TRANSIT";
            const research = transit
              ? yahooTransitLink({
                  origin: resolveYahooPlace(shift.travel.origin, places),
                  destination: resolveYahooPlace(shift.travel.destination, places),
                  departAt: isoToLocalInput(shift.start, timeZone),
                  arriveAt: isoToLocalInput(shift.end, timeZone),
                  basis: researchBasis(shift.relation),
                })
              : null;

            return (
              <li
                key={shift.travel.id}
                className="flex min-w-0 flex-col gap-1.5 rounded-item border border-outline-variant p-2.5"
              >
                <span className="flex min-w-0 items-center gap-1.5 type-label-large">
                  <TravelMark mode={shift.travel.mode} className="size-3.5 shrink-0" />
                  <span className="truncate">{shift.travel.title}</span>
                </span>
                <span className="type-body-small text-on-surface-variant tabular-nums">
                  {formatTime(shift.travel.start)}–{formatTime(shift.travel.end)} →{" "}
                  {formatTime(shift.start)}–{formatTime(shift.end)}（{shiftAmountLabel(shift.deltaMs)}）
                </span>
                {research && (
                  <Button asChild variant="outline" size="sm" className="self-start">
                    {/*
                      素の <a> で開く（iOSがUniversal LinkでYahoo!アプリを開けるように。スクリプトから
                      開くとアプリが入っていてもブラウザへ落ちることがある）。押した時点で置き換え待ちを
                      覚え、この画面は閉じる。移動はまだ動かさない（選び直した経路で置き換えるため）。
                    */}
                    <a
                      href={research}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => {
                        rememberReplacePending(eventId, shift.travel);
                        close(partlyShifted);
                      }}
                    >
                      Yahoo!乗換案内で調べ直す
                    </a>
                  </Button>
                )}
              </li>
            );
          })}
        </ul>

        {shifts.some((shift) => shift.travel.mode === "PUBLIC_TRANSIT") && (
          <p className="type-body-small text-on-surface-variant">
            電車・バスは、ずらした時刻に便があるとは限りません。調べ直すときは、Yahoo!乗換案内で経路を選んで共有ボタンから「予定に紐づけて追加」を選び、この予定を選ぶと元の移動が置き換わります（30分以内）。
          </p>
        )}

        {error && <p className="whitespace-pre-line text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => close(partlyShifted)}>
            いいえ
          </Button>
          <Button disabled={busy || offline} onClick={shiftAll}>
            {single || commonAmount
              ? `はい（${commonAmount ?? shiftAmountLabel(shifts[0].deltaMs)}ずらす）`
              : "はい（すべてずらす）"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
