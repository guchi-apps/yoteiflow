"use client";

import { useMemo, useState, useSyncExternalStore } from "react";

import { ExternalLink, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DateTimeInput } from "./date-time-input";
import { TimeField } from "./date-time-picker";
import { LinkifiedText } from "@/components/ui/linkified-text";
import { clearTransitInNativeApp, hasNativeTransit, openTransitInNativeApp, type NativeTransitOpened } from "@/lib/native-transit";
import { transitSearchCondition, yahooTransitAppLink } from "@/lib/yahoo-transit-app";
import { resolveResearchDestination, resolveYahooPlace, yahooTransitLink } from "@/lib/yahoo-transit-link";
import { originResearchDraft, rememberTransitSession } from "@/lib/transit-search-session";
import { readYahooRouteEndpoints, readYahooRouteRestartPoints, truncateYahooRouteAt, type YahooRouteStop } from "@/lib/yahoo-transit-route";
import type { PlaceItem } from "@/services/notion/places";
import type { TravelContinueFrom, TravelItem } from "@/types/calendar";

import { isoToLocalInput, localInputToIso } from "./datetime-fields";

type Segment = { kind: "text"; text: string } | { kind: "stop"; text: string; stop: YahooRouteStop };

/**
 * 移動のメモ（issue #1515）。Yahoo!乗換案内の経路なら、途中駅の行に「ここから再検索」を置く。
 *
 * 遅れなどで途中の乗り継ぎ時刻が変わったとき、その駅から先だけを調べ直すため。
 * 途中駅が読めないメモは従来どおり `LinkifiedText` だけで描く。検索結果は取りにいかず、
 * Yahoo!乗換案内のURLを開くだけ（docs/spec.md §29）。
 */
