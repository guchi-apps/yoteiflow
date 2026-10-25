"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { LocateFixed, Minus, Plus, Scan } from "lucide-react";

import { cn } from "@/lib/utils";
import { project, unproject, TILE_SIZE, type LatLng } from "@/lib/coordinates";

/**
 * OpenStreetMapのラスタタイルを敷いた地図（docs/spec.md §9）。
 *
 * 地図ライブラリを入れずに自前で描いている。ここで要るのは「中心の1点を選ぶ」ことだけで、
 * 経路・レイヤ・マーカー群といったライブラリの主機能を使わない。Service Workerを自前で
 * 書いているのと同じく、依存を増やさずに済む範囲に収める。
 *
 * **ピンは常に画面の中央で、動かすのは地図の側。** 押した位置にピンを落とす方式だと、
 * 押している指がその地点を隠すうえ、拡大縮小のたびにピンと地図がずれる。
 * 拡大縮小も常に中心を軸にするため、選んでいる地点は操作の間ずっと動かない。
 */

/** タイルの取得先。提供元を変えるときはここだけ直す。 */
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/** OpenStreetMapのタイルがある範囲。19より内側は用意されていない。 */
const MIN_ZOOM = 3;
const MAX_ZOOM = 19;

/** ホイール1目盛りあたりのズーム量。1回転で1段ぶんくらいになる値。 */
const WHEEL_SENSITIVITY = 0.002;

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** これより動いた操作はドラッグとして扱い、ピンのタップにしない（px）。 */
const TAP_SLOP = 6;

/** タップした位置からこの距離（px）までのピンを押したことにする。指の太さぶんの余裕。 */
const MARKER_HIT_RADIUS = 22;

/** 置いたピンの絵の大きさ（px）。選んでいるものは大きくする。 */
const MARKER_SIZE = 28;
const MARKER_SIZE_SELECTED = 36;

/** 地図に置くピン（場所画面の地図・issue #1364）。 */
export type MapMarker = {
  id: string;
  position: LatLng;
  label?: string;
};

