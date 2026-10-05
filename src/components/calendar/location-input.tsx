"use client";

import { useOffline } from "next/offline";
import { useRef, useState } from "react";

import { MapPin, MapPlus, Plus, Sparkles } from "lucide-react";

import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { PlaceSuggestion } from "@/lib/ai-place-suggest";
import type { LatLng } from "@/lib/coordinates";
import { toLocationText } from "@/lib/place-text";
import type { PlaceItem } from "@/services/notion/places";

import { PlaceMapDialog } from "./place-map-dialog";
import { readErrorMessage } from "./response-error";

/** 一度に出す候補の数。多すぎると入力欄が候補で埋まって、打ち直しの邪魔になる。 */
const MAX_CANDIDATES = 6;

/**
 * 予定の「場所」欄（docs/spec.md §9）。
 *
 * 候補はNotionの場所DBを一次情報源とし、そこに無いものだけAIに尋ねる。
 * AIは呼ぶたびに枠を消費するため、候補が0件のときのボタン操作からだけ呼ぶ。
 * 候補は入力欄の下に押し出して出す。ダイアログの中で重ねると、
 * スクロール領域の端で隠れてどこまで候補があるのか分からなくなるため。
 *
 * 地図から登録する導線（欄の右のアイコン）もここに置く。予定の場所・移動の出発地と目的地は
 * すべてこの部品を使っているため、1か所に足せば3つの欄すべてに入口ができる。
 */
