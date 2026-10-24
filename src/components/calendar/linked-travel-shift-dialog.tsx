"use client";

import { useOffline } from "next/offline";
import { useEffect, useState, useSyncExternalStore } from "react";

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
import { Input } from "@/components/ui/input";
import { hasNativeTransit, openTransitInNativeApp } from "@/lib/native-transit";
import { placeDisplayName } from "@/lib/place-text";
import { followSearchCondition, type TransitFollow } from "@/lib/transit-follow";
import { rememberTransitSession } from "@/lib/transit-search-session";
import { suggestTransitSearch, type ContextEvent, type ContextTravel } from "@/lib/transit-suggest";
import { shiftAmountLabel, type TravelShift } from "@/lib/travel-follow";
import { cn } from "@/lib/utils";
import { transitConditionSummary, transitSearchCondition, yahooTransitAppLink } from "@/lib/yahoo-transit-app";
import { resolveYahooPlace, yahooTransitLink } from "@/lib/yahoo-transit-link";
import type { PlaceItem } from "@/services/notion/places";
import { MAX_TRAVEL_SEARCH_MARGIN_MINUTES, type TravelItem, type TravelSearchPurpose } from "@/types/calendar";

import { isoToLocalInput } from "./datetime-fields";
import { readErrorMessage } from "./response-error";
import { TravelMark } from "./travel-mark";
import { patchTravelTimes } from "./travel-time-patch";

/** 確かめる予定（変更後）。移動を探し直す条件の基準になる。 */
export type FollowEvent = {
  id: string;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
};

/** 公共交通の移動1件ぶんの再提案（issue #1332） */
export type TransitFollowItem = { travel: TravelItem; follow: TransitFollow; event: FollowEvent };

/**
 * 予定が変わったあとの「紐づいている移動も変更しますか？」（issue #1301・#1332・docs/spec.md §29）。
 *
 * タスクは従来どおり自動で追随するが、移動は自動では動かさない。
 *
 * - 公共交通: 電車は新しい時刻に便があるとは限らず、DaySpanからダイヤを確かめる手段も無い。そのため
 *   ずらす選択肢は出さず、変更後の予定の時刻・場所・前後の予定から**探し直す条件**を示す（#1331の
 *   `suggestTransitSearch`）。「Yahoo!で調べ直す」は元の移動を下書きに入れてYahoo!アプリを開き（#1330の
 *   session）、共有で戻した経路を入力画面で確かめて保存したときに初めて元の移動を更新する。
 *   「今は変更しない」は変更の印を残し、同じ変更では出さない。閉じるだけなら保留（あとで一覧に出る）
 * - 車・徒歩・その他: 従来どおり所要時間を保ったまま同じだけずらせる（はい／いいえ）
 *
 * 予定の保存はこの画面を開く前に済んでいる。ここで失敗しても予定は動いたまま残る。
 */
