"use client";

import { useRef, useState } from "react";
import { useOffline } from "next/offline";
import { MapPin, X } from "lucide-react";

import { ItemFormActions } from "@/components/calendar/item-form-actions";
import { PlaceMapDialog } from "@/components/calendar/place-map-dialog";
import { readErrorMessage } from "@/components/calendar/response-error";
import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { tagColorOf } from "@/components/tags/tag-color";
import { PLACE_TAGS } from "@/lib/place-tags";
import { TagPicker } from "@/components/tags/tag-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { isStationPlace } from "@/lib/place-tags";
import { formatCoordinates, type LatLng } from "@/lib/coordinates";
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
  const [station, setStation] = useState(place.station ?? "");
  const [stationMinutes, setStationMinutes] = useState(place.stationMinutes == null ? "" : String(place.stationMinutes));
  const [tags, setTags] = useState<string[]>(place.tags);
  // 場所そのものが駅のときは最寄り駅を持たない。欄を隠し、保存でも触らない（issue #1370）。
  const isStation = isStationPlace(tags);
  const [coordinates, setCoordinates] = useState<LatLng | null>(place.coordinates);
  const [mapOpen, setMapOpen] = useState(false);
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
  const [stationFocused, setStationFocused] = useState(false);
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
  const typedStation = station.trim();
  const visibleStations = stationCandidates.filter(
    (candidate) => candidate.name !== typedStation && candidate.name.includes(typedStation.replace(/駅$/, "")),
  );

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

    const minutes = stationMinutes.trim() === "" ? null : Number(stationMinutes);
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 0 || minutes > 180)) {
      setError("駅までの徒歩は0〜180分の整数で入力してください。");
      return;
    }

    await send(
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          ...(capabilities.address ? { address: address.trim() || null } : {}),
          ...(capabilities.station && !isStation ? { station: station.trim() || null } : {}),
          ...(capabilities.stationMinutes && !isStation ? { stationMinutes: minutes } : {}),
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
      {/*
        地図は登録せず、選んだ地点と住所だけを返してもらう。ここで住所も一緒に置き換えるのは、
        座標があるとき地図・Yahoo!乗換案内は座標のほうを先に見るため。住所だけ直して座標が
        前のまま残ると、画面に出ている文字列と実際に開く地点が食い違う。

        中心は `initialCenter` で明示する。名前から引き直させると、すでに地点を持っている
        場所を編集しているのに別の地点にピンが立ち、そのまま押した操作が座標を黙って動かす。
        渡すのは保存前の値（`coordinates`）。選び直したあとに開き直すと元の地点へ戻る、
        という動きにしないため。

        地点を持たない場所（座標の欄が空・外したあと）では、名前ではなく**住所**から引く
        （`lookupText`。issue #464）。名前欄に入っているのは「自宅」「本社」のような値で、
        そこからは地点が引けず、登録されている住所を使わないまま前回の中心や東京駅から
        始まっていた。住所も空なら従来どおり名前で引く。
      */}
      {mapOpen && (
        <PlaceMapDialog
          query={name}
          places={[]}
          initialCenter={coordinates}
          lookupText={address.trim() || name}
          // 地図側の文言も、この場所DBで実際に保存されるものに合わせる。座標のプロパティが
          // 無い構成では、選んでも入るのは住所だけ（`writeCoordinates` がそこで落ちる）。
          picks={
            capabilities.address && capabilities.coordinates
              ? "both"
              : capabilities.address
                ? "address"
                : "point"
          }
          onCancel={() => setMapOpen(false)}
          onRegistered={() => setMapOpen(false)}
          onPicked={(picked) => {
            setCoordinates(picked.coordinates);
            setCoordinatesTouched(true);
            if (capabilities.address) setAddress(picked.address);
            setMapOpen(false);
          }}
        />
      )}

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

          {/* 文字を打つ欄には ✕ を出す（issue #446）。打ち直す前にまとめて消せるようにするため。 */}
          <Input
            label="名前"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onClear={() => setName("")}
          />

          {/*
            住所と地点は1つの区画にまとめ、地図の入口を住所の欄の直下へ置く（issue #452）。
            この2つは常に組で置き換わるため、押す先も1つでよい。地図ボタンを地点の側にだけ
            置いていたときは、住所を直しに来た操作からは別の欄の付属物にしか見えず、
            座標のプロパティを持たない場所DBでは地図への入口が画面から丸ごと消えていた。
          */}
          {(capabilities.address || capabilities.coordinates) && (
            <div className="flex flex-col gap-2">
              {capabilities.address && (
                <Input
                  label="住所"
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  onClear={() => setAddress("")}
                />
              )}

              <div className="flex items-center gap-2">
                {capabilities.coordinates && (
                  <>
                    <span className="type-body-small shrink-0 text-on-surface-variant">地点</span>
                    <span className="type-body-small min-w-0 flex-1 truncate font-mono text-on-surface-variant">
                      {coordinates ? formatCoordinates(coordinates) : "地点なし"}
                    </span>
                    {coordinates && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setCoordinates(null);
                          setCoordinatesTouched(true);
                        }}
                      >
                        <X className="size-4" />
                        外す
                      </Button>
                    )}
                  </>
                )}
                <Button variant="outline" size="sm" disabled={busy} onClick={() => setMapOpen(true)}>
                  <MapPin className="size-4" />
                  地図で選ぶ
                </Button>
              </div>

              <p className="type-body-small text-on-surface-variant">
                {capabilities.address && capabilities.coordinates
                  ? "地図で選ぶと、住所と地点をその地点のものに置き換えます。地点があると、この場所を開くときに地図とYahoo!乗換案内がその座標を使います。"
                  : capabilities.address
                    ? "地図で選ぶと、その地点の住所が入ります。場所DBに座標のプロパティが無いため、地点は保存されません。"
                    : "地図で選ぶと、この場所の地点を置き換えます。地点があると、この場所を開くときに地図とYahoo!乗換案内がその座標を使います。"}
              </p>
            </div>
          )}

          {/*
            最寄り駅は住所・地点とは別の区画に置く。あの2つは常に組で置き換わるもので、
            駅名はそこへ混ぜると地図で選び直したときに一緒に入れ替わるように読める。
            実際には駅名だけが Yahoo!乗換案内 の発着地になり、地図とは関係が無い。
          */}
          {capabilities.station && !isStation && (
            <div className="flex flex-col gap-1">
              <Input
                label="最寄り駅"
                value={station}
                onChange={(event) => setStation(event.target.value)}
                onClear={() => setStation("")}
                onFocus={() => {
                  setStationFocused(true);
                  void loadStationCandidates();
                }}
                onBlur={() => setStationFocused(false)}
              />
              {stationFocused && visibleStations.length > 0 && (
                <ul className="overflow-hidden rounded-xl border border-outline-variant">
                  {visibleStations.map((candidate) => (
                    <li key={candidate.name} className="border-t border-outline-variant first:border-t-0">
                      <button
                        type="button"
                        // blurより先に選択を確定させる（候補が消えて押せなくなるのを防ぐ）。
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => setStation(candidate.name)}
                        className="type-body-medium flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-surface-container"
                      >
                        <span>{candidate.name}</span>
                        <span className="type-body-small text-on-surface-variant">
                          約{candidate.distanceM}m
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="type-body-small text-on-surface-variant">
                「梅田」と入れると「梅田駅」で保存します。入れておくと、電車の移動でYahoo!乗換案内をこの駅から探します。空のときは地点（無ければ住所）で探します。
              </p>
            </div>
          )}

          {capabilities.station && capabilities.stationMinutes && !isStation && (
            <div className="flex flex-col gap-1">
              <Input
                label="最寄り駅まで徒歩（分）"
                type="number"
                inputMode="numeric"
                min={0}
                max={180}
                value={stationMinutes}
                onChange={(event) => setStationMinutes(event.target.value)}
                onClear={() => setStationMinutes("")}
              />
              <p className="type-body-small text-on-surface-variant">
                予定の移動を調べるとき、予定の場所が最寄り駅から離れているぶん、到着・出発の検索時刻をずらします。最寄り駅が空のときは使いません。
              </p>
            </div>
          )}

          {/*
            タグは登録済みから押して選び、無い名前はここから足す（タスク・日付リマインドと
            同じ TagPicker）。足した名前はNotionが選択肢として登録する。色・並び順・改名は
            選択肢そのものの話なので、`/places` のヘッダーから開く専用ページに置く（issue #706）。
          */}
          {capabilities.tags && (
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
