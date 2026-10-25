"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOffline } from "next/offline";
import { ExternalLink, Pencil, X } from "lucide-react";

import { TileMap, type MapMarker } from "@/components/calendar/tile-map";
import { Button } from "@/components/ui/button";
import { fitBounds, type LatLng } from "@/lib/coordinates";
import { mapLink } from "@/lib/map-link";
import { cn } from "@/lib/utils";
import type { PlaceItem } from "@/services/notion/places";

/** 地点を持つ場所が1件も無いときの中心（東京駅）。場所登録の地図と同じ既定。 */
const FALLBACK_CENTER: LatLng = { lat: 35.681236, lng: 139.767125 };
const FALLBACK_ZOOM = 11;

/** 一覧の行から選んだときに寄せるズーム。これより引いていたらここまで寄せる。 */
const FOCUS_ZOOM = 15;

/**
 * 登録した場所をピンで並べる地図（docs/spec.md §9・issue #1364）。
 *
 * 地図は場所登録で使っている自前のタイル地図（`TileMap`）をそのまま使い、依存を足さない。
 * 開いたとき・絞り込みで並ぶ場所が変わったときは、全部のピンが入る範囲へ合わせる。
 * 選んだ場所は、1024px以上ではピンの上の吹き出し、それより狭い幅では下端のカードで示す
 * （吹き出しは狭い枠だと端からはみ出すため）。
 */
export function PlacesMap({
  places,
  selectedId,
  onSelect,
  focus,
  onEdit,
  className,
}: {
  /** 絞り込み後の場所。地点の無いものは地図に出さず、件数だけ添える。 */
  places: PlaceItem[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** 一覧の行から選んだとき、その場所へ地図を寄せる合図。`seq` が変わるたびに寄せる。 */
  focus: { id: string; seq: number } | null;
  onEdit: (place: PlaceItem) => void;
  className?: string;
}) {
  const offline = useOffline();

  const located = useMemo(
    () => places.filter((place): place is PlaceItem & { coordinates: LatLng } => place.coordinates !== null),
    [places],
  );
  const missing = places.length - located.length;

  const markers = useMemo<MapMarker[]>(
    () => located.map((place) => ({ id: place.id, position: place.coordinates, label: place.name })),
    [located],
  );

  const [view, setView] = useState({ center: FALLBACK_CENTER, zoom: FALLBACK_ZOOM });
  const sizeRef = useRef<{ width: number; height: number } | null>(null);

  const fitAll = useCallback(() => {
    const size = sizeRef.current;
    if (!size || size.width === 0) return;
    const fitted = fitBounds(
      located.map((place) => place.coordinates),
      size,
      { padding: 56 },
    );
    if (fitted) setView(fitted);
  }, [located]);

  // 並ぶ場所の組が変わったら（初回・絞り込み）全体へ合わせ直す。中身の同じ配列が
  // 作り直されただけで地図が戻らないよう、IDの並びで見る。
  const locatedKey = located.map((place) => place.id).join(",");
  const fittedKeyRef = useRef<string | null>(null);
  const handleSizeChange = useCallback(
    (size: { width: number; height: number }) => {
      const first = sizeRef.current === null || sizeRef.current.width === 0;
      sizeRef.current = size;
      if (first && size.width > 0) {
        fittedKeyRef.current = locatedKey;
        fitAll();
      }
    },
    [fitAll, locatedKey],
  );
  useEffect(() => {
    if (fittedKeyRef.current === locatedKey || !sizeRef.current) return;
    fittedKeyRef.current = locatedKey;
    fitAll();
  }, [locatedKey, fitAll]);

  // 一覧の行から選ばれたら、その場所へ寄せる。地図の上でピンを押したときは動かさない
  // （押した地点が指の下から逃げると、続けて隣のピンを押しにくい）。
  const lastFocusRef = useRef<number | null>(null);
  useEffect(() => {
    if (!focus || lastFocusRef.current === focus.seq) return;
    lastFocusRef.current = focus.seq;
    const target = located.find((place) => place.id === focus.id);
    if (!target) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView((current) => ({ center: target.coordinates, zoom: Math.max(current.zoom, FOCUS_ZOOM) }));
  }, [focus, located]);

  const selected = located.find((place) => place.id === selectedId) ?? null;

  const detailBody = (fill: boolean) =>
    selected && (
      <PlaceSummary
        place={selected}
        fill={fill}
        offline={offline}
        onEdit={() => onEdit(selected)}
        onClose={() => onSelect(null)}
      />
    );

  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      <div className="relative min-h-0 flex-1">
        <TileMap
          className="absolute inset-0"
          center={view.center}
          zoom={view.zoom}
          onCenterChange={(center) => setView((current) => ({ ...current, center }))}
          onZoomChange={(zoom) => setView((current) => ({ ...current, zoom }))}
          showCenterPin={false}
          markers={markers}
          selectedMarkerId={selectedId}
          onMarkerSelect={onSelect}
          // 1024px以上は一覧の右に地図を並べる（本文＝画面幅のため lg: で切り替える）。
          selectedOverlay={selected && <div className="hidden lg:block">{detailBody(false)}</div>}
          onFitAll={located.length > 0 ? fitAll : undefined}
          onSizeChange={handleSizeChange}
        />

        <span className="type-label-medium pointer-events-none absolute top-2 left-2 rounded-full border border-outline-variant bg-surface-container-lowest px-3 py-1 text-on-surface-variant">
          {located.length > 0 ? `地図に出ているのは ${located.length}件` : "地点のある場所はありません"}
        </span>

        {selected && <div className="absolute inset-x-2 bottom-6 z-10 lg:hidden">{detailBody(true)}</div>}
      </div>

      {missing > 0 && (
        <p className="type-body-small text-on-surface-variant">
          地点（座標）の無い場所 {missing}件は地図に出ません。場所を開いて「地図で選ぶ」から地点を登録できます。
        </p>
      )}
    </div>
  );
}

function PlaceSummary({
  place,
  fill,
  offline,
  onEdit,
  onClose,
}: {
  place: PlaceItem & { coordinates: LatLng };
  /** 下端のカードとして枠の幅いっぱいに出すか。 */
  fill: boolean;
  offline: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  // 地図アプリは通信が要るため、オフライン中は出さない（予定の場所のリンクと同じ扱い）。
  const link = offline ? null : mapLink(place.address ?? place.name, place.coordinates);

  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-2xl border border-outline-variant bg-surface-container-lowest p-3 shadow-lg",
        fill ? "w-full" : "w-64",
      )}
    >
      <div className="flex items-start gap-2">
        <span className="type-title-medium min-w-0 flex-1 break-words">{place.name}</span>
        <button
          type="button"
          aria-label="閉じる"
          className="-m-1 grid size-7 shrink-0 place-items-center rounded-full text-on-surface-variant hover:bg-on-surface/8"
          onClick={onClose}
        >
          <X className="size-4" />
        </button>
      </div>
      <span className="type-body-small break-words text-on-surface-variant">
        {place.station ? `${place.address ?? "住所なし"} ・ ${place.station}` : (place.address ?? "住所なし")}
      </span>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" onClick={onEdit}>
          <Pencil />
          編集
        </Button>
        {link && (
          <Button size="sm" variant="outline" asChild>
            <a href={link} target="_blank" rel="noreferrer">
              <ExternalLink />
              Googleマップ
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
