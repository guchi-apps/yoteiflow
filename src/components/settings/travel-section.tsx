"use client";

import { useState } from "react";

import { LocationInput } from "@/components/calendar/location-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { PlaceCatalog } from "@/services/notion/places";
import type { TravelSettings } from "@/services/travel/settings";
import {
  MAX_TRAVEL_SEARCH_MARGIN_MINUTES,
  MAX_TRAVEL_WALK_MINUTES,
  TRAVEL_MODES,
  TRAVEL_MODE_LABELS,
  type WritableCalendar,
} from "@/types/calendar";

/** 書き出し先を選ぶ欄で「指定しない」を表す値。Radixのセレクトは空文字を値にできない。 */
const DEFAULT_CALENDAR_VALUE = "__default__";

/**
 * 移動の既定値（docs/spec.md §29）。
 *
 * 項目ごとではなく利用者につき1組にする。移動は予定に1件ずつ付くもので、
 * 予定ごとに出発地や交通手段を選ばせると、そのほとんどが同じ値になるため。
 */
export function TravelSection({
  settings,
  calendars,
  placeCatalog,
}: {
  settings: TravelSettings;
  calendars: WritableCalendar[];
  /** 既定の出発地の入力候補。Notionの場所DBに登録済みのもの。 */
  placeCatalog: PlaceCatalog;
}) {
  const [value, setValue] = useState(settings);
  // 出発地は入力中の文字列を持つ。保存した値（value.defaultOrigin）とは別に持たないと、
  // 送信中に欄が巻き戻る。
  const [origin, setOrigin] = useState(settings.defaultOrigin ?? "");
  // 余裕分も入力中の文字列を持ち、欄から離れたときに保存する（打っている途中を送らない）
  const [margin, setMargin] = useState(String(settings.arriveMarginMinutes));
  const commitMargin = () => {
    const next = Number(margin);
    if (!Number.isInteger(next) || next < 0 || next > MAX_TRAVEL_SEARCH_MARGIN_MINUTES) {
      setError(`予定の何分前に着くかは、0〜${MAX_TRAVEL_SEARCH_MARGIN_MINUTES}分で入力してください。`);
      setMargin(String(value.arriveMarginMinutes));
      return;
    }
    if (next !== value.arriveMarginMinutes) void send({ arriveMarginMinutes: next });
  };
  // 徒歩も入力中の文字列を持ち、欄から離れたときに保存する（issue #1463）
  const [walk, setWalk] = useState({
    before: String(settings.walkBeforeMinutes),
    after: String(settings.walkAfterMinutes),
  });
  const commitWalk = (side: "before" | "after") => {
    const key = side === "before" ? "walkBeforeMinutes" : "walkAfterMinutes";
    const text = walk[side].trim();
    const next = text === "" ? 0 : Number(text);
    if (!Number.isInteger(next) || next < 0 || next > MAX_TRAVEL_WALK_MINUTES) {
      setError(`徒歩は0〜${MAX_TRAVEL_WALK_MINUTES}分で入力してください。`);
      setWalk((current) => ({ ...current, [side]: String(value[key]) }));
      return;
    }
    setWalk((current) => ({ ...current, [side]: String(next) }));
    if (next !== value[key]) void send({ [key]: next });
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultCalendarName =
    calendars.find((calendar) => calendar.isCreateDefault)?.name ?? calendars[0]?.name;

  /**
   * 変更を送る。応答を待ってから欄を動かすと、選んだのに変わらない時間ができるため
   * 先に反映し、失敗したら元へ戻す（活動記録の設定と同じ扱い）。
   */
  const send = async (patch: Partial<TravelSettings>) => {
    const previous = value;
    setValue({ ...value, ...patch });
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/settings/travel", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;

      if (!response.ok) {
        setError((body?.message as string) ?? "設定を保存できませんでした。");
        setValue(previous);
        return;
      }

      // 保存できたら楽観更新した値がそのまま正になる。router.refresh() を呼ばないのは、
      // このページのサーバー側が場所DBを読んでおり、交通手段や書き出し先を切り替えるたびに
      // Notionの全件取得が走ってしまうため（docs/spec.md §20）。
    } catch {
      setError("設定を保存できませんでした。");
      setValue(previous);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-5">
        {error && (
          <p className="type-body-medium rounded-lg bg-error-container/70 px-3 py-2 text-on-error-container">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-2">
          {/* 予定の「場所」欄・移動の出発地と同じ入力にする。自宅のような名前だけでは
              所要時間の見積もりが地点を特定できないため、ここから住所付きで登録・選択できる
              必要がある（docs/spec.md §29「設定」）。
              場所DBが未設定のときは候補も登録も出ないが、「AIに聞く」から選んだ住所は欄へ入る。
              登録先が無くても、この欄に住所を入れる目的は果たせる。
              保存中も欄は止めない。打っている文字を落とさないため（保存は欄から離れた時点）。 */}
          <LocationInput
            id="travel-origin"
            label="既定の出発地"
            value={origin}
            onChange={setOrigin}
            // 打ち終えて欄から離れた時点・候補を選んだ時点で保存する。
            // 1文字ごとに送ると、打っている途中が保存される。
            onCommit={(next) => {
              const trimmed = next.trim() || null;
              if (trimmed !== value.defaultOrigin) void send({ defaultOrigin: trimmed });
            }}
            places={placeCatalog.places}
            eventTitle=""
            placeDatabaseReady={placeCatalog.ready}
          />
          <p className="type-body-small text-on-surface-variant">
            予定から移動を足すとき、出発地の初期値になります。住所まで入れておくと、
            所要時間を調べるときに地点が定まります。地図のアイコンから自宅を登録できます。
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label>既定の交通手段</Label>
          <div className="flex flex-wrap gap-2">
            {TRAVEL_MODES.map((mode) => (
              <Button
                key={mode}
                type="button"
                variant={mode === value.defaultMode ? "secondary" : "outline"}
                size="sm"
                className={cn(
                  mode === value.defaultMode && "bg-travel-container text-on-travel-container",
                )}
                disabled={busy}
                onClick={() => send({ defaultMode: mode })}
              >
                {TRAVEL_MODE_LABELS[mode]}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Input
            id="travel-arrive-margin"
            label="予定の何分前に着くか（分）"
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_TRAVEL_SEARCH_MARGIN_MINUTES}
            value={margin}
            onChange={(e) => setMargin(e.target.value)}
            onBlur={commitMargin}
          />
          <p className="type-body-small text-on-surface-variant">
            予定の前の電車・バスを探すとき、予定の開始からこの分だけ早い到着時刻で検索します。移動の入力で、検索ごとに変えられます。
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Input
            id="travel-walk-before"
            label="電車の前に歩く（分）"
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_TRAVEL_WALK_MINUTES}
            value={walk.before}
            onChange={(e) => setWalk((current) => ({ ...current, before: e.target.value }))}
            onBlur={() => commitWalk("before")}
          />
          <Input
            id="travel-walk-after"
            label="電車のあとに歩く（分）"
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_TRAVEL_WALK_MINUTES}
            value={walk.after}
            onChange={(e) => setWalk((current) => ({ ...current, after: e.target.value }))}
            onBlur={() => commitWalk("after")}
          />
          <p className="type-body-small text-on-surface-variant">
            Yahoo!乗換案内の経路を取り込むとき、電車の出発のこの分だけ前を移動の出発、到着のこの分だけあとを到着にします。
            出発地・目的地が駅でなく徒歩から始まる経路には、その側は足しません。勤務の自動生成の徒歩は、設定 ▸ 勤務の勤務場所で別に持ちます。
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="travel-calendar">Googleカレンダーへの書き出し先</Label>

          <Select
            value={value.calendarId ?? DEFAULT_CALENDAR_VALUE}
            disabled={busy || calendars.length === 0}
            onValueChange={(next) =>
              send({ calendarId: next === DEFAULT_CALENDAR_VALUE ? null : next })
            }
          >
            <SelectTrigger id="travel-calendar" size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_CALENDAR_VALUE}>
                既定の保存先{defaultCalendarName ? `（${defaultCalendarName}）` : ""}
              </SelectItem>
              {calendars.map((calendar) => (
                <SelectItem key={calendar.calendarId} value={calendar.calendarId}>
                  {calendar.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <p className="type-body-small text-on-surface-variant">
            {calendars.length === 0
              ? "Google Calendarを接続すると、移動を他の端末のカレンダーからも見られるようになります。接続していない間、移動はYoteiFlowの中だけに出ます。"
              : "移動はYoteiFlowが一次情報源です。ここへ書き出した予定を Google 側で直しても、YoteiFlowで保存し直すと元に戻ります。"}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
