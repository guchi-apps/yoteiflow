"use client";

import { useRef, useState } from "react";
import { useOffline } from "next/offline";
import { MapPin, Tag, TrainFront, Type } from "lucide-react";

import { ItemFormActions } from "@/components/calendar/item-form-actions";
import { FormRow } from "@/components/calendar/event-form-row";
import { PlaceLocationMap } from "@/components/places/place-location-map";
import { readErrorMessage } from "@/components/calendar/response-error";
import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { tagColorOf } from "@/components/tags/tag-color";
import { PLACE_TAGS } from "@/lib/place-tags";
import { TagPicker } from "@/components/tags/tag-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { isStationPlace } from "@/lib/place-tags";
import { formatCoordinates, type LatLng } from "@/lib/coordinates";
import { placeStations } from "@/lib/station-name";
import {
  newStationRow,
  PlaceStationsEditor,
  rowsToStations,
  type StationRow,
} from "@/components/places/place-stations-editor";
import type { PlaceItem } from "@/services/notion/places";
import type { TagOption } from "@/services/notion/tag-options";

/** 場所DBの構成によって、住所・タグ・座標・最寄り駅の置き場所そのものが無いことがある。 */
export type PlaceCapabilities = {
  address: boolean;
  tags: boolean;
  coordinates: boolean;
  station: boolean;
  stationMinutes: boolean;
};

/**
 * 登録済みの場所の編集（docs/spec.md §9）。
 *
 * 予定・タスク・日付リマインドの入力（`ItemDialog`）へは混ぜない。あちらは日時の欄が主で、
 * 場所は日付も時刻も持たないため、同じダイアログに入れると欄がまるごと入れ替わる
 * （買い物の項目を専用ダイアログにしたのと同じ理由）。
 */