const GOOGLE_MAPS_URL_PATTERN =
  /^https:\/\/(?:maps\.app\.goo\.gl|(?:www\.)?google\.com\/maps|maps\.google\.com)(?:[/?#]\S*)?$/;

export function LocationInput({
  id = "event-location",
  label = "場所",
  value,
  onChange,
  onCommit,
  places,
  eventTitle,
  placeDatabaseReady,
}: {
  /** 入力欄のid。移動では出発地・目的地の2つが同じ画面に並ぶため、呼び出し側で分ける。 */
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  /**
   * 値が確定したとき（欄から離れた・候補を選んだ・地図から登録した）。
   * 打ち終えた時点で保存する画面（設定の既定の出発地）で使う。
   * 候補を押してもフォーカスは欄に残るため、選んだ時点でも呼ぶ。
   */
  onCommit?: (value: string) => void;
  /** Notionの場所DBに登録済みの場所。 */
  places: PlaceItem[];
  /** AIが場所の見当をつける手がかりにする、入力中の予定のタイトル。 */
  eventTitle: string;
  /** 場所DBが設定済みか。未設定ならAIの提案を登録する先が無い。 */
  placeDatabaseReady: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [register, setRegister] = useState(true);
  // この画面で登録したぶん。閉じるまで取り直さないため、候補へ自分で足す。
  const [added, setAdded] = useState<PlaceItem[]>([]);
  const [mapOpen, setMapOpen] = useState(false);

  // 地図のタイルも住所の問い合わせも通信が要る（docs/spec.md §21）。
  const offline = useOffline();

  const query = value.trim();
  const candidates = matchPlaces([...places, ...added], query);
  // 登録も、AIへの問い合わせも、候補が無いときだけ出す。
  // 登録済みの場所で足りるなら、同じ場所を作り直す必要もAIを呼ぶ必要もない。
  const noCandidates = open && query.length > 0 && candidates.length === 0;

  // GoogleマップのURLを貼り付けたときの解析の通し番号。古い応答や、URLを直した後の応答を捨てる（issue #1083）
  const mapsRequestRef = useRef(0);

  /**
   * 欄全体が1つのGoogleマップURL（短縮URLを含む）のときだけ、共有取り込みと同じ解析で
   * 場所名・住所へ置き換える。読めなければURLのまま残す（会議リンクと同じ扱い・docs/spec.md §7）。
   */
  const resolveMapsUrl = async (url: string) => {
    const requestId = (mapsRequestRef.current += 1);
    try {
      const response = await fetch("/api/share-import/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!response.ok || mapsRequestRef.current !== requestId) return;
      const { item } = (await response.json()) as { item: { type: string; title: string; address: string | null } };
      if (item.type !== "place" || !item.title) return;
      const text = toLocationText(item.title, item.address);
      onChange(text);
      onCommit?.(text);
      setOpen(false);
      setNotice("Googleマップの場所を反映しました。");
    } catch {
      // 読めないときはURLのまま残す
    }
  };

  const change = (next: string) => {
    mapsRequestRef.current += 1;
    onChange(next);
    setOpen(true);
    setSuggestions(null);
    setError(null);
    setNotice(null);
    if (!offline && GOOGLE_MAPS_URL_PATTERN.test(next.trim())) void resolveMapsUrl(next.trim());
  };

  /**
   * 場所DBへ1件登録する。
   * 登録に失敗しても入力した場所はそのまま残す。次から候補に出ないだけで、予定は保存できる。
   */
  const registerPlace = async (name: string, address: string | null) => {
    setRegistering(true);
    try {
      const response = await fetch("/api/places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, address }),
      });
      if (!response.ok) {
        setError(await readErrorMessage(response, "場所DBに登録できませんでした。"));
        return;
      }
      const place = (await response.json()) as PlaceItem;
      setAdded((current) => [...current, place]);
      setNotice(`「${place.name}」を場所DBに登録しました。`);
    } catch {
      setError("場所DBに登録できませんでした。");
    } finally {
      setRegistering(false);
    }
  };

  const choose = async (name: string, address: string | null, fromAi: boolean) => {
    const text = toLocationText(name, address);
    onChange(text);
    onCommit?.(text);
    setOpen(false);
    setSuggestions(null);

    if (!fromAi || !register || !placeDatabaseReady) return;
    await registerPlace(name, address);
  };

  /** 打った文字列をそのまま場所DBへ登録する。住所はNotion側で足してもらう。 */
  const registerTyped = async () => {
    setError(null);
    setNotice(null);
    await registerPlace(query, null);
  };

  const ask = async () => {
    setSuggesting(true);
    setError(null);
    try {
      const response = await fetch("/api/places/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, eventTitle }),
      });
      if (!response.ok) {
        setError(await readErrorMessage(response, "AIに聞けませんでした。"));
        return;
      }
      const body = (await response.json()) as { places: PlaceSuggestion[] };
      setSuggestions(body.places);
    } catch {
      setError("AIに聞けませんでした。");
    } finally {
      setSuggesting(false);
    }
  };

  // 打った文字列をそのまま登録する導線。AIに聞く前と、AIから候補が出なかったときの両方で出す。
  const registerButton = placeDatabaseReady ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="w-fit"
      disabled={registering || suggesting}
      // 押した時点で入力欄からフォーカスが外れると、候補ごと閉じてしまう。
      onMouseDown={(event) => event.preventDefault()}
      onClick={registerTyped}
    >
      <Plus className="size-4" />
      {registering ? "登録しています…" : "この場所を登録"}
    </Button>
  ) : null;

  /** 地図で選んで登録できたとき。場所欄へ入れ、この画面のあいだは候補としても出す。 */
  const useRegistered = (place: PlaceItem) => {
    setMapOpen(false);
    setAdded((current) => [...current, place]);
    const text = toLocationText(place.name, place.address);
    onChange(text);
    onCommit?.(text);
    setOpen(false);
    setNotice(`「${place.name}」を場所DBに登録しました。`);
  };

  return (
    <div className="flex flex-col gap-2">
      {mapOpen && (
        <PlaceMapDialog
          query={value}
          places={[...places, ...added]}
          onCancel={() => setMapOpen(false)}
          onRegistered={useRegistered}
        />
      )}

      <div className="flex items-center gap-2">
        {/* Inputのラベル付きの形は外枠がw-fullのため、行の中で縮められるように包む。 */}
        <div className="min-w-0 flex-1">
          <Input
            id={id}
            label={label}
            value={value}
            onChange={(event) => change(event.target.value)}
            // 消した直後は別の場所を選び直したいことが多い。候補は開いたままにする。
            onClear={() => change("")}
            onFocus={() => setOpen(true)}
            onBlur={(event) => {
              setOpen(false);
              onCommit?.(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && open) {
                event.stopPropagation();
                setOpen(false);
              }
            }}
          />
        </div>

        {/* 登録先が無ければ地図で選んでも行き先が無い。場所DBを設定しているときだけ出す。 */}
        {placeDatabaseReady && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="shrink-0"
            aria-label="地図から場所を登録"
            title={offline ? OFFLINE_WRITE_MESSAGE : "地図から場所を登録"}
            disabled={offline}
            // 押した時点で入力欄からフォーカスが外れると、候補ごと閉じてしまう。
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setMapOpen(true)}
          >
            <MapPlus className="size-5" />
          </Button>
        )}
      </div>

      {open && candidates.length > 0 && (
        <ul className="flex flex-col gap-1">
          {candidates.map((place) => (
            <li key={place.id}>
              <CandidateButton
                name={place.name}
                address={place.address}
                tags={place.tags}
                icon={<MapPin className="size-4 shrink-0 text-muted-foreground" />}
                onSelect={() => choose(place.name, place.address, false)}
              />
            </li>
          ))}
        </ul>
      )}

      {noCandidates && (
        <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
          {suggestions === null ? (
            <>
              <p className="text-xs text-muted-foreground">
                登録済みの場所に「{query}」はありません。
              </p>
              <div className="flex flex-wrap gap-2">
                {registerButton}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={suggesting || registering}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={ask}
                >
                  <Sparkles className="size-4" />
                  {suggesting ? "AIに聞いています…" : "AIに聞く"}
                </Button>
              </div>
            </>
          ) : suggestions.length === 0 ? (
            <>
              <p className="text-xs text-muted-foreground">AIからの候補はありませんでした。</p>
              {registerButton}
            </>
          ) : (
            <>
              <ul className="flex flex-col gap-1">
                {suggestions.map((suggestion) => (
                  <li key={`${suggestion.name}:${suggestion.address ?? ""}`}>
                    <CandidateButton
                      name={suggestion.name}
                      address={suggestion.address}
                      tags={[]}
                      icon={<Sparkles className="size-4 shrink-0 text-muted-foreground" />}
                      onSelect={() => choose(suggestion.name, suggestion.address, true)}
                    />
                  </li>
                ))}
              </ul>
              {placeDatabaseReady && (
                <label className="flex min-h-11 items-center gap-3 text-sm select-none">
                  <Checkbox
                    checked={register}
                    onCheckedChange={(checked) => setRegister(checked === true)}
                    // 押した時点で入力欄からフォーカスが外れると、候補ごと閉じてしまう。
                    onMouseDown={(event) => event.preventDefault()}
                  />
                  選んだ場所を場所DBに登録する
                </label>
              )}
            </>
          )}
        </div>
      )}

      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function CandidateButton({
  name,
  address,
  tags,
  icon,
  onSelect,
}: {
  name: string;
  address: string | null;
  tags: string[];
  icon: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left hover:bg-muted"
      // 押した時点で入力欄からフォーカスが外れると、選ぶ前に候補が閉じてしまう。
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
    >
      {icon}
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm">{name}</span>
        {(address || tags.length > 0) && (
          <span className="truncate text-xs text-muted-foreground">
            {[address, tags.join("・")].filter(Boolean).join(" / ")}
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * 登録済みの場所と同じ名前なら住所を添えた文字列にする。
 *
 * 「自宅」のような名前だけでは地点が定まらず、所要時間の見積もりが常に0件になる。
 * 場所DBに住所があるならそれを添えて渡す（docs/spec.md §29「所要時間」）。
 * 名前が完全に一致したときだけ補うのは、すでに `自宅 東京都…` の形で住所が
 * 入っている値へ二重に足さないため。
 */
export function withPlaceAddress(text: string, places: PlaceItem[]): string {
  const query = text.trim();
  if (!query) return query;
  const place = places.find((item) => item.address && item.name === query);
  return place ? toLocationText(place.name, place.address) : query;
}

/**
 * 登録済みの場所と同じ名前なら、その座標を返す。無ければ null。
 *
 * 電車の経路検索は座標で行う（docs/spec.md §29）。画面が持っている場所DBから引くのは、
 * サーバー側で引き直すとボタンを押すたびにNotionの全件取得が増えるため。
 * 名前が完全に一致したときだけ返すのは withPlaceAddress と同じ理由で、
 * `自宅 東京都…` の形で住所まで入っている値を別の場所と取り違えないようにするため。
 */
export function placeCoordinates(text: string, places: PlaceItem[]): LatLng | null {
  const query = text.trim();
  if (!query) return null;
  return places.find((item) => item.coordinates && item.name === query)?.coordinates ?? null;
}

/**
 * 入力に合う場所を絞る。前方一致を先に、部分一致を後に置く。
 * 打ち始めの数文字で目当ての場所が上に来るようにするため。
 */
function matchPlaces(places: PlaceItem[], query: string): PlaceItem[] {
  if (!query) return places.slice(0, MAX_CANDIDATES);

  const needle = query.toLowerCase();
  const scored: { place: PlaceItem; score: number }[] = [];

  for (const place of places) {
    const name = place.name.toLowerCase();
    const address = place.address?.toLowerCase() ?? "";
    const tags = place.tags.join(" ").toLowerCase();

    const score = name.startsWith(needle)
      ? 0
      : address.startsWith(needle)
        ? 1
        : name.includes(needle)
          ? 2
          : address.includes(needle)
            ? 3
            : tags.includes(needle)
              ? 4
              : -1;

    if (score >= 0) scored.push({ place, score });
  }

  return scored
    .sort((a, b) => a.score - b.score || a.place.name.localeCompare(b.place.name, "ja"))
    .slice(0, MAX_CANDIDATES)
    .map((item) => item.place);
}