function tileUrl(x: number, y: number, z: number): string {
  return TILE_URL.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

export function TileMap({
  center,
  zoom,
  onCenterChange,
  onZoomChange,
  onLocate,
  locating = false,
  showCenterPin = true,
  markers = [],
  selectedMarkerId = null,
  onMarkerSelect,
  selectedOverlay,
  onFitAll,
  onSizeChange,
  className,
}: {
  center: LatLng;
  zoom: number;
  onCenterChange: (center: LatLng) => void;
  onZoomChange: (zoom: number) => void;
  /** 「現在地へ」を押したとき。位置情報の取得は呼び出し側が持つ。 */
  onLocate?: () => void;
  locating?: boolean;
  /** 中央の選択用ピンを出すか。地点を選ぶ地図（既定）で出し、場所を見せるだけの地図では消す。 */
  showCenterPin?: boolean;
  /** 地図に置くピン。地図と一緒に動く。 */
  markers?: MapMarker[];
  selectedMarkerId?: string | null;
  /** ピンを押したとき（何も無い所を押したときは null）。 */
  onMarkerSelect?: (id: string | null) => void;
  /** 選んでいるピンの上に出す吹き出し。 */
  selectedOverlay?: ReactNode;
  /** 「全体を表示」を押したとき。渡したときだけボタンを出す。 */
  onFitAll?: () => void;
  /** 枠の大きさが決まった・変わったとき。全体が入るズームの計算に使う。 */
  onSizeChange?: (size: { width: number; height: number }) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);

  // ピンのタップ判定。ピンの要素はイベントを受けず（地図がポインタをキャプチャするため
  // clickが届かない）、押してから離すまでの移動量で地図のドラッグと見分ける。
  // こうするとピンの上から地図を掴んで動かすこともできる。
  const tapRef = useRef<{ x: number; y: number; moved: boolean; multi: boolean } | null>(null);

  // 押している指・ポインタの現在位置。2本になった時点でピンチとして扱う。
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  // 操作を始めた時点の状態。動かしている間の基準にする。
  const gestureRef = useRef<{
    pointer: { x: number; y: number };
    center: LatLng;
    zoom: number;
    distance: number | null;
  } | null>(null);

  // 最新の値をイベントハンドラから読む。ホイールは非パッシブで直接購読しており、
  // 中心が変わるたびにリスナーを張り直すと、動かしている最中のイベントを取りこぼす。
  const stateRef = useRef({ center, zoom });
  useEffect(() => {
    stateRef.current = { center, zoom };
  }, [center, zoom]);

  const onSizeChangeRef = useRef(onSizeChange);
  useEffect(() => {
    onSizeChangeRef.current = onSizeChange;
  }, [onSizeChange]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      const next = { width: entry.contentRect.width, height: entry.contentRect.height };
      setSize(next);
      onSizeChangeRef.current?.(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // ホイールでの拡大縮小。ページのスクロールを止める必要があるため、
  // Reactのイベントではなく非パッシブのリスナーとして張る。
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      onZoomChange(clampZoom(stateRef.current.zoom - event.deltaY * WHEEL_SENSITIVITY));
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [onZoomChange]);

  const distanceBetween = (pointers: Map<number, { x: number; y: number }>): number | null => {
    if (pointers.size < 2) return null;
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const beginGesture = useCallback(() => {
    const pointers = pointersRef.current;
    const points = [...pointers.values()];
    if (points.length === 0) {
      gestureRef.current = null;
      return;
    }

    // 2本のときは中点を基準にする。片方を離しても残りの指で続けられるようにするため。
    const pointer =
      points.length === 1
        ? points[0]
        : { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };

    gestureRef.current = {
      pointer,
      center: stateRef.current.center,
      zoom: stateRef.current.zoom,
      distance: distanceBetween(pointers),
    };
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    tapRef.current =
      pointersRef.current.size === 1
        ? { x: event.clientX, y: event.clientY, moved: false, multi: false }
        : tapRef.current && { ...tapRef.current, multi: true };
    beginGesture();
    setDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const pointers = pointersRef.current;
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const tap = tapRef.current;
    if (tap && !tap.moved && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > TAP_SLOP) {
      tap.moved = true;
    }

    const gesture = gestureRef.current;
    if (!gesture) return;

    const points = [...pointers.values()];
    const pointer =
      points.length === 1
        ? points[0]
        : { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };

    // 指の間隔が変わったぶんだけ倍率を変える。軸は常に地図の中心。
    let nextZoom = gesture.zoom;
    const distance = distanceBetween(pointers);
    if (gesture.distance && distance) {
      nextZoom = clampZoom(gesture.zoom + Math.log2(distance / gesture.distance));
      onZoomChange(nextZoom);
    }

    // 掴んだ地点を指の下へ留める。倍率が変わっていれば、その倍率での移動量に直す。
    const scale = 2 ** (nextZoom - gesture.zoom);
    const origin = project(gesture.center, gesture.zoom);
    const next = unproject(
      {
        x: origin.x - (pointer.x - gesture.pointer.x) / scale,
        y: origin.y - (pointer.y - gesture.pointer.y) / scale,
      },
      gesture.zoom,
    );
    onCenterChange(next);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size === 0) {
      gestureRef.current = null;
      setDragging(false);
      const tap = tapRef.current;
      tapRef.current = null;
      if (tap && !tap.moved && !tap.multi && event.type === "pointerup" && onMarkerSelect) {
        const rect = event.currentTarget.getBoundingClientRect();
        onMarkerSelect(hitMarker(event.clientX - rect.left, event.clientY - rect.top));
      }
      return;
    }
    // 指が減っても操作は続く。残った指を基準に取り直す。
    beginGesture();
  };

  // タイルは整数のズームでしか用意されていない。中途半端な倍率は、いちばん近い
  // ズームのタイルを敷いてCSSで拡大縮小して見せる（ピンチの途中を滑らかにするため）。
  const baseZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom)));
  const scale = 2 ** (zoom - baseZoom);
  const tileCount = 2 ** baseZoom;

  const world = project(center, baseZoom);
  // 位置の基準は「地図の中心を枠の中心へ置く」。拡大縮小の軸（枠の中心）と揃えておくと、
  // CSSで倍率を変えても中心の地点はその場に留まる。
  const originX = world.x - size.width / 2;
  const originY = world.y - size.height / 2;

  // 敷く範囲は倍率で変わる。拡大して見せている間は、枠を覆うのに要るタイルが少なくて済む。
  const visibleWidth = size.width / scale;
  const visibleHeight = size.height / scale;
  const coverLeft = world.x - visibleWidth / 2;
  const coverTop = world.y - visibleHeight / 2;

  // ピンの画面上の位置。端数のズームのまま求めれば、CSSで拡大縮小しているタイルと一致する。
  const centerPixel = project(center, zoom);
  const placedMarkers = markers.map((marker) => {
    const p = project(marker.position, zoom);
    return { ...marker, x: p.x - centerPixel.x + size.width / 2, y: p.y - centerPixel.y + size.height / 2 };
  });
  const selectedMarker = placedMarkers.find((marker) => marker.id === selectedMarkerId) ?? null;

  function hitMarker(x: number, y: number): string | null {
    let best: { id: string; distance: number } | null = null;
    for (const marker of placedMarkers) {
      // ピンの絵は地点より上へ伸びるため、絵の中ほど（地点の少し上）を当たりの中心にする。
      const distance = Math.hypot(marker.x - x, marker.y - 14 - y);
      if (distance <= MARKER_HIT_RADIUS && (!best || distance < best.distance)) {
        best = { id: marker.id, distance };
      }
    }
    return best?.id ?? null;
  }

  const tiles: { key: string; url: string; x: number; y: number }[] = [];
  if (size.width > 0 && size.height > 0) {
    const firstY = Math.floor(coverTop / TILE_SIZE);
    const lastY = Math.floor((coverTop + visibleHeight) / TILE_SIZE);
    const firstX = Math.floor(coverLeft / TILE_SIZE);
    const lastX = Math.floor((coverLeft + visibleWidth) / TILE_SIZE);

    for (let tileY = firstY; tileY <= lastY; tileY++) {
      // 南北はつながっていない。範囲の外は敷かない（下地の色が出る）。
      if (tileY < 0 || tileY >= tileCount) continue;
      for (let tileX = firstX; tileX <= lastX; tileX++) {
        // 東西はつながっている。日付変更線をまたいでも同じタイルを出す。
        const wrappedX = ((tileX % tileCount) + tileCount) % tileCount;
        tiles.push({
          key: `${baseZoom}/${tileX}/${tileY}`,
          url: tileUrl(wrappedX, tileY, baseZoom),
          x: tileX * TILE_SIZE - originX,
          y: tileY * TILE_SIZE - originY,
        });
      }
    }
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative overflow-hidden rounded-lg border border-outline-variant bg-surface-container-highest",
        // 指の操作をすべてこちらで受ける。既定のままだと、地図を動かしたつもりで
        // ダイアログが縦に流れる。
        "touch-none select-none",
        dragging ? "cursor-grabbing" : "cursor-grab",
        className,
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div
        className="absolute inset-0"
        style={{ transform: `scale(${scale})`, transformOrigin: "center center" }}
      >
        {tiles.map((tile) => (
          // next/image は使わない。タイルはサーバーで最適化する対象ではなく、
          // 通すと1枚ごとに自分のサーバーへ往復が増える。
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={tile.key}
            src={tile.url}
            alt=""
            width={TILE_SIZE}
            height={TILE_SIZE}
            draggable={false}
            className="pointer-events-none absolute max-w-none"
            style={{ left: tile.x, top: tile.y }}
          />
        ))}
      </div>

      {/* 置いたピン。選んでいるものを最後に描いて最前面へ出す（重なり回避はしない）。 */}
      {[...placedMarkers.filter((m) => m.id !== selectedMarkerId), ...(selectedMarker ? [selectedMarker] : [])].map(
        (marker) => {
          const selected = marker.id === selectedMarkerId;
          // ピンの先（絵の下から1割の位置）を地点に合わせ、ラベルは地点の下へ垂らす。
          const pinSize = selected ? MARKER_SIZE_SELECTED : MARKER_SIZE;
          return (
            <div
              key={marker.id}
              className="pointer-events-none absolute flex flex-col items-center"
              style={{
                left: marker.x,
                top: marker.y,
                transform: `translate(-50%, -${pinSize * 0.9}px)`,
              }}
            >
              <MarkerPin selected={selected} />
              {marker.label && !selected && (
                <span className="-mt-0.5 max-w-32 truncate rounded bg-white/85 px-1 text-[11px] leading-4 font-medium text-neutral-900">
                  {marker.label}
                </span>
              )}
            </div>
          );
        },
      )}

      {selectedMarker && selectedOverlay && (
        <div
          className="absolute z-10"
          style={{ left: selectedMarker.x, top: selectedMarker.y, transform: "translate(-50%, calc(-100% - 44px))" }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {selectedOverlay}
        </div>
      )}

      {/* 中心のピン。地図と一緒には動かないため、タイルの層の外へ置く。 */}
      {showCenterPin && (
        <>
          <div className="pointer-events-none absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/35" />
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-1/2 size-9 -translate-x-1/2 -translate-y-full drop-shadow-[0_2px_3px_rgba(0,0,0,0.35)]"
            fill="var(--md-error)"
          >
            <path d="M12 2a7 7 0 0 0-7 7c0 5.2 6.2 12.2 6.5 12.5a.7.7 0 0 0 1 0C12.8 21.2 19 14.2 19 9a7 7 0 0 0-7-7Z" />
            <circle cx="12" cy="9" r="2.6" fill="#fff" />
          </svg>
        </>
      )}

      <div className="absolute top-2 right-2 flex flex-col gap-2">
        {onFitAll && (
          <button
            type="button"
            aria-label="全体を表示"
            title="全体を表示"
            className="grid size-10 place-items-center rounded-full border border-outline-variant bg-surface-container text-primary shadow-sm"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onFitAll}
          >
            <Scan className="size-5" />
          </button>
        )}
        {onLocate && (
          <button
            type="button"
            aria-label="現在地へ"
            disabled={locating}
            className="grid size-10 place-items-center rounded-full border border-outline-variant bg-surface-container text-primary shadow-sm disabled:opacity-38"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onLocate}
          >
            <LocateFixed className={cn("size-5", locating && "animate-pulse")} />
          </button>
        )}
        <div className="flex flex-col overflow-hidden rounded-[20px] border border-outline-variant shadow-sm">
          <button
            type="button"
            aria-label="拡大"
            className="grid size-10 place-items-center bg-surface-container text-primary disabled:opacity-38"
            disabled={zoom >= MAX_ZOOM}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onZoomChange(clampZoom(Math.floor(zoom) + 1))}
          >
            <Plus className="size-5" />
          </button>
          <button
            type="button"
            aria-label="縮小"
            className="grid size-10 place-items-center border-t border-outline-variant bg-surface-container text-primary disabled:opacity-38"
            disabled={zoom <= MIN_ZOOM}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onZoomChange(clampZoom(Math.ceil(zoom) - 1))}
          >
            <Minus className="size-5" />
          </button>
        </div>
      </div>

      {/* 出典の表示。OpenStreetMapのデータを使う条件（ODbL）として必要。 */}
      <span className="absolute right-0 bottom-0 rounded-tl-md bg-white/80 px-1.5 text-[10px] leading-[14px] text-neutral-700">
        © OpenStreetMap contributors
      </span>
    </div>
  );
}

/** 置いたピンの絵。選んでいるものは大きく、色を変えて示す。 */
function MarkerPin({ selected }: { selected: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      width={selected ? MARKER_SIZE_SELECTED : MARKER_SIZE}
      height={selected ? MARKER_SIZE_SELECTED : MARKER_SIZE}
      className="drop-shadow-[0_2px_2px_rgba(0,0,0,0.35)]"
    >
      <path
        d="M12 2a7 7 0 0 0-7 7c0 5.2 6.2 12.2 6.5 12.5a.7.7 0 0 0 1 0C12.8 21.2 19 14.2 19 9a7 7 0 0 0-7-7Z"
        fill={selected ? "var(--md-error)" : "var(--md-primary)"}
        stroke="#fff"
        strokeWidth="1.2"
      />
      <circle cx="12" cy="9" r="2.6" fill="#fff" />
    </svg>
  );
}

export { MIN_ZOOM, MAX_ZOOM };
