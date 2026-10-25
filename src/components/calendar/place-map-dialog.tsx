"use client";

import { useOffline } from "next/offline";
import { useEffect, useRef, useState } from "react";

import { MapPin, Plus } from "lucide-react";

import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  formatCoordinates,
  isLatLng,
  isSamePoint,
  parseCoordinates,
  type LatLng,
} from "@/lib/coordinates";
import { resolveMapStart, type MapStart } from "@/lib/place-map-start";
import type { PlaceItem } from "@/services/notion/places";

import { readErrorMessage } from "./response-error";
import { TileMap } from "./tile-map";
import { useCurrentLocation } from "./use-current-location";

/**
 * 地図から場所を登録する（docs/spec.md §9）。
 *
 * 予定・移動の「場所」欄から開き、現在地または地図を動かして地点を選び、名前を付けて
 * Notionの場所DBへ1件足す。入力ダイアログの上に重ねて開き、閉じ切ってから呼び出し元へ返す
 * （開いたままアンマウントすると<body>のpointer-events:noneが残ることがあるため）。
 */

/** 建物が見分けられる程度の倍率。地点を選ぶ操作はこのあたりから始める。 */
const DEFAULT_ZOOM = 17;

/** 現在地も手掛かりも無いときの中心。 */
const FALLBACK_CENTER: LatLng = { lat: 35.681236, lng: 139.767125 };

/** 前回選んだ地点。次に開くときの中心に使う。 */
const LAST_CENTER_KEY = "dayspan:place-map-center";

/** 地図が止まってから住所を調べるまでの待ち。動かしている間は取得元を呼ばない。 */
const LOOKUP_DELAY_MS = 700;

/** 地図が止まったあとの住所引きの様子。欄の下の補助文だけがこれを見る。 */
type LookupState = "idle" | "loading" | "found" | "none";

function readLastCenter(): LatLng | null {
  try {
    return parseCoordinates(window.localStorage.getItem(LAST_CENTER_KEY));
  } catch {
    // プライベートブラウズなどで読めないことがある。無ければ既定の中心から始める。
    return null;
  }
}

function writeLastCenter(center: LatLng) {
  try {
    window.localStorage.setItem(LAST_CENTER_KEY, formatCoordinates(center));
  } catch {
    // 保存できなくても、この操作自体は成立する。
  }
}

/**
 * 保存せずに返すときの中身。住所と地点は必ず組で渡す（片方だけ直すと食い違うため）。
 * 住所が分からない地点では、登録のときと同じく緯度経度を住所として返す。
 */
export type PickedPoint = { coordinates: LatLng; address: string };

/**
 * 選んだ地点から呼び出し側が保存するもの。地点を保存できない場所DB（座標のプロパティが無い）から
 * 開いても「地点になります」と出していると、押した先で何が変わるのかを画面が偽ることになる。
 */
const PICK_TITLES = {
  point: "地点を選び直す",
  address: "住所を地図から選ぶ",
  both: "住所と地点を選び直す",
} as const;

const PICK_DESCRIPTIONS = {
  point: "中央のピンの位置がこの場所の地点になります。",
  address:
    "中央のピンの位置の住所がこの場所の住所になります。場所DBに座標のプロパティが無いため、地点は保存されません。",
  both: "中央のピンの位置がこの場所の住所と地点になります。",
} as const;

const PICK_ACTIONS = {
  point: "この地点にする",
  address: "この住所にする",
  both: "この地点にする",
} as const;

