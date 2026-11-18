"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

import { TileMap } from "@/components/calendar/tile-map";
import { useCurrentLocation } from "@/components/calendar/use-current-location";
import { Button } from "@/components/ui/button";
import { formatCoordinates, type LatLng } from "@/lib/coordinates";

import { REVERSE_LOOKUP_DELAY_MS, reverseAddress, searchAddressPoint } from "./place-geocode";

const DEFAULT_ZOOM = 17;

/** 地点も住所も手掛かりが無いときの中心。座標としては保存しない（参考表示のみ）。 */
const FALLBACK_CENTER: LatLng = { lat: 35.681236, lng: 139.767125 };

/**
 * 場所の編集画面に埋め込む地図（issue #1689）。住所・地点・地図の位置を連動させる。
 *
 * - 住所→地図: 「住所から地図を検索」を押したときだけ地図を動かす（検索した時点で地点を立てる）
 * - 地図→住所・地点: **利用者が地図を動かしたあと**だけ、止まって0.7秒後に住所を引いて置き換える。
 *   開いた直後・初期座標・検索による移動では逆引きしない（保存済みの住所を勝手に消さないため）
 * - 地点なしの場所は、初期の中心（住所から引く）を座標として保存しない。動かす・検索するまで
 *   `onPointChange` は呼ばれない（「消す」と「触らない」を分ける決定のとおり）
 */
export function PlaceLocationMap({
  coordinates,
  address,
  canAddress,
  canCoordinates,
  disabled,
  offline,
  onPointChange,
  onAddressChange,
  onClearPoint,
}: {
  coordinates: LatLng | null;
  address: string;
  canAddress: boolean;
  canCoordinates: boolean;
  disabled: boolean;
  offline: boolean;
  /** 利用者の操作で地点が決まったとき。 */
  onPointChange: (point: LatLng) => void;
  /** 地図から住所が引けたとき。 */
  onAddressChange: (address: string) => void;
  onClearPoint: () => void;
}) {
  // 開いた時点の座標を中心にする。地点なしなら住所から引く（下のeffect）。
  const [center, setCenter] = useState<LatLng>(() => coordinates ?? FALLBACK_CENTER);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [searching, setSearching] = useState(false);
  const [looking, setLooking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);
  const { location: currentLocation, locating, locate } = useCurrentLocation();

  // 地点なしで開いたときだけ、住所から中心を引く（座標としては保存しない）。
  useEffect(() => {
    if (coordinates || !address.trim()) return;
    let cancelled = false;
    void searchAddressPoint(address.trim()).then((found) => {
      if (!cancelled && found) setCenter(found);
    });
    return () => {
      cancelled = true;
    };
    // 開いた時点の値だけを見る。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  /** 利用者が地図を動かした（現在地へ寄せた）とき。地点を確定し、止まったら住所を引く。 */
  const moved = (next: LatLng) => {
    setCenter(next);
    setNotice(null);
    onPointChange(next);
    if (!canAddress || offline) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    const seq = ++seqRef.current;
    timerRef.current = setTimeout(async () => {
      setLooking(true);
      const found = await reverseAddress(next);
      if (seq !== seqRef.current) return;
      setLooking(false);
      // 取れなければ住所は触らない。
      if (found) onAddressChange(found);
    }, REVERSE_LOOKUP_DELAY_MS);
  };

  const searchAddress = async () => {
    const text = address.trim();
    if (!text || offline) return;
    // 検索で動かした地点は住所そのものから出たもの。逆引きで住所を書き換えない。
    if (timerRef.current) clearTimeout(timerRef.current);
    seqRef.current++;
    setLooking(false);
    setNotice(null);
    setSearching(true);
    const found = await searchAddressPoint(text);
    setSearching(false);
    if (!found) {
      setNotice("この住所では地点が見つかりませんでした。番地を除くなど短くして試してください。");
      return;
    }
    setCenter(found);
    setZoom(DEFAULT_ZOOM);
    onPointChange(found);
  };

  return (
    <div className="flex flex-col gap-2">
      {canAddress && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={disabled || offline || searching || !address.trim()}
            onClick={() => void searchAddress()}
          >
            <Search className="size-4" />
            {searching ? "検索中…" : "住所から地図を検索"}
          </Button>
          {looking && (
            <span className="type-body-small text-on-surface-variant">住所を調べています…</span>
          )}
        </div>
      )}

      <TileMap
        center={center}
        zoom={zoom}
        onCenterChange={moved}
        onZoomChange={setZoom}
        onLocate={() =>
          locate({
            onFix: moved,
            onError: () =>
              setNotice("現在地を取得できませんでした。地図を動かして地点を選んでください。"),
          })
        }
        locating={locating}
        currentLocation={currentLocation}
        className="h-52 sm:h-64"
      />

      {canCoordinates && (
        <div className="flex items-center gap-2">
          <span className="type-body-small shrink-0 text-on-surface-variant">地点</span>
          <span className="type-body-small min-w-0 flex-1 truncate font-mono text-on-surface-variant">
            {coordinates ? formatCoordinates(coordinates) : "地点なし"}
          </span>
          {coordinates && (
            <Button variant="ghost" size="sm" disabled={disabled} onClick={onClearPoint}>
              <X className="size-4" />
              外す
            </Button>
          )}
        </div>
      )}

      {notice && <p className="type-body-small text-on-surface-variant">{notice}</p>}
      <p className="type-body-small text-on-surface-variant">
        地図を動かすと、中央のピンの{canAddress ? "住所" : ""}
        {canAddress && canCoordinates ? "と" : ""}
        {canCoordinates ? "地点" : ""}に置き換わります。
        {canCoordinates
          ? "地点があると、この場所を開くときに地図とYahoo!乗換案内がその座標を使います。"
          : "場所DBに座標のプロパティが無いため、地点は保存されません。"}
      </p>
    </div>
  );
}
