"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { LatLng } from "@/lib/coordinates";

/**
 * 端末の現在地（地図の青い点）。位置は端末の中だけで使い、サーバーへ送らず保存もしない
 * （docs/spec.md §9）。
 */
export type CurrentLocation = { position: LatLng; accuracy: number };

export type LocateFailure = "unsupported" | "failed";

/**
 * 現在地の取得と追従。
 *
 * `locate()` を呼んだとき（ボタンの操作）にだけ取得を始め、最初の1回が取れたら
 * `watchPosition` で点を動かし続ける。追従で動くのは点だけで、地図の中心は動かさない
 * （選んでいる地点を点の更新で奪わないため）。中心を寄せたい呼び出し側は `onFix` で受ける。
 * 画面を離れたら追従は解除する。
 */
export function useCurrentLocation() {
  const [location, setLocation] = useState<CurrentLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const watchRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    },
    [],
  );

  const locate = useCallback(
    (handlers: { onFix?: (position: LatLng) => void; onError?: (failure: LocateFailure) => void } = {}) => {
      if (!navigator.geolocation) {
        handlers.onError?.("unsupported");
        return;
      }

      const toLocation = (position: GeolocationPosition): CurrentLocation => ({
        position: { lat: position.coords.latitude, lng: position.coords.longitude },
        accuracy: position.coords.accuracy,
      });

      setLocating(true);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const fix = toLocation(position);
          setLocation(fix);
          setLocating(false);
          handlers.onFix?.(fix.position);
          if (watchRef.current === null) {
            // 追従の失敗は黙って捨てる。最後に取れた位置の点がそのまま残る。
            watchRef.current = navigator.geolocation.watchPosition(
              (next) => setLocation(toLocation(next)),
              () => {},
              { maximumAge: 10_000, timeout: 20_000 },
            );
          }
        },
        () => {
          // 拒否・失敗のどちらでも地図は使える。文言は呼び出し側が出す。
          setLocating(false);
          handlers.onError?.("failed");
        },
        { timeout: 8000, maximumAge: 60_000 },
      );
    },
    [],
  );

  return { location, locating, locate };
}
