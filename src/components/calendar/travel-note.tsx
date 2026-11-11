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
import { Input } from "@/components/ui/input";
import { LinkifiedText } from "@/components/ui/linkified-text";
import { clearTransitInNativeApp, hasNativeTransit, openTransitInNativeApp, type NativeTransitOpened } from "@/lib/native-transit";
import { transitSearchCondition, yahooTransitAppLink } from "@/lib/yahoo-transit-app";
import { resolveYahooPlace, yahooTransitLink } from "@/lib/yahoo-transit-link";
import { readYahooRouteStops, type YahooRouteStop } from "@/lib/yahoo-transit-route";
import type { PlaceItem } from "@/services/notion/places";

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
}: {
  note: string;
  /** 移動の出発時刻（ISO）。途中駅の日付は、この日（設定タイムゾーン）を基準にする。 */
  startIso: string;
  timeZone: string;
  destination: string;
  places: PlaceItem[];
  /** オフライン中。Yahoo!乗換案内は通信が要るためボタンを出さない。 */
  readOnly: boolean;
}) {
  const [selected, setSelected] = useState<YahooRouteStop | null>(null);

  const segments = useMemo<Segment[]>(() => {
    const stops = readYahooRouteStops(note);
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
          <div key={index} className="flex min-w-0 items-center justify-between gap-2">
            <span className="min-w-0 break-words">{segment.text}</span>
            {!readOnly && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setSelected(segment.stop)}
              >
                <RefreshCw className="size-3.5" />
                ここから再検索
              </Button>
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
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

/** 再検索の確認シート。出発時刻は既定でその駅の発車時刻で、遅れたときは直せる。 */
function ResearchSheet({
  stop,
  startIso,
  timeZone,
  destination,
  places,
  onClose,
}: {
  stop: YahooRouteStop;
  startIso: string;
  timeZone: string;
  destination: string;
  places: PlaceItem[];
  onClose: () => void;
}) {
  // 開いたままアンマウントすると<body>のpointer-eventsが残るため、閉じ切ってから返す。
  const [open, setOpen] = useState(true);
  const [date, setDate] = useState(() => addDays(zonedDateKey(startIso, timeZone), stop.dayOffset));
  const [time, setTime] = useState(stop.departTime ?? "");

  const close = () => {
    setOpen(false);
    setTimeout(onClose, 150);
  };

  const origin = resolveYahooPlace(stop.station, places);
  const target = resolveYahooPlace(destination, places);
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
  const openInNativeApp = async () => {
    // 再検索は共有で戻す下書きを持たない。移動の入力画面で置いた印が残っていると、ここで選んだ経路が
    // 別の移動の下書きへ反映されうるため、開く前に消す（ブリッジはメッセージを順に処理する）
    clearTransitInNativeApp();
    setOpened(await openTransitInNativeApp({ appUrl: appHref ?? "", webUrl: href, session: null }));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent position="bottom">
        <DialogHeader>
          <DialogTitle>{stop.station}から再検索</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 text-sm">
          <p className="text-on-surface-variant">
            {stop.station} → {resolveYahooPlace(destination, places)?.name ?? destination}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Input label="出発日" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <Input label="出発時刻" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
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

/** 設定タイムゾーンでの日付キー（`YYYY-MM-DD`）。 */
function zonedDateKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
