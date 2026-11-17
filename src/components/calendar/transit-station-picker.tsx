"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

import { matchPlaceByText, placeDisplayName } from "@/lib/place-text";
import { isStationPlace } from "@/lib/place-tags";
import { chooseStation, placeStations, type PlaceStation, type StationChoice } from "@/lib/station-name";
import type { PlaceItem } from "@/services/notion/places";

/** 場所欄の値に当たる場所の最寄り駅。場所そのものが駅（「駅・空港」タグ）なら持たない扱い。 */
function stationsOf(text: string, places: PlaceItem[]): { place: PlaceItem | null; stations: PlaceStation[]; isStation: boolean } {
  const place = text.trim() ? matchPlaceByText(text, places) : null;
  if (!place) return { place, stations: [], isStation: false };
  if (isStationPlace(place.tags)) return { place, stations: [], isStation: true };
  return { place, stations: placeStations(place), isStation: false };
}

/**
 * Yahoo!乗換案内で探すときの乗る駅・降りる駅の選択（issue #1607）。
 *
 * 発着地の場所に最寄り駅が2つ以上あるときだけ選ばせる。自動では決めない（Yahoo!の結果を機械取得
 * できず、どちらが良い経路か判定する材料が無い・docs/spec.md §29）。初期は利用者が並べた先頭の駅。
 * 選んだ駅は保存しない。発着地を別の場所へ直すと、登録に無い駅名は先頭へ落ちる（`chooseStation`）。
 *
 * `walkChoiceFor` は予定の場所が出発地・目的地のどちらかと同じ場所のとき、その側の選択を返す。
 * 予定の場所の最寄り駅からの徒歩（`stationWalkMinutes`）を選んだ駅に合わせるため。
 */
export function useTransitStations(origin: string, destination: string, places: PlaceItem[]) {
  const [originChoice, setOriginChoice] = useState<StationChoice>(undefined);
  const [destinationChoice, setDestinationChoice] = useState<StationChoice>(undefined);
  return buildTransitStations(origin, destination, places, {
    originChoice,
    destinationChoice,
    setOriginChoice,
    setDestinationChoice,
  });
}

/**
 * 選択の状態（呼び出し側の useState）から、駅の一覧と予定の場所の側の判定を組み立てる。
 * 発着地が選択より後で決まる画面（調べ直し）は、状態だけ先に持ってこちらを呼ぶ。
 */
export function buildTransitStations(
  origin: string,
  destination: string,
  places: PlaceItem[],
  choices: {
    originChoice: StationChoice;
    destinationChoice: StationChoice;
    setOriginChoice: (choice: StationChoice) => void;
    setDestinationChoice: (choice: StationChoice) => void;
  },
) {
  const from = stationsOf(origin, places);
  const to = stationsOf(destination, places);
  /** 予定の場所が目的地・出発地のどちらの場所か（目的地を先に見る）。どちらでもなければ null */
  const walkSideFor = (location: string | null | undefined): "origin" | "destination" | null => {
    const place = location ? matchPlaceByText(location, places) : null;
    if (!place) return null;
    if (to.place?.id === place.id) return "destination";
    if (from.place?.id === place.id) return "origin";
    return null;
  };
  const walkChoiceFor = (location: string | null | undefined): StationChoice => {
    const side = walkSideFor(location);
    return side === "destination" ? choices.destinationChoice : side === "origin" ? choices.originChoice : undefined;
  };
  return {
    ...choices,
    originStations: from.stations,
    destinationStations: to.stations,
    originIsStation: from.isStation,
    destinationIsStation: to.isStation,
    originRegistered: from.place !== null,
    destinationRegistered: to.place !== null,
    walkSideFor,
    walkChoiceFor,
  };
}

export type TransitStations = ReturnType<typeof buildTransitStations>;

/** 「地点で探す」の言い換え（駅を使わず、登録した場所の位置から探す）。 */
const POINT_LABEL = "登録地から探す";
const POINT_HINT = "最寄り駅を使わず、この場所の位置で検索";

/**
 * 左右どちらかの駅選択。閉じているときは選んでいる駅1つだけを出し、押すと他の選択肢を開く。
 * 最寄り駅が無いときは理由を文で出す（場所が駅そのもの・未登録・最寄り駅の未設定を分ける）。
 */
