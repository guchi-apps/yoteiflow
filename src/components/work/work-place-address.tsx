"use client";

import { useOffline } from "next/offline";
import { useEffect, useState } from "react";

import { CircleAlert, MapPin } from "lucide-react";

import { PlaceMapDialog } from "@/components/calendar/place-map-dialog";
import { Button } from "@/components/ui/button";
import { formatCoordinates } from "@/lib/coordinates";
import { hasPlaceAddress } from "@/lib/location-check";
import { matchPlaceByText } from "@/lib/place-text";
import { addressCandidates } from "@/lib/work-place-address-candidates";
import type { PlaceItem } from "@/services/notion/places";

type Catalog = {
  ready: boolean;
  places: PlaceItem[];
  remotePlaces: string[];
  homeOrigin: string | null;
};

/**
 * 勤務場所（出張は行き先）の住所の状態と、地図からの登録の入口（issue #1319・docs/spec.md §46）。
 *
 * 勤務記録から作る勤務予定の場所欄には、場所DBで同じ名前の場所に当たれば `名前 住所` が入る。
 * 住所が無いと Morrow など他のアプリが勤務の場所を引けないため、入力の場で気付いて登録できるようにする。
 * 住所は場所DBが正で、勤務記録DBへは持たない。場所DBの一覧はダイアログを開いたときに1回だけ読む。
 */
export function WorkPlaceAddress({ name, isTrip }: { name: string; isTrip: boolean }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offline = useOffline();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/work/place-addresses")
      .then(async (response) => (response.ok ? ((await response.json()) as Catalog) : null))
      .then((data) => {
        if (!cancelled && data) setCatalog(data);
      })
      // 読めないときは何も出さない（登録済みの場所を「未登録」と取り違えないため）。
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const value = name.trim();
  if (!catalog?.ready || !value) return null;

  // 在宅扱いの勤務場所は、勤務予定の場所に自宅（既定の出発地）を入れる。
  const remote = !isTrip && catalog.remotePlaces.includes(value);
  if (remote) {
    const home = catalog.homeOrigin?.trim();
    return (
      <p className="type-body-small flex items-start gap-1.5 text-on-surface-variant">
        <MapPin className="mt-0.5 size-3.5 shrink-0" />
        <span>
          {home
            ? "在宅扱いのため、勤務予定の場所には自宅（設定の「移動」の出発地）が入ります。"
            : "在宅扱いの場所です。設定の「移動」で出発地（自宅）を入れると、勤務予定の場所に自宅が入ります。"}
        </span>
      </p>
    );
  }

  const registerCatalogPlace = (registered: PlaceItem) =>
    setCatalog((current) =>
      current
        ? {
            ...current,
            // 同じ名前の場所は置き換え、無ければ足す（住所の無い同名の場所へ住所を埋めた場合も含む）。
            places: [...current.places.filter((item) => item.id !== registered.id), registered],
          }
        : current,
    );

  // 登録済みの場所の住所を、この勤務場所の名前の場所へ付ける。同名で住所の無い場所があれば `createPlace` が住所を埋め、無ければ登録する。
  const pickAddress = async (source: PlaceItem) => {
    setSaving(true);
    setError(null);
    try {
      const fields = {
        address: source.address,
        coordinates: source.coordinates ? formatCoordinates(source.coordinates) : null,
        station: source.station,
      };
      const response = await fetch("/api/places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: value, ...fields }),
      });
      if (!response.ok) {
        setError("住所を登録できませんでした。もう一度お試しください。");
        return;
      }
      registerCatalogPlace((await response.json()) as PlaceItem);
      setPickOpen(false);
    } catch {
      setError("住所を登録できませんでした。もう一度お試しください。");
    } finally {
      setSaving(false);
    }
  };

  const candidates = addressCandidates(catalog.places, value);
  const place = matchPlaceByText(value, catalog.places);
  if (hasPlaceAddress(value, catalog.places)) {
    return (
      <p className="type-body-small flex items-start gap-1.5 text-on-surface-variant">
        <MapPin className="mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0 break-words">{place?.address?.trim() || "住所が登録されています"}</span>
      </p>
    );
  }

  return (
    <div className="flex items-start gap-2 rounded-md bg-tertiary-container p-3 text-on-tertiary-container">
      <CircleAlert className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="type-body-small">
          「{value}」の住所が未登録です。勤務予定の場所に住所が入らず、ほかのアプリで場所が分かりません。
        </span>
        {!offline && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="self-start"
            onClick={() => setMapOpen(true)}
          >
            <MapPin />
            地図から住所を登録
          </Button>
        )}
        {!offline && candidates.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="self-start"
            onClick={() => setPickOpen((open) => !open)}
          >
            登録済みの住所から選ぶ
          </Button>
        )}
        {pickOpen && !offline && (
          <div className="flex flex-col gap-1">
            <ul className="max-h-48 overflow-y-auto rounded-md bg-surface text-on-surface">
              {candidates.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => pickAddress(item)}
                    className="type-body-small flex w-full min-w-0 flex-col px-3 py-2 text-left hover:bg-surface-container disabled:opacity-50"
                  >
                    <span className="font-medium">{item.name}</span>
                    <span className="break-words text-on-surface-variant">{item.address}</span>
                  </button>
                </li>
              ))}
            </ul>
            <span className="type-body-small">選ぶと「{value}」にこの住所を登録します。</span>
            {error && <span className="type-body-small text-error">{error}</span>}
          </div>
        )}
      </div>
      {mapOpen && (
        <PlaceMapDialog
          query={value}
          places={catalog.places}
          onCancel={() => setMapOpen(false)}
          onRegistered={(registered) => {
            setMapOpen(false);
            registerCatalogPlace(registered);
          }}
        />
      )}
    </div>
  );
}
