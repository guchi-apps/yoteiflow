"use client";

import { Fragment, useId, useMemo, useState } from "react";

import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LinkifiedText } from "@/components/ui/linkified-text";
import { cn } from "@/lib/utils";
import {
  minutesBetween,
  yahooRouteRows,
  type YahooRouteLegView,
  type YahooRouteStationView,
  type YahooRouteTransfer,
  type YahooRouteView,
} from "@/lib/yahoo-route-view";
import { readYahooRouteRestartPoints, type YahooRouteStop } from "@/lib/yahoo-transit-route";
import type { PlaceItem } from "@/services/notion/places";
import type { TravelItem } from "@/types/calendar";

import { ResearchSheet } from "./travel-note";

/** 駅と区間で共有する列。時刻・線・内容・ボタン。 */
const COLUMNS = "grid grid-cols-[3rem_1rem_minmax(0,1fr)_auto] gap-x-2";

/**
 * Yahoo!乗換案内の経路カード（issue #1763・docs/spec.md §29）。
 *
 * 上に要約、下に駅と路線の縦の流れ。「再検索」を置く駅は文字表示のとき（`TravelNote`）と同じで、
 * 押したあとの画面も同じ `ResearchSheet` を使う。原文は下端から開ける。
 */
export function TravelRouteCard({
  view,
  text,
  startIso,
  timeZone,
  destination,
  places,
  readOnly,
  travel,
}: {
  view: YahooRouteView;
  /** 経路の原文。 */
  text: string;
  startIso: string;
  timeZone: string;
  destination: string;
  places: PlaceItem[];
  /** オフライン中。再検索は通信が要るためボタンを出さない。 */
  readOnly: boolean;
  travel: TravelItem;
}) {
  const [selected, setSelected] = useState<YahooRouteStop | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const rawId = useId();
  const restartPoints = useMemo(
    () => new Map(readYahooRouteRestartPoints(text).map((stop) => [stop.lineIndex, stop])),
    [text],
  );

  const rows = yahooRouteRows(view);

  const summary = [
    view.minutes !== null ? formatMinutes(view.minutes) : null,
    view.transfers !== null ? `乗換 ${view.transfers}回` : null,
    view.fare ? `運賃 ${view.fare}` : null,
    view.distance,
  ].filter(Boolean);

  return (
    // overflow-hiddenだと縦並びの中で縮められて中身が切れるため、角の切り抜きはclipにする
    <section aria-label="経路" className="min-w-0 overflow-clip rounded-xl border border-outline-variant bg-surface-container-lowest">
      <div className="flex flex-col gap-0.5 border-b border-outline-variant bg-surface-container-low px-3 py-2.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          {view.departTime && view.arriveTime && (
            <span className="text-xl font-bold tabular-nums">
              {view.departTime} → {view.arriveTime}
            </span>
          )}
          {summary.map((item) => (
            <span key={item} className="text-xs text-on-surface-variant">
              {item}
            </span>
          ))}
        </div>
        {view.walkNote && <span className="text-xs text-on-surface-variant">この移動は{view.walkNote}</span>}
      </div>

      <ol className="flex flex-col px-3 py-2">
        {rows.map(({ station, leg, legIndex, transfer }, index) => {
          const restart = restartPoints.get(transfer?.restartLineIndex ?? station.lineIndex);
          return (
            <Fragment key={station.lineIndex}>
              <li className={cn(COLUMNS, "min-h-9 items-center")}>
                <StationTimes
                  arriveTime={transfer?.arriveTime ?? station.arriveTime}
                  departTime={transfer?.departTime ?? station.departTime}
                />
                <span aria-hidden className="size-3.5 justify-self-center rounded-full border-[3px] border-travel" />
                <span className="min-w-0 break-words">
                  <span className="text-base font-bold">{transfer?.names.join(" → ") ?? station.name}</span>
                  {transfer ? (
                    <Badge label={`乗換 ${formatMinutes(transfer.minutes)}`} />
                  ) : (
                    <TransferBadge station={station} middle={index > 0 && index < rows.length - 1} />
                  )}
                  {transfer && <TransferDetail transfer={transfer} />}
                </span>
                {restart && !readOnly ? (
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`${restart.station}から再検索`}
                    onClick={() => setSelected(restart)}
                  >
                    <RefreshCw className="size-3.5" />
                    再検索
                  </Button>
                ) : (
                  <span />
                )}
              </li>
              {leg && <Leg leg={leg} alternate={legIndex % 2 === 1} />}
            </Fragment>
          );
        })}
      </ol>

      {view.notes.length > 0 && (
        <div className="border-t border-outline-variant px-3 py-2 text-xs text-on-surface-variant">
          <LinkifiedText text={view.notes.join("\n")} />
        </div>
      )}

      <div className="border-t border-outline-variant">
        <button
          type="button"
          aria-expanded={rawOpen}
          aria-controls={rawId}
          onClick={() => setRawOpen((value) => !value)}
          className="flex min-h-10 w-full items-center justify-between px-3 text-left text-xs font-bold text-primary focus-visible:outline-2 focus-visible:-outline-offset-2"
        >
          取り込んだ原文を{rawOpen ? "閉じる" : "表示"}
          {rawOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
        <div id={rawId} hidden={!rawOpen} className="max-h-[30dvh] overflow-y-auto px-3 pb-2 text-on-surface-variant">
          <LinkifiedText text={text} />
        </div>
      </div>

      {selected && (
        <ResearchSheet
          stop={selected}
          startIso={startIso}
          timeZone={timeZone}
          destination={destination}
          places={places}
          travel={travel}
          noteText={text}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}

/** 駅の左の時刻。乗換駅は到着と発車の2段。読み上げで区別できるよう「着」「発」を添える。 */
function StationTimes({ arriveTime, departTime }: { arriveTime: string | null; departTime: string | null }) {
  return (
    <span className="flex flex-col items-end font-bold leading-tight tabular-nums">
      {arriveTime && (
        <span>
          {arriveTime}
          <span className="sr-only">着</span>
        </span>
      )}
      {departTime && (
        <span>
          {departTime}
          <span className="sr-only">発</span>
        </span>
      )}
    </span>
  );
}

function TransferBadge({ station, middle }: { station: YahooRouteStationView; middle: boolean }) {
  const wait =
    middle && station.arriveTime && station.departTime ? minutesBetween(station.arriveTime, station.departTime) : null;
  const label = station.tag ?? (wait !== null ? `乗換 ${formatMinutes(wait)}` : null);
  if (!label) return null;
  return <Badge label={label} />;
}

function Badge({ label }: { label: string }) {
  return (
    <span className="ml-1.5 inline-block rounded-xs bg-travel-container px-1.5 text-xs font-bold text-on-travel-container">
      {label}
    </span>
  );
}

/** まとめた乗換の内訳（徒歩と待ち）。徒歩の区間にあった番線なども落とさず添える。 */
function TransferDetail({ transfer }: { transfer: YahooRouteTransfer }) {
  const breakdown =
    transfer.walkMinutes !== null && transfer.waitMinutes !== null
      ? [
          `徒歩 ${formatMinutes(transfer.walkMinutes)}`,
          transfer.waitMinutes > 0 ? `待ち ${formatMinutes(transfer.waitMinutes)}` : null,
        ]
          .filter(Boolean)
          .join("・")
      : "徒歩を含む";
  return (
    <span className="block text-xs text-on-surface-variant">
      {breakdown}
      {transfer.walkLines.length > 0 && <LinkifiedText text={transfer.walkLines.join("\n")} />}
    </span>
  );
}

/** 駅と駅のあいだ。線の色は区間の切れ目を見せるためのもので、路線は名前で示す。徒歩は点線。 */
function Leg({ leg, alternate }: { leg: YahooRouteLegView; alternate: boolean }) {
  return (
    <li className={COLUMNS}>
      <span className="self-center text-right text-xs text-on-surface-variant tabular-nums">
        {leg.minutes !== null && formatMinutes(leg.minutes)}
      </span>
      <span
        aria-hidden
        className={cn(
          "justify-self-center",
          leg.walk
            ? "border-l-[3px] border-dotted border-outline"
            : cn("w-1.5 rounded-full", alternate ? "bg-primary" : "bg-travel"),
        )}
      />
      <span className="col-span-2 flex min-h-8 min-w-0 flex-col justify-center py-1.5 break-words">
        {leg.names.map((name, index) => (
          <span key={index} className="font-bold">
            {name}
          </span>
        ))}
        {leg.platforms.length > 0 && (
          <span className="text-xs text-on-surface-variant">{leg.platforms.join("・")}</span>
        )}
        {leg.extras.length > 0 && (
          <span className="text-xs text-on-surface-variant">
            <LinkifiedText text={leg.extras.join("\n")} />
          </span>
        )}
      </span>
    </li>
  );
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}分`;
  return rest === 0 ? `${hours}時間` : `${hours}時間${rest}分`;
}
