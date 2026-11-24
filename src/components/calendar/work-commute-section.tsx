"use client";

import { useEffect, useState } from "react";

import { TrainFront } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GENERATED_NOTE } from "@/lib/work-generated-note";
import { trainFromTravel } from "@/lib/work-sync/train";
import { readYahooRouteStops } from "@/lib/yahoo-transit-route";
import type { TravelItem } from "@/types/calendar";

type Commute = { kind: "OUTBOUND" | "RETURN"; origin: string; destination: string };

/**
 * 勤務に紐づく移動の詳細に出す「通勤経路」欄（issue #1701）。
 * 経路を「よく使う電車」へ、経路が無い（所要時間だけの）移動は既定の移動時間として登録する。
 * 登録先のキーは移動の文字列ではなく、勤務同期の控えから求めた生の場所名（`/api/travels/[id]/work-commute`）。
 * 自動生成の移動だけ（メモの印で絞り、他の移動では取得しない）。
 */
export function WorkCommuteSection({
  travel,
  timeZone,
  readOnly,
}: {
  travel: TravelItem;
  timeZone: string;
  readOnly?: boolean;
}) {
  const generated = Boolean(travel.note?.includes(GENERATED_NOTE));
  const [commute, setCommute] = useState<Commute | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!generated) return;
    let alive = true;
    fetch(`/api/travels/${travel.id}/work-commute`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { commute: Commute | null } | null) => {
        if (alive) setCommute(body?.commute ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [generated, travel.id]);

  if (!generated || !commute) return null;

  const detail = travel.routeDetail || travel.note || "";
  const hasRoute = readYahooRouteStops(detail).length > 0;
  const minutes = Math.round((new Date(travel.end).getTime() - new Date(travel.start).getTime()) / 60_000);
  const leg = commute.kind === "OUTBOUND" ? "往路" : "復路";

  const register = async () => {
    setBusy(true);
    setMessage(null);
    try {
      let response: Response;
      if (hasRoute) {
        const train = trainFromTravel(travel, commute, timeZone);
        if (!train) throw new Error("所要時間を読めませんでした。");
        response = await fetch("/api/settings/work-trains", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...train, keepOtherDays: { travelId: travel.id } }),
        });
      } else {
        response = await fetch("/api/settings/work-routes", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            origin: commute.origin,
            destination: commute.destination,
            mode: travel.mode,
            minutes,
            keepOtherDays: { travelId: travel.id },
          }),
        });
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? "登録できませんでした。");
      }
      setMessage({
        ok: true,
        text: hasRoute
          ? "よく使う電車へ登録しました（設定 ▸ 勤務）。勤務の入力で選ぶと、この時刻で移動を作ります。他の日の既に作った移動は変更していません。"
          : "既定の移動時間として登録しました。他の日の既に作った移動は変更していません。",
      });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : "登録できませんでした。" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-outline-variant p-3">
      <div className="flex items-center gap-2 font-bold">
        <TrainFront className="size-4" />
        通勤経路（{leg}）
      </div>
      <p className="type-body-small text-on-surface-variant">
        {commute.origin} → {commute.destination}
        {hasRoute
          ? "。この経路を、よく使う電車に登録できます。"
          : "。経路が無いため、所要時間だけを既定の移動時間として登録できます。経路は編集画面のYahoo!乗換案内から取り込むと、駅名間で表示・再検索できます。"}
      </p>
      <div>
        <Button variant="outline" size="sm" disabled={readOnly || busy} onClick={register}>
          {hasRoute ? "この経路を通勤経路に登録" : `所要時間${minutes}分を既定に登録`}
        </Button>
      </div>
      {message && (
        <p className={message.ok ? "type-body-small text-on-surface-variant" : "type-body-small text-error"}>
          {message.text}
        </p>
      )}
    </div>
  );
}