export function TravelNote({
  note,
  startIso,
  timeZone,
  destination,
  places,
  readOnly,
  travel,
}: {
  note: string;
  /** 移動の出発時刻（ISO）。途中駅の日付は、この日（設定タイムゾーン）を基準にする。 */
  startIso: string;
  timeZone: string;
  destination: string;
  places: PlaceItem[];
  /** オフライン中。Yahoo!乗換案内は通信が要るためボタンを出さない。 */
  readOnly: boolean;
  /**
   * この経路を持つ移動。渡すと、出発駅からの再検索はこの移動を更新し（issue #1645）、途中駅からの再検索は
   * 選んだ経路を元の移動の続きとして登録できる（issue #1642）。渡さない（移動に紐づかないメモ）なら従来どおり。
   */
  travel?: TravelItem;
}) {
  const [selected, setSelected] = useState<YahooRouteStop | null>(null);

  const segments = useMemo<Segment[]>(() => {
    const stops = readYahooRouteRestartPoints(note);
    if (stops.length === 0) return [{ kind: "text", text: note }];

    const lines = note.split(/\r?\n/);
    const byLine = new Map(stops.map((stop) => [stop.lineIndex, stop]));
    const result: Segment[] = [];
    let buffer: string[] = [];

    lines.forEach((line, index) => {
      const stop = byLine.get(index);
      if (!stop) {
        buffer.push(line);
        return;
      }
      if (buffer.length > 0) result.push({ kind: "text", text: buffer.join("\n") });
      buffer = [];
      result.push({ kind: "stop", text: line, stop });
    });
    if (buffer.length > 0) result.push({ kind: "text", text: buffer.join("\n") });
    return result;
  }, [note]);

  return (
    <div className="flex min-w-0 flex-col text-on-surface-variant">
      {segments.map((segment, index) =>
        segment.kind === "text" ? (
          <LinkifiedText key={index} text={segment.text} />
        ) : (
          <div key={index} className="flex min-w-0 items-center gap-2">
            <span className={readOnly ? "min-w-0 break-words" : "min-w-0 truncate"}>{segment.text}</span>
            {!readOnly && (
              <>
                {/* 駅名からボタンへ引く線。どの駅からの再検索かを読ませる（issue #1640） */}
                <span aria-hidden className="h-0 min-w-2 flex-1 border-t-[1.5px] border-dotted border-primary/60" />
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  aria-label={`${segment.stop.station}から再検索`}
                  onClick={() => setSelected(segment.stop)}
                >
                  <RefreshCw className="size-3.5" />
                  再検索
                </Button>
              </>
            )}
          </div>
        ),
      )}

      {selected && (
        <ResearchSheet
          stop={selected}
          startIso={startIso}
          timeZone={timeZone}
          destination={destination}
          places={places}
          travel={travel}
          noteText={note}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

/** 再検索の確認シート。出発時刻は既定でその駅の発車時刻で、遅れたときは直せる。経路カードからも開く（issue #1763）。 */
export function ResearchSheet({
  stop,
  startIso,
  timeZone,
  destination,
  places,
  travel,
  noteText,
  onClose,
}: {
  stop: YahooRouteStop;
  startIso: string;
  timeZone: string;
  destination: string;
  places: PlaceItem[];
  travel?: TravelItem;
  noteText: string;
  onClose: () => void;
}) {
  // 開いたままアンマウントすると<body>のpointer-eventsが残るため、閉じ切ってから返す。
  const [open, setOpen] = useState(true);
  const [date, setDate] = useState(() => addDays(zonedDateKey(startIso, timeZone), stop.dayOffset));
  const [time, setTime] = useState(stop.departTime ?? "");
  // 欄を直しても元の出発日時が分かるよう、開いた時点の値を別に持つ（発車時刻が読めない駅では出さない）
  const [originalDeparture] = useState(() =>
    stop.departTime ? formatOriginalDeparture(addDays(zonedDateKey(startIso, timeZone), stop.dayOffset), stop.departTime) : "",
  );

  const close = () => {
    setOpen(false);
    setTimeout(onClose, 150);
  };

  const origin = resolveYahooPlace(stop.station, places);
  // 検索の目的地は経路の到着駅を優先する（issue #1674）。保存用の下書き（destination）は変えない
  const target = resolveResearchDestination(destination, readYahooRouteEndpoints(noteText).destination, places);
  const departAt = date && time ? `${date}T${time}` : "";
  const href = yahooTransitLink({ origin, destination: target, departAt, arriveAt: "", basis: "depart" });
  // アプリ用のリンク（issue #1520）。Web用のURLはiOSでUniversal Linkとしてアプリに渡ると、日時の指定が
  // 捨てられて「いま」で検索される。移動の入力画面（#1330）と同じ `ytransit://` で日時ごと渡す。
  // 発着地・日時が揃わなければ null で、Web版だけで開く。
  const condition = transitSearchCondition({ origin, destination: target, departAt, arriveAt: "", basis: "depart" });
  const appHref = condition.ok ? yahooTransitAppLink(condition) : null;
  const nativeTransit = useSyncExternalStore(() => () => {}, hasNativeTransit, () => false);
  const [opened, setOpened] = useState<NativeTransitOpened | null>(null);

  /** アプリ内: Yahoo!アプリを開く。開けなければアプリが同じ条件のWeb版を開く */
  const updatesTravel = Boolean(travel && stop.isOrigin);
  const openInNativeApp = async () => {
    if (travel && stop.isOrigin) {
      // 出発駅からの再検索は、今の移動を更新対象として覚える。共有で戻った経路で移動の編集画面を開き、
      // 経路の詳細も置き換える（保存は利用者が確かめてから・issue #1645）
      const session = rememberTransitSession(
        `${stop.station}→${target?.name ?? destination}`,
        originResearchDraft(travel, {
          departAt: isoToLocalInput(travel.start, timeZone),
          arriveAt: isoToLocalInput(travel.end, timeZone),
        }),
      );
      setOpened(
        await openTransitInNativeApp({
          appUrl: appHref ?? "",
          webUrl: href,
          session: { id: session.id, label: session.label, expiresAt: session.expiresAt },
        }),
      );
      return;
    }
    // 途中駅からの再検索は、共有で戻した経路を「元の移動の続き」として登録する下書きを置く（issue #1642）。
    // 続きにできない（移動に紐づかない・駅への到着が読めない）ときは下書きを持たず、移動の入力画面で
    // 置いた印が残っていると別の移動の下書きへ反映されうるため、開く前に消す。
    const continueFrom = travel ? buildContinuation(travel, stop, noteText, timeZone, startIso, date, time) : null;
    if (!continueFrom) {
      clearTransitInNativeApp();
      setOpened(await openTransitInNativeApp({ appUrl: appHref ?? "", webUrl: href, session: null }));
      return;
    }
    const session = rememberTransitSession(`${continueFrom.title}の続き`, {
      origin: stop.station,
      destination: travel!.destination,
      mode: "PUBLIC_TRANSIT",
      departAt: departAt,
      arriveAt: "",
      continueFrom,
    });
    setOpened(
      await openTransitInNativeApp({
        appUrl: appHref ?? "",
        webUrl: href,
        session: { id: session.id, label: session.label, expiresAt: session.expiresAt },
      }),
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      {/* 開いた直後に出発日の欄へフォーカスが移ると端末の日付ピッカーが開くため、自動フォーカスを止める（issue #1641） */}
      <DialogContent position="bottom" onOpenAutoFocus={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{stop.station}から再検索</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 text-sm">
          <p className="text-on-surface-variant">
            {stop.station} → {target?.name ?? destination}
          </p>
          {originalDeparture && (
            <p className="text-on-surface-variant">
              元の出発 <span className="text-on-surface">{originalDeparture}</span>
            </p>
          )}
          {/* 端末ネイティブの日付・時刻欄ではなく、押して選ぶ1行にする（issue #1771）。 */}
          <div className="flex flex-wrap items-center gap-x-2 border-t border-outline-variant">
            <DateTimeInput id="travel-research-date" label="出発" value={date} onChange={setDate} dateOnly flat />
            <TimeField label="出発時刻" value={time} onChange={setTime} />
            {time && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setTime("")}>
                時刻を外す
              </Button>
            )}
          </div>
          {nativeTransit && updatesTravel && (
            <p className="text-xs text-on-surface-variant">
              出発駅からの再検索は、この移動を選んだ経路で更新します（保存の前に確かめられます）。
            </p>
          )}
          {opened && opened !== "app" && (
            <p className="text-xs text-on-surface-variant" role="status">
              {opened === "web" ? "アプリを開けなかったため、Web版で開きました。" : "Yahoo!乗換案内を開けませんでした。"}
            </p>
          )}
          {!time && (
            <p className="text-xs text-on-surface-variant">
              時刻を入れると、その時刻に出発する経路で調べます。空のままでは時刻を指定せずに開きます。
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            閉じる
          </Button>
          {nativeTransit ? (
            <Button onClick={() => void openInNativeApp()}>
              Yahoo!乗換案内で検索
              <ExternalLink className="size-3.5" />
            </Button>
          ) : (
            <>
              {/* 素の<a>。アプリ未導入の端末でブラウザが警告を出すため、Web版を自動では試さず並べて選ばせる */}
              {appHref && (
                <Button asChild variant="outline" className="hidden pointer-coarse:inline-flex">
                  <a href={appHref}>
                    アプリで検索
                    <ExternalLink className="size-3.5" />
                  </a>
                </Button>
              )}
              <Button asChild>
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {appHref ? "Yahoo!乗換案内（Web版）で検索" : "Yahoo!乗換案内で検索"}
                  <ExternalLink className="size-3.5" />
                </a>
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 再検索駅までに切り詰めたあとの元の移動（issue #1642）。駅への到着時刻が読めないときは、再検索の
 * 出発日時を使う。切り詰め後の到着が出発以前になる（＝切り詰められない）ときは null。
 */
function buildContinuation(
  travel: TravelItem,
  stop: YahooRouteStop,
  noteText: string,
  timeZone: string,
  startIso: string,
  searchDate: string,
  searchTime: string,
): TravelContinueFrom | null {
  const baseDate = zonedDateKey(startIso, timeZone);
  const arriveLocal = stop.arriveTime
    ? `${addDays(baseDate, stop.arriveDayOffset)}T${stop.arriveTime}`
    : searchDate && searchTime
      ? `${searchDate}T${searchTime}`
      : "";
  if (!arriveLocal) return null;
  const arriveAt = localInputToIso(arriveLocal, timeZone);
  if (new Date(arriveAt).getTime() <= new Date(travel.start).getTime()) return null;
  return {
    travelId: travel.id,
    title: travel.title,
    destination: stop.station,
    arriveAt,
    routeDetail: truncateYahooRouteAt(noteText, stop.lineIndex, stop.station),
  };
}

/** 設定タイムゾーンでの日付キー（`YYYY-MM-DD`）。 */
function zonedDateKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** `2026/11/17(火) 22:52` の形。曜日は日付キーそのものから求める（実行環境のタイムゾーンに依存させない）。 */
function formatOriginalDeparture(dateKey: string, time: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const weekday = "日月火水木金土"[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${year}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}(${weekday}) ${time}`;
}

function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
