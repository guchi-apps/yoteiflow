"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { matchPlaceByText, placeDisplayName } from "@/lib/place-text";
import { isStationPlace } from "@/lib/place-tags";
import { chooseStation, placeStations, type PlaceStation, type StationChoice } from "@/lib/station-name";
import type { PlaceItem } from "@/services/notion/places";

/** 場所欄の値に当たる場所の最寄り駅。場所そのものが駅（「駅・空港」タグ）なら持たない扱い。 */
function stationsOf(text: string, places: PlaceItem[]): { place: PlaceItem | null; stations: PlaceStation[] } {
  const place = text.trim() ? matchPlaceByText(text, places) : null;
  if (!place || isStationPlace(place.tags)) return { place, stations: [] };
  return { place, stations: placeStations(place) };
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
    walkSideFor,
    walkChoiceFor,
  };
}

export type TransitStations = ReturnType<typeof buildTransitStations>;

function StationChips({
  question,
  label,
  stations,
  choice,
  onChoose,
}: {
  question: string;
  label: string;
  stations: PlaceStation[];
  choice: StationChoice;
  onChoose: (choice: StationChoice) => void;
}) {
  const current = chooseStation(stations, choice);
  const options: { key: string; text: string; value: StationChoice; on: boolean }[] = [
    ...stations.map((station) => ({
      key: station.name,
      text: station.minutes === null ? station.name : `${station.name}・徒歩${station.minutes}分`,
      value: station.name,
      on: current?.name === station.name,
    })),
    { key: "__point", text: "地点で探す", value: null, on: current === null },
  ];
  return (
    <div className="flex flex-col gap-1.5">
      <p className="type-label-large text-on-surface">
        {question}
        <span className="type-body-small ml-1 text-on-surface-variant">（{label}）</span>
      </p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={question}>
        {options.map((option) => (
          <Button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={option.on}
            variant={option.on ? "secondary" : "outline"}
            size="sm"
            onClick={() => onChoose(option.value)}
          >
            {option.text}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** 駅が2つ以上ある側だけ質問を出す。どちらも1つ以下なら何も描かない（従来と同じ見た目）。 */
export function TransitStationPicker({
  origin,
  destination,
  state,
  onChange,
}: {
  origin: string;
  destination: string;
  state: TransitStations;
  /** 選び直したあと（提案の時刻を合わせ直すため）。どちらの側を何にしたかを渡す */
  onChange?: (side: "origin" | "destination", choice: StationChoice) => void;
}) {
  const showOrigin = state.originStations.length >= 2;
  const showDestination = state.destinationStations.length >= 2;
  if (!showOrigin && !showDestination) return null;
  return (
    <div className="flex flex-col gap-2">
      {showOrigin && (
        <StationChips
          question="どの駅から乗りますか？"
          label={placeDisplayName(origin)}
          stations={state.originStations}
          choice={state.originChoice}
          onChoose={(choice) => {
            state.setOriginChoice(choice);
            onChange?.("origin", choice);
          }}
        />
      )}
      {showDestination && (
        <StationChips
          question="どの駅で降りますか？"
          label={placeDisplayName(destination)}
          stations={state.destinationStations}
          choice={state.destinationChoice}
          onChoose={(choice) => {
            state.setDestinationChoice(choice);
            onChange?.("destination", choice);
          }}
        />
      )}
    </div>
  );
}