export function PlaceDialog({
  place,
  capabilities,
  tagOptions,
  onClose,
  onSaved,
}: {
  place: PlaceItem;
  capabilities: PlaceCapabilities;
  /** 場所DBのタグの選択肢。取得できなかったときは空で、選択中のタグだけが並ぶ。 */
  tagOptions: TagOption[];
  onClose: () => void;
  /** 保存・削除できたとき。一覧を取り直すのは呼び出し側の役目。 */
  onSaved: () => void;
}) {
  // 選べるのは固定の4種だけ。色だけNotionの同名の選択肢から借りる（issue #1361）。
  const fixedTagOptions: TagOption[] = PLACE_TAGS.map((name) => ({
    id: name,
    name,
    color: tagColorOf(tagOptions, name),
  }));
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const [name, setName] = useState(place.name);
  const [address, setAddress] = useState(place.address ?? "");
  // 最寄り駅は複数持てる（issue #1607）。1駅も無ければ空の1行から始める（従来の1欄と同じ見え方）。
  const [stationRows, setStationRows] = useState<StationRow[]>(() => {
    const stations = placeStations(place);
    return stations.length > 0 ? stations.map((station) => newStationRow(station)) : [newStationRow()];
  });
  const [tags, setTags] = useState<string[]>(place.tags);
  // 場所そのものが駅のときは最寄り駅を持たない。欄を隠し、保存でも触らない（issue #1370）。
  const isStation = isStationPlace(tags);
  const [coordinates, setCoordinates] = useState<LatLng | null>(place.coordinates);
  /**
   * 地点の欄に触ったか。
   *
   * 座標の欄にDaySpanが読めない文字（`梅田駅の北側` など）が入っていると、画面には
   * 「地点なし」と出る。触っていないのに「消す」として送ると、開いて保存しただけで
   * その文字が消える。触っていなくて元も空なら、そもそも送らない。
   */
  const [coordinatesTouched, setCoordinatesTouched] = useState(false);

  const offline = useOffline();

  // 最寄り駅の候補（issue #1356）。欄を開いたとき1回だけ、地点（無ければ住所）から取る。
  const [stationCandidates, setStationCandidates] = useState<{ name: string; distanceM: number }[]>([]);
  const [focusedStationKey, setFocusedStationKey] = useState<number | null>(null);
  const stationLoaded = useRef(false);
  const loadStationCandidates = async () => {
    if (stationLoaded.current || offline) return;
    const params = new URLSearchParams();
    if (coordinates) {
      params.set("lat", String(coordinates.lat));
      params.set("lon", String(coordinates.lng));
    } else if (address.trim()) {
      params.set("q", address.trim());
    } else {
      return;
    }
    stationLoaded.current = true;
    try {
      const response = await fetch(`/api/places/stations?${params.toString()}`);
      if (!response.ok) return;
      const json = (await response.json()) as { stations?: { name: string; distanceM: number }[] };
      setStationCandidates(json.stations ?? []);
    } catch {
      // 候補は補助。取れなくても手入力は使える。
    }
  };
  const focusStationRow = (key: number | null) => {
    setFocusedStationKey(key);
    if (key !== null) void loadStationCandidates();
  };

  const close = () => {
    setOpen(false);
    setTimeout(onClose, 150);
  };

  const finish = () => {
    setOpen(false);
    setTimeout(onSaved, 150);
  };

  const send = async (init: RequestInit, fallback: string) => {
    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/places/${place.id}`, init);
      if (!response.ok) {
        setError(await readErrorMessage(response, fallback));
        return;
      }
      finish();
    } catch {
      setError(fallback);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("名前を入力してください。");
      return;
    }

    const stations = rowsToStations(stationRows);
    if ("error" in stations) {
      setError(stations.error);
      return;
    }

    await send(
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          ...(capabilities.address ? { address: address.trim() || null } : {}),
          // 徒歩は駅ごとに「最寄り駅」欄の行へ入る（数値の列は先頭駅の写し）。issue #1607
          ...(capabilities.station && !isStation ? { stations: stations.stations } : {}),
          ...(capabilities.tags ? { tags } : {}),
          ...(capabilities.coordinates && (coordinatesTouched || place.coordinates)
            ? { coordinates: coordinates ? formatCoordinates(coordinates) : null }
            : {}),
        }),
      },
      "保存できませんでした。",
    );
  };

  const remove = async () => {
    await send({ method: "DELETE" }, "削除できませんでした。");
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && close()}>
        <DialogContent position="bottom" className="max-h-[85dvh] gap-3 overflow-y-auto">
          <DialogTitle>場所を編集</DialogTitle>
          <DialogDescription className="sr-only">
            名前・住所・地点・最寄り駅・タグを変更するか、この場所を削除します。
          </DialogDescription>

          {error && (
            <p className="type-body-small rounded-xl bg-error-container px-4 py-3 text-on-error-container">
              {error}
            </p>
          )}

          {/*
            予定の表示画面と同じ、アイコン付きの行＋区切り線（issue #1689・#1563）。
            住所は折り返して全文が見える複数行欄にし、その下の地図と連動させる。
          */}
          <FormRow icon={<Type />} divider={false}>
            <Input
              label="名前"
              variant="flat"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onClear={() => setName("")}
            />
          </FormRow>

          {(capabilities.address || capabilities.coordinates) && (
            <FormRow icon={<MapPin />}>
              <div className="flex flex-col gap-2">
                {capabilities.address && (
                  <Textarea
                    label="住所"
                    variant="flat"
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    onClear={() => setAddress("")}
                  />
                )}
                <PlaceLocationMap
                  coordinates={coordinates}
                  address={address}
                  canAddress={capabilities.address}
                  canCoordinates={capabilities.coordinates}
                  disabled={busy}
                  offline={offline}
                  onPointChange={(point) => {
                    setCoordinates(point);
                    setCoordinatesTouched(true);
                  }}
                  onAddressChange={setAddress}
                  onClearPoint={() => {
                    setCoordinates(null);
                    setCoordinatesTouched(true);
                  }}
                />
              </div>
            </FormRow>
          )}

          {capabilities.station && !isStation && (
            <FormRow icon={<TrainFront />}>
              <PlaceStationsEditor
                rows={stationRows}
                onChange={setStationRows}
                candidates={stationCandidates}
                focusedKey={focusedStationKey}
                onFocusRow={focusStationRow}
              />
            </FormRow>
          )}

          {capabilities.tags && (
            <FormRow icon={<Tag />}>
              <div className="flex flex-col gap-1">
                <TagPicker
                  label="タグ"
                  options={fixedTagOptions}
                  value={tags}
                  multiple
                  allowAdd={false}
                  onChange={setTags}
                />
                <p className="type-body-small text-on-surface-variant">
                  タグは固定の4種類から選びます。以前から付いているタグは外せますが、付け直せません。
                </p>
              </div>
            </FormRow>
          )}

          {/* 削除は必ず確認を挟む（docs/spec.md §7）。押し間違えても画面上に戻す手立てが無い。
              Notionのゴミ箱からは戻せるため、その旨も出す。 */}
          {confirming ? (
            <div className="flex flex-col gap-3 pt-2">
              <p className="type-body-medium">
                「{place.name}」を削除しますか？Notionのゴミ箱からは元に戻せます。
              </p>
              <p className="type-body-small text-on-surface-variant">
                すでに予定・移動に入っている「{place.name}」の文字は消えません。次から入力の候補に出なくなります。
              </p>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => setConfirming(false)}
                >
                  やめる
                </Button>
                <Button variant="destructive" className="flex-1" disabled={busy} onClick={remove}>
                  削除する
                </Button>
              </div>
            </div>
          ) : (
            <ItemFormActions
              saveDisabled={busy || offline || !name.trim()}
              onSave={save}
              onDelete={() => setConfirming(true)}
              deleteDisabled={busy || offline}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