function StationColumn({
  id,
  heading,
  label,
  stations,
  isStation,
  registered,
  choice,
  onChoose,
}: {
  id: string;
  heading: string;
  label: string;
  stations: PlaceStation[];
  isStation: boolean;
  registered: boolean;
  choice: StationChoice;
  onChoose: (choice: StationChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = chooseStation(stations, choice);
  const title = (
    <p className="type-label-small mb-1 truncate text-on-surface-variant">
      {heading}
      {label && <span className="ml-1 text-on-surface">{label}</span>}
    </p>
  );
  if (stations.length === 0) {
    const message = isStation
      ? "この場所は駅なので、駅名で探します"
      : registered
        ? "最寄り駅が設定されていません"
        : label
          ? `${POINT_LABEL}（未登録の場所）`
          : "場所が未入力です";
    return (
      <div className="min-w-0">
        {title}
        <p className="type-body-small rounded-md border border-dashed border-outline-variant px-2.5 py-2 text-on-surface-variant">
          {message}
        </p>
      </div>
    );
  }
  const options: { key: string; text: string; hint: string | null; value: StationChoice; on: boolean }[] = [
    ...stations.map((station) => ({
      key: station.name,
      text: station.name,
      hint: station.minutes === null ? null : `徒歩${station.minutes}分`,
      value: station.name as StationChoice,
      on: current?.name === station.name,
    })),
    { key: "__point", text: POINT_LABEL, hint: POINT_HINT, value: null, on: current === null },
  ];
  const selected = options.find((option) => option.on) ?? options[0];
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <div className="min-w-0">
      {title}
      <div className="overflow-hidden rounded-md border border-outline-variant bg-surface-container">
        {(open ? options : [selected]).map((option, index) => (
          <button
            key={option.key}
            type="button"
            role={open ? "radio" : undefined}
            aria-checked={open ? option.on : undefined}
            aria-expanded={open ? undefined : false}
            aria-label={open ? undefined : `${heading}の駅を選ぶ（現在: ${option.text}）`}
            id={index === 0 ? id : undefined}
            onClick={() => {
              if (!open) return setOpen(true);
              onChoose(option.value);
              setOpen(false);
            }}
            className={`flex w-full items-center justify-between gap-1.5 px-2.5 py-2 text-left ${
              open && option.on ? "bg-secondary-container" : ""
            } ${index > 0 ? "border-t border-outline-variant" : ""}`}
          >
            <span className="min-w-0">
              <span className="type-body-medium block truncate text-on-surface">{option.text}</span>
              {option.hint && <span className="type-label-small block text-on-surface-variant">{option.hint}</span>}
            </span>
            {(!open || index === 0) && <Chevron className="size-4 shrink-0 text-on-surface-variant" aria-hidden />}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 左＝出発地・右＝到着地の駅選択。既定は両側とも常に出す（最寄り駅が1つでも・無くても。issue #1629）。
 * `onlyWhenChoosable` のときは従来どおり、どちらかが2つ以上あるときだけ描く（再提案ダイアログ）。
 */
export function TransitStationPicker({
  origin,
  destination,
  state,
  onChange,
  onlyWhenChoosable = false,
}: {
  origin: string;
  destination: string;
  state: TransitStations;
  /** 選び直したあと（提案の時刻を合わせ直すため）。どちらの側を何にしたかを渡す */
  onChange?: (side: "origin" | "destination", choice: StationChoice) => void;
  onlyWhenChoosable?: boolean;
}) {
  if (onlyWhenChoosable && state.originStations.length < 2 && state.destinationStations.length < 2) return null;
  return (
    <div className="grid grid-cols-2 gap-2" role="group" aria-label="乗る駅・降りる駅">
      <StationColumn
        id="transit-origin-station"
        heading="出発地"
        label={origin.trim() ? placeDisplayName(origin) : ""}
        stations={state.originStations}
        isStation={state.originIsStation}
        registered={state.originRegistered}
        choice={state.originChoice}
        onChoose={(choice) => {
          state.setOriginChoice(choice);
          onChange?.("origin", choice);
        }}
      />
      <StationColumn
        id="transit-destination-station"
        heading="到着地"
        label={destination.trim() ? placeDisplayName(destination) : ""}
        stations={state.destinationStations}
        isStation={state.destinationIsStation}
        registered={state.destinationRegistered}
        choice={state.destinationChoice}
        onChoose={(choice) => {
          state.setDestinationChoice(choice);
          onChange?.("destination", choice);
        }}
      />
    </div>
  );
}