export function LinkedTravelShiftDialog({
  title,
  description,
  shifts,
  follows,
  places,
  timeZone,
  home,
  defaultArriveMargin,
  formatTime,
  onDismissed,
  onClose,
}: {
  title: string;
  description: string;
  /** ずらせる移動（公共交通以外） */
  shifts: TravelShift<TravelItem>[];
  /** 探し直す移動（公共交通） */
  follows: TransitFollowItem[];
  places: PlaceItem[];
  timeZone: string;
  home: string | null;
  defaultArriveMargin: number;
  formatTime: (iso: string) => string;
  /** 「今は変更しない」を保存できた（呼び出し側が一覧から外し、移動を取り直す） */
  onDismissed: (item: TransitFollowItem) => void;
  /** shifted は1件でもずらしたか（呼び出し側が移動の期間を取り直す）。 */
  onClose: (shifted: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 一部だけ保存できたまま閉じたときも、ずらせた分を取り直させる。
  const [partlyShifted, setPartlyShifted] = useState(false);
  const [handled, setHandled] = useState<Set<string>>(() => new Set());
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

  const remaining = follows.filter((item) => !handled.has(item.travel.id));
  const markHandled = (item: TransitFollowItem) => {
    const next = new Set(handled).add(item.travel.id);
    setHandled(next);
    // 公共交通だけの画面で全部片付いたら閉じる
    if (shifts.length === 0 && follows.every((entry) => next.has(entry.travel.id))) close(partlyShifted);
  };

  const amounts = new Set(shifts.map((shift) => shift.deltaMs));
  const commonAmount = amounts.size === 1 && shifts.length > 0 ? shiftAmountLabel(shifts[0].deltaMs) : null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close(partlyShifted)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <ul className="flex min-w-0 flex-col gap-2">
          {remaining.map((item) => (
            <TransitFollowCard
              key={item.travel.id}
              item={item}
              places={places}
              timeZone={timeZone}
              home={home}
              defaultArriveMargin={defaultArriveMargin}
              formatTime={formatTime}
              offline={offline}
              onOpened={() => close(partlyShifted)}
              onDismissed={() => {
                onDismissed(item);
                markHandled(item);
              }}
            />
          ))}
          {shifts.map((shift) => (
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
            </li>
          ))}
        </ul>

        {remaining.length > 0 && (
          <p className="type-body-small text-on-surface-variant">
            電車・バスは、新しい時刻に便があるとは限らないため自動ではずらしません。Yahoo!乗換案内で経路を選んだら、共有ボタンから「（移動名）に反映」を選ぶと、元の移動の入力画面が開きます（30分以内）。保存するまで移動は変わりません。
          </p>
        )}

        {error && <p className="whitespace-pre-line text-sm text-destructive">{error}</p>}

        <DialogFooter>
          {shifts.length > 0 ? (
            <>
              <Button variant="ghost" disabled={busy} onClick={() => close(partlyShifted)}>
                いいえ
              </Button>
              <Button disabled={busy || offline} onClick={shiftAll}>
                {commonAmount ? `はい（${commonAmount}ずらす）` : "はい（すべてずらす）"}
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => close(partlyShifted)}>
              あとで確かめる
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type TransitContext = { events: ContextEvent[]; travels: ContextTravel[] };

function TransitFollowCard({
  item,
  places,
  timeZone,
  home,
  defaultArriveMargin,
  formatTime,
  offline,
  onOpened,
  onDismissed,
}: {
  item: TransitFollowItem;
  places: PlaceItem[];
  timeZone: string;
  home: string | null;
  defaultArriveMargin: number;
  formatTime: (iso: string) => string;
  offline: boolean;
  onOpened: () => void;
  onDismissed: () => void;
}) {
  const { travel, follow, event } = item;
  const [purpose, setPurpose] = useState<TravelSearchPurpose | null>(follow.intent?.purpose ?? null);
  const [marginText, setMarginText] = useState(String(follow.intent?.marginMinutes ?? defaultArriveMargin));
  const [context, setContext] = useState<TransitContext | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const native = useSyncExternalStore(() => () => {}, hasNativeTransit, () => false);
  const proposable = follow.missing.length === 0 && purpose !== null && !event.allDay;

  // 前後の予定・移動は開いたときに1回だけ取る（予定前後の提案と同じ口・issue #1331）。読めなければ周辺なしで続ける
  useEffect(() => {
    if (!proposable) return;
    const query = new URLSearchParams({ start: event.start, end: event.end });
    let cancelled = false;
    fetch(`/api/travels/context?${query.toString()}`)
      .then(async (response) => (response.ok ? ((await response.json()) as TransitContext) : null))
      .catch(() => null)
      .then((loaded) => {
        if (!cancelled) setContext(loaded ?? { events: [], travels: [] });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 開いたときに1回だけ
  }, []);

  const margin = (() => {
    const value = Number(marginText);
    return marginText.trim() !== "" && Number.isInteger(value) && value >= 0 && value <= MAX_TRAVEL_SEARCH_MARGIN_MINUTES ? value : null;
  })();
  const formatClock = (iso: string) => isoToLocalInput(iso, timeZone).slice(11, 16).replace(/^0/, "");
  const suggestion =
    proposable && margin !== null
      ? suggestTransitSearch({
          target: { id: event.id, title: event.title, start: event.start, end: event.end, allDay: event.allDay, location: event.location },
          purpose,
          marginMinutes: margin,
          events: context?.events ?? [],
          travels: context?.travels ?? [],
          home,
          excludeTravelId: travel.id,
          formatTime: formatClock,
        })
      : null;
  const condition = suggestion ? followSearchCondition(travel, suggestion) : null;
  const departLocal = condition ? isoToLocalInput(condition.departAt, timeZone) : "";
  const arriveLocal = condition ? isoToLocalInput(condition.arriveAt, timeZone) : "";
  const search = condition
    ? transitSearchCondition({
        origin: resolveYahooPlace(condition.origin, places),
        destination: resolveYahooPlace(condition.destination, places),
        departAt: departLocal,
        arriveAt: arriveLocal,
        basis: condition.basis,
      })
    : null;
  const links =
    search?.ok && !offline
      ? {
          app: yahooTransitAppLink(search),
          web: yahooTransitLink({
            origin: search.origin,
            destination: search.destination,
            departAt: search.basis === "depart" ? departLocal : "",
            arriveAt: search.basis === "arrive" ? arriveLocal : "",
            basis: search.basis,
          }),
        }
      : null;

  /** 元の移動を下書きに入れ、条件を覚えてから開く。移動はまだ変えない（戻した経路を保存したときに更新する） */
  const remember = () => {
    if (!condition || !purpose) return null;
    return rememberTransitSession(`${placeDisplayName(condition.origin)}→${placeDisplayName(condition.destination)}`, {
      travel,
      origin: condition.origin,
      destination: condition.destination,
      // 経由地は前の経路のもの。選び直した経路で置き換わるまで持ち越さない
      via: [],
      mode: "PUBLIC_TRANSIT",
      departAt: departLocal,
      arriveAt: arriveLocal,
      note: travel.note ?? undefined,
      linkedEvent: {
        id: event.id,
        calendarId: event.calendarId,
        startAt: event.start,
        endAt: event.end,
        title: event.title,
        location: event.location,
      },
      searchPurpose: purpose,
      searchMarginMinutes: margin,
      defaultArriveMargin,
      home,
    });
  };

  const openInApp = async () => {
    if (!links?.app) return;
    const session = remember();
    if (!session) return;
    const opened = await openTransitInNativeApp({
      appUrl: links.app,
      webUrl: links.web,
      session: { id: session.id, label: session.label, expiresAt: session.expiresAt },
    });
    if (opened === "failed") {
      setError("Yahoo!乗換案内を開けませんでした。");
      return;
    }
    onOpened();
  };

  const dismiss = async () => {
    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/travels/${encodeURIComponent(travel.id)}/follow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dismissKey: follow.key }),
      });
      if (!response.ok) {
        setError(await readErrorMessage(response, "保存できませんでした。"));
        return;
      }
      onDismissed();
    } catch {
      setError("保存できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const choosePurpose = (next: TravelSearchPurpose) => {
    setPurpose(next);
    setMarginText(String(next === "BEFORE_EVENT" ? defaultArriveMargin : 0));
  };

  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-item border border-outline-variant p-2.5">
      <span className="flex min-w-0 items-center gap-1.5 type-label-large">
        <TravelMark mode={travel.mode} className="size-3.5 shrink-0" />
        <span className="truncate">{travel.title}</span>
      </span>
      <span className="type-body-small text-on-surface-variant tabular-nums">
        いまの移動: {formatTime(travel.start)}–{formatTime(travel.end)}（変更していません）
      </span>
      {follow.reasons.length > 0 && (
        <span className="type-body-small">
          {event.title !== "" && `「${event.title}」の`}
          {follow.reasons.join("・")}
        </span>
      )}
      {follow.missing.map((message) => (
        <p key={message} className="type-body-small text-error">
          {message}
        </p>
      ))}

      {follow.missing.length === 0 && (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {(["BEFORE_EVENT", "AFTER_EVENT"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={purpose === value}
                onClick={() => choosePurpose(value)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 type-label-medium",
                  purpose === value
                    ? "border-transparent bg-secondary-container text-on-secondary-container"
                    : "border-outline-variant text-on-surface-variant",
                )}
              >
                {value === "BEFORE_EVENT" ? "予定前" : "予定後"}
              </button>
            ))}
            {follow.intent?.inferred && (
              <span className="type-label-small text-on-surface-variant">（推定。違えば選び直してください）</span>
            )}
          </div>
          <label className="flex items-center gap-2 type-body-small text-on-surface-variant">
            {purpose === "AFTER_EVENT" ? "予定の終了から何分後に出るか" : "予定の開始の何分前に着くか"}
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_TRAVEL_SEARCH_MARGIN_MINUTES}
              value={marginText}
              onChange={(e) => setMarginText(e.target.value)}
              className="h-8 w-20"
              aria-label="余裕分（分）"
            />
            分
          </label>
          {search?.ok ? (
            <span className="type-body-small">
              この条件で探す: {transitConditionSummary(search)}
            </span>
          ) : search && !search.ok ? (
            <span className="type-body-small text-error">{search.missing.join("・")}が足りないため探せません。移動を開いて入力してください。</span>
          ) : margin === null ? (
            <span className="type-body-small text-error">余裕分は0〜{MAX_TRAVEL_SEARCH_MARGIN_MINUTES}分で入力してください。</span>
          ) : null}
          {suggestion?.notes.map((note) => (
            <span key={note} className="type-body-small text-on-surface-variant">
              {note}
            </span>
          ))}
        </>
      )}

      {error && <p className="whitespace-pre-line text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap gap-1.5">
        {links?.app &&
          (native ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={openInApp}>
              Yahoo!で調べ直す
            </Button>
          ) : (
            <>
              <Button asChild size="sm" variant="outline">
                {/* 素の <a> で開く（iOSがアプリを開けるように。スクリプトから開くとブラウザへ落ちることがある） */}
                <a
                  href={links.app}
                  onClick={() => {
                    remember();
                    onOpened();
                  }}
                >
                  Yahoo!で調べ直す
                </a>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <a
                  href={links.web}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    remember();
                    onOpened();
                  }}
                >
                  Web版で調べる
                </a>
              </Button>
            </>
          ))}
        <Button size="sm" variant="ghost" disabled={busy} onClick={dismiss}>
          今は変更しない
        </Button>
      </div>
    </li>
  );
}