export function PlaceMapDialog({
  query,
  places,
  initialCenter = null,
  lookupText,
  onCancel,
  onRegistered,
  onPicked,
  picks = "point",
}: {
  /** 場所欄に入力されている文字列。名前の初期値と、開いたときの中心を決める手掛かりにする。 */
  query: string;
  /**
   * 登録済みの場所。この中の1件に当たれば、その座標（無ければ住所の地点）を中心にして開く。
   * 候補から選んだあとの場所欄には `名前 住所` が入るため、照合は `matchPlaceByText` で行う。
   */
  places: PlaceItem[];
  /**
   * 開いたときの中心を呼び出し側で決める（場所の編集画面。docs/spec.md §9）。
   *
   * すでに地点を持っている場所を選び直す場面では、始める位置はその地点で決まっている。
   * 名前から引き直すと、名前を書き換えている途中の文字列で別の地点が中心になり、
   * そのまま「この地点にする」を押した操作が座標を黙って動かす。渡されたときは
   * 地名の検索も現在地の取得も行わない（往復もそのぶん減る）。
   */
  initialCenter?: LatLng | null;
  /**
   * 中心を引くための文字列。名前の初期値（`query`）と分けたいときに渡す（場所の編集画面）。
   *
   * 編集画面の名前欄に入っているのは名前だけで、「自宅」「本社」のような値からは地点が引けない。
   * 地点の手掛かりは住所の側にあるため、そちらを渡して中心を決める（issue #464）。
   */
  lookupText?: string;
  onCancel: () => void;
  /** 登録できたとき。場所欄へ入れるのは呼び出し側の役目。 */
  onRegistered: (place: PlaceItem) => void;
  /**
   * 渡すと**登録せず**、選んだ地点と住所だけを返す（場所の編集画面。docs/spec.md §9）。
   *
   * すでにある場所の地点を選び直す場面では、名前も登録先も決まっている。名前の欄と
   * Notionへの書き込みをここへ持たせると、書き込みの経路が2つに分かれてしまう。
   */
  onPicked?: (picked: PickedPoint) => void;
  /**
   * `onPicked` で呼び出し側が実際に受け取って**保存するもの**（既定は地点）。
   *
   * 場所DBの構成によっては住所か座標のどちらかのプロパティが無く、選んだ地点がそのまま
   * 保存されるとは限らない。座標を持たないDBから開いても「地点になります」「この地点にする」と
   * 出していると、押した先で何が変わるのかを画面が偽ることになる（保存されるのは住所だけ）。
   */
  picks?: "point" | "address" | "both";
}) {
  const [open, setOpen] = useState(true);
  // 開いたときの始まり方（`resolveMapStart`）。開いた時点の値だけを見るため1回だけ求める。
  // 中心が決まらないときの手掛かり（地名・現在地）は取得に往復が要るため、下のeffectで置き換える。
  const [start] = useState<MapStart>(() =>
    resolveMapStart(lookupText ?? query, places, initialCenter),
  );
  const [center, setCenter] = useState<LatLng>(
    () => start.center ?? readLastCenter() ?? FALLBACK_CENTER,
  );
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [name, setName] = useState(query.trim());
  // 打った文字列は利用者が決めた名前。地図から取れた施設名で上書きしない。
  const [nameTouched, setNameTouched] = useState(query.trim().length > 0);
  // 住所は手で直せる（issue #453）。OSMに番地が入っていない地点では、どの取得元でも
  // 丁目までしか出せないため、利用者が番地を書き足せる逃げ道を残す。
  const [address, setAddress] = useState("");
  // 直したあとは、地図を動かしても上書きしない（名前欄と同じ扱い・同じ理由）。
  const [addressTouched, setAddressTouched] = useState(false);
  const [lookup, setLookup] = useState<LookupState>("idle");
  const { location: currentLocation, locating, locate: startLocate } = useCurrentLocation();
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 住所を調べ終えた地点。同じ場所で何度も問い合わせないようにする。
  const lookedUpRef = useRef<LatLng | null>(null);

  // 開いている途中で通信が落ちることがある（docs/spec.md §21）。
  const offline = useOffline();

  const close = () => {
    setOpen(false);
    setTimeout(onCancel, 150);
  };

  const moveTo = (next: LatLng, nextZoom = DEFAULT_ZOOM) => {
    setCenter(next);
    setZoom(nextZoom);
  };

  const locate = () => {
    setNotice(null);
    startLocate({
      // 寄せるのは取れた最初の1回だけ。以降の追従は点だけが動く。
      onFix: (position) => moveTo(position),
      onError: (failure) =>
        // 拒否・失敗のどちらでも地図は使える。文言だけ出して操作は止めない。
        setNotice(
          failure === "unsupported"
            ? "この端末では現在地を取得できません。地図を動かして地点を選んでください。"
            : "現在地を取得できませんでした。地図を動かして地点を選んでください。",
        ),
    });
  };

  // 中心が決まらなかったときの地点。引く文字列があればその地点、無ければ現在地。
  useEffect(() => {
    let cancelled = false;

    const resolve = async () => {
      // 呼び出し側の指定・登録済みの座標はすでに初期値に入っている。そこから動かさない。
      if (start.center) return;

      // 手掛かりが無いのは場所欄が空のときだけ。現在地から始める。
      if (!start.search) {
        locate();
        return;
      }

      try {
        const response = await fetch(`/api/places/geocode?q=${encodeURIComponent(start.search)}`);
        if (!response.ok) return;
        const body = (await response.json()) as { place: { lat: number; lng: number } | null };
        if (cancelled || !body.place) return;
        const found = { lat: body.place.lat, lng: body.place.lng };
        // 座標として読めない値では動かさない。手掛かりが引けなかっただけで、
        // 地図はいまの中心のまま操作できる（読めない値で動かすと、選んでいた地点を失う）。
        if (!isLatLng(found)) return;
        moveTo(found);
      } catch {
        // 見つからなければ前回の中心のまま。地図を動かして選べる状態にはなっている。
      }
    };

    void resolve();

    return () => {
      cancelled = true;
    };
    // 開いた時点の入力だけを見る。以降は地図の操作で中心が決まる。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 地図が止まってから住所を調べる。動かしている間に呼ぶと、往復が動かしたぶんだけ積み上がる。
  useEffect(() => {
    if (lookedUpRef.current && isSamePoint(lookedUpRef.current, center)) return;

    const timer = setTimeout(async () => {
      lookedUpRef.current = center;
      setLookup("loading");
      try {
        const response = await fetch(
          `/api/places/geocode?lat=${center.lat}&lon=${center.lng}`,
        );
        if (!response.ok) {
          setLookup("none");
          return;
        }
        const body = (await response.json()) as {
          place: { name: string | null; address: string | null } | null;
        };
        const found = body.place?.address;
        setLookup(found ? "found" : "none");
        // 名前・住所をまだ触っていないときだけ、地図から取れた値を初期値に入れる。
        if (found && !addressTouched) setAddress(found);
        const foundName = body.place?.name;
        if (foundName && !nameTouched) setName(foundName);
      } catch {
        setLookup("none");
      }
    }, LOOKUP_DELAY_MS);

    return () => clearTimeout(timer);
  }, [center, nameTouched, addressTouched]);

  /** 地点だけを返す（編集の経路）。Notionへは呼び出し側が書くため、ここでは通信しない。 */
  const pick = () => {
    if (!onPicked) return;
    const picked: PickedPoint = {
      coordinates: center,
      // 住所が取れず、手でも入れられていないときは緯度経度を住所にする（登録の経路と同じ扱い）。
      address: address.trim() || formatCoordinates(center),
    };
    writeLastCenter(center);
    setOpen(false);
    setTimeout(() => onPicked(picked), 150);
  };

  const register = async () => {
    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }

    const trimmed = name.trim();
    if (!trimmed) {
      setError("名前を入力してください。");
      return;
    }

    setRegistering(true);
    setError(null);
    try {
      const response = await fetch("/api/places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          // 住所が取れなかったときは緯度経度を住所として入れる。数字のままでも地図は引ける。
          address: address.trim() || formatCoordinates(center),
          coordinates: formatCoordinates(center),
        }),
      });
      if (!response.ok) {
        setError(await readErrorMessage(response, "場所DBに登録できませんでした。"));
        return;
      }

      const place = (await response.json()) as PlaceItem;
      writeLastCenter(center);
      setOpen(false);
      setTimeout(() => onRegistered(place), 150);
    } catch {
      setError("場所DBに登録できませんでした。");
    } finally {
      setRegistering(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{onPicked ? PICK_TITLES[picks] : "地図から場所を登録"}</DialogTitle>
          <DialogDescription>
            {onPicked ? PICK_DESCRIPTIONS[picks] : "中央のピンの位置が登録する地点になります。"}
          </DialogDescription>
        </DialogHeader>

        <TileMap
          center={center}
          zoom={zoom}
          onCenterChange={setCenter}
          onZoomChange={setZoom}
          onLocate={locate}
          locating={locating}
          currentLocation={currentLocation}
          className="h-[40vh] max-h-80 min-h-56"
        />

        <div className="flex flex-col gap-1">
          <Input
            id="place-map-address"
            label="住所"
            value={address}
            onChange={(event) => {
              setAddress(event.target.value);
              setAddressTouched(true);
            }}
            onClear={() => {
              setAddress("");
              setAddressTouched(true);
            }}
          />
          <div className="flex items-start gap-2 text-on-surface-variant">
            {lookup === "loading" ? (
              <>
                <span
                  aria-hidden="true"
                  className="mt-1 size-3.5 shrink-0 animate-spin rounded-full border-2 border-outline-variant border-t-on-surface-variant"
                />
                <span className="type-body-small">住所を調べています…</span>
              </>
            ) : (
              <>
                <MapPin className="mt-0.5 size-4 shrink-0" />
                <span className="type-body-small">
                  {lookup === "found"
                    ? "番地まで出ていなければ書き足せます。"
                    : lookup === "none"
                      ? "住所は分かりませんでした。手で入れるか、空のままなら緯度経度で登録します。"
                      : "地図を動かすと住所を調べます。"}
                </span>
              </>
            )}
          </div>
          <span className="type-body-small pl-6 font-mono text-on-surface-variant opacity-85">
            {formatCoordinates(center)}
          </span>
        </div>

        {/* 地点を選び直すだけの経路では、名前も登録先も呼び出し側で決まっている。 */}
        {!onPicked && (
          <>
            <Input
              id="place-map-name"
              label="名前"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setNameTouched(true);
              }}
            />
            <p className="type-body-small text-on-surface-variant">
              この名前で場所DBへ登録し、場所欄に「名前 住所」の形で入ります。
            </p>
          </>
        )}

        {notice && <p className="type-body-small text-on-surface-variant">{notice}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" disabled={registering} onClick={close}>
            キャンセル
          </Button>
          {onPicked ? (
            // 地点を返すだけなので通信しない。オフラインでも押せる（保存は呼び出し側の操作）。
            <Button onClick={pick}>
              <MapPin className="size-4" />
              {PICK_ACTIONS[picks]}
            </Button>
          ) : (
            <Button disabled={registering || offline || !name.trim()} onClick={register}>
              <Plus className="size-4" />
              {registering ? "登録しています…" : "登録して使う"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
