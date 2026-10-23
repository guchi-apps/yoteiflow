"use client";

import { useOffline } from "next/offline";
import { ArrowUpDown, Bell, BellOff, CheckCircle2, CircleAlert, ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { eventNotificationSummary, sameNotificationOverride } from "@/lib/event-notification";
import { cn } from "@/lib/utils";
import { candidateFormTimes, deriveOtherSide, type TimeBasis } from "@/lib/share-import/candidate-times";
import type { ShareRouteCandidate, SharedImport } from "@/lib/share-import/types";
import { googleMapsDirectionsLink } from "@/lib/google-maps-directions-link";
import { placeDisplayName } from "@/lib/place-text";
import { placeTextForCoordinates } from "@/lib/place-by-coordinates";
import { travelTitle } from "@/lib/travel-title";
import { clearTransitInNativeApp, hasNativeTransit, openTransitInNativeApp, type NativeTransitOpened } from "@/lib/native-transit";
import { clearTransitSession, rememberTransitSession } from "@/lib/transit-search-session";
import { transitConditionSummary, transitSearchCondition, yahooTransitAppLink } from "@/lib/yahoo-transit-app";
import { resolveYahooPlace, yahooTransitLink } from "@/lib/yahoo-transit-link";
import {
  suggestTransitSearch,
  transitRouteWarnings,
  type ContextEvent,
  type ContextTravel,
  type TransitSuggestion,
} from "@/lib/transit-suggest";
import type { PlaceCatalog } from "@/services/notion/places";
import {
  TRAVEL_MODES,
  TRAVEL_MODE_LABELS,
  type EventNotificationOverride,
  type TravelEstimateSource,
  MAX_TRAVEL_SEARCH_MARGIN_MINUTES,
  type TravelItem,
  type TravelMode,
  type TravelSearchPurpose,
} from "@/types/calendar";

import { DateTimeInput } from "./date-time-input";
import { DeleteItemDialog } from "./delete-item-dialog";
import { EventNotificationDialog } from "./event-notification-dialog";
import { isoToLocalInput, localInputToIso } from "./datetime-fields";
import { ItemFormActions } from "./item-form-actions";
import { LocationInput } from "./location-input";
import { readErrorMessage } from "./response-error";
import type { TouchedRange } from "./use-calendar-chunks";

export type TravelDraft = {
  travel?: TravelItem;
  origin: string;
  destination: string;
  /** 経由地（順番どおり・issue #1197）。無ければ経由なし */
  via?: string[];
  mode: TravelMode;
  /** 入力欄の形式（YYYY-MM-DDTHH:mm）。 */
  departAt: string;
  arriveAt: string;
  note?: string;
  /**
   * 元になった予定。移動と予定の紐づけに使う。時刻は持ち物の期限を予定前の移動へ自動で付けるかの
   * 判断に渡す（issue #1137）。「＋」から作った移動には無い。
   */
  linkedEvent?: {
    id: string;
    calendarId: string;
    startAt: string;
    endAt: string;
    /** 予定前後の提案に使う予定の名前と場所（issue #1331）。予定の「移動を追加」からだけ渡る */
    title?: string;
    location?: string | null;
  } | null;
  /** 入力欄の上に添える案内（共有拡張から紐づけて作るときの日付・メモの断り。issue #1128）。 */
  notice?: string;
  /** 所要時間の出どころの初期値（共有で受けたAIの目安など。issue #1142）。無ければ手入力。 */
  estimateSource?: TravelEstimateSource;
  /** 共有拡張から渡されたGoogleマップのURL。開いた直後に取り込み、候補が複数なら選ばせる（issue #1160）。 */
  resolveUrl?: string;
  /** 共有拡張の確認画面で選んだ経路。再取得した候補のうち名前・距離が一致するものを選択済みにする（issue #1168）。 */
  preselectRoute?: { name: string; distance: string | null };
  /**
   * 通知設定の初期値。Yahoo!で検索して戻ってきた下書き（issue #1330）のように、編集中の移動の
   * 保存済みの値ではなく、出かける前に選んでいた値を引き継ぐときだけ渡す。無ければ移動の保存済みの値。
   */
  notification?: EventNotificationOverride | null;
  /** 探した意図と余裕分（issue #1331）。予定の「移動を追加」・Yahoo!から戻った下書きで渡る */
  searchPurpose?: TravelSearchPurpose | null;
  searchMarginMinutes?: number | null;
  /** 「予定前」に切り替えたときの余裕分（設定 ▸ 移動の「予定の何分前に着くか」） */
  defaultArriveMargin?: number;
  /** 周辺に候補が無いときの出発地・目的地（設定の既定の出発地＝自宅） */
  home?: string | null;
  /** 開いた直後に、まだ触っていない欄を提案で埋めるか。予定の「移動を追加」から新しく作るときだけ */
  autoSuggest?: boolean;
};

type TransitContext = { events: ContextEvent[]; travels: ContextTravel[]; partial: boolean };

type GoogleRouteStatus =
  | { kind: "idle" }
  | { kind: "analyzing" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

/**
 * 移動の入力欄（docs/spec.md §29）。ダイアログの枠と種類の切り替えは ItemDialog が持つ。
 *
 * 出発地・目的地は予定の「場所」欄と同じ入力を使う。候補の一次情報源はNotionの場所DBで、
 * 移動のためにもう1つ候補の置き場所を作らない。
 */
export function TravelForm({
  draft,
  placeCatalog,
  timeZone,
  onSaved,
}: {
  draft: TravelDraft;
  /** 出発地・目的地の入力候補。Notionの場所DBに登録済みのもの。 */
  placeCatalog: PlaceCatalog;
  timeZone: string;
  onSaved: (touched: TouchedRange[] | null) => void;
}) {
  const editing = draft.travel;

  const [origin, setOrigin] = useState(draft.origin);
  const [destination, setDestination] = useState(draft.destination);
  const [via, setVia] = useState<string[]>(draft.via ?? []);
  const [mode, setMode] = useState<TravelMode>(draft.mode);
  const [departAt, setDepartAt] = useState(draft.departAt);
  const [arriveAt, setArriveAt] = useState(draft.arriveAt);
  const [note, setNote] = useState(draft.note ?? "");
  // 時刻の基準（利用者が固定する側）。出発基準は到着＝出発＋所要時間、到着基準は出発＝到着−所要時間（issue #1203）
  // 予定前の移動として開いたときは、到着を基準にする（issue #1331）
  const [basis, setBasis] = useState<TimeBasis>(draft.searchPurpose === "BEFORE_EVENT" ? "arrive" : "depart");
  // Googleマップの経路（選んだ候補）の代表時間（分）。未取得・手入力で時間帯を決めたときは null
  const [routeMinutes, setRouteMinutes] = useState<number | null>(null);
  // 利用者が直した項目。あとから届く解析結果で無断で上書きしない
  const touchedRef = useRef(new Set<"origin" | "destination" | "via" | "mode" | "times" | "basis">());
  const touch = (field: "origin" | "destination" | "via" | "mode" | "times" | "basis") => {
    touchedRef.current.add(field);
  };
  // 所要時間の出どころ。手で入れた値・AIの目安・経路検索の結果を保存先にも残す。
  const [estimateSource, setEstimateSource] = useState<TravelEstimateSource>(
    editing?.estimateSource ?? draft.estimateSource ?? "MANUAL",
  );

  // 通知設定（issue #1112）。出発時刻を基準に、予定と同じ選び方をする。
  const [notification, setNotification] = useState<EventNotificationOverride | null>(
    draft.notification !== undefined ? draft.notification : (editing?.notification ?? null),
  );
  const [editingNotification, setEditingNotification] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 保存はできたが、Googleカレンダーへ書き出せなかったとき。黙って閉じると気付けない。
  const [exportNotice, setExportNotice] = useState<{ message: string; touched: TouchedRange[] } | null>(
    null,
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Googleマップから取り込んだ結果の報せ。入力全体の保存エラーとは別に、URL欄の近くで経過を伝える。
  const [googleRouteStatus, setGoogleRouteStatus] = useState<GoogleRouteStatus>({ kind: "idle" });
  const [googleRouteUrl, setGoogleRouteUrl] = useState("");
  // 貼り直したあとに先行リクエストが返っても、古い経路で入力欄を上書きしないための世代番号。
  const googleRouteRequestRef = useRef(0);

  const offline = useOffline();
  // オフライン中は地図もGoogleマップのアプリも通信が要るため出さない（予定の場所リンクと同じ扱い）
  const mapsLink = offline
    ? null
    : googleMapsDirectionsLink({ origin, destination, via, mode, places: placeCatalog.places });

  // Yahoo!乗換案内アプリで検索する条件（公共交通のときだけ・issue #1330）。必須は発着地と基準側の日時だけ
  const nativeTransit = useSyncExternalStore(() => () => {}, hasNativeTransit, () => false);
  const [transitStatus, setTransitStatus] = useState<NativeTransitOpened | null>(null);
  const transitCondition =
    mode === "PUBLIC_TRANSIT" && !offline
      ? transitSearchCondition({
          origin: resolveYahooPlace(origin, placeCatalog.places),
          destination: resolveYahooPlace(destination, placeCatalog.places),
          departAt,
          arriveAt,
          basis,
        })
      : null;
  const transitLinks = transitCondition?.ok
    ? {
        app: yahooTransitAppLink(transitCondition),
        // Web版も同じ基準側の日時だけで探す（反対側の仮の値で探さない）
        web: yahooTransitLink({
          origin: transitCondition.origin,
          destination: transitCondition.destination,
          departAt: basis === "depart" ? departAt : "",
          arriveAt: basis === "arrive" ? arriveAt : "",
          basis,
        }),
      }
    : null;
  const chooseTransitBasis = (side: TimeBasis) => {
    touch("basis");
    setBasis(side);
  };
  // 予定の前後の移動として探す（issue #1331）。対象の予定の名前・場所が分かっているときだけ（予定の「移動を追加」から）
  const linked = draft.linkedEvent;
  const suggestTarget =
    linked && linked.title !== undefined
      ? {
          id: linked.id,
          title: linked.title,
          start: linked.startAt,
          end: linked.endAt,
          allDay: !linked.startAt.includes("T"),
          location: linked.location ?? null,
        }
      : null;
  const defaultArriveMargin = draft.defaultArriveMargin ?? 15;
  const [purpose, setPurpose] = useState<TravelSearchPurpose | null>(
    draft.searchPurpose ?? editing?.searchPurpose ?? null,
  );
  const [marginText, setMarginText] = useState(
    String(draft.searchMarginMinutes ?? editing?.searchMarginMinutes ?? (purpose === "AFTER_EVENT" ? 0 : defaultArriveMargin)),
  );
  const marginMinutes = (() => {
    const value = Number(marginText);
    return Number.isInteger(value) && value >= 0 && value <= MAX_TRAVEL_SEARCH_MARGIN_MINUTES ? value : null;
  })();
  const [transitContext, setTransitContext] = useState<TransitContext | "loading" | "error" | null>(null);
  const formatClock = (iso: string) => isoToLocalInput(iso, timeZone).slice(11, 16).replace(/^0/, "");
  const buildSuggestion = (
    nextPurpose: TravelSearchPurpose,
    nextMargin: number,
    context: TransitContext | null,
  ): TransitSuggestion | null =>
    suggestTarget
      ? suggestTransitSearch({
          target: suggestTarget,
          purpose: nextPurpose,
          marginMinutes: nextMargin,
          events: context?.events ?? [],
          travels: context?.travels ?? [],
          home: draft.home ?? null,
          excludeTravelId: editing?.id ?? null,
          formatTime: formatClock,
        })
      : null;
  const loadedContext = typeof transitContext === "object" ? transitContext : null;
  const suggestion =
    mode === "PUBLIC_TRANSIT" && purpose && marginMinutes !== null
      ? buildSuggestion(purpose, marginMinutes, loadedContext)
      : null;

  /**
   * 提案を入力欄へ入れる。地点は利用者がまだ触っていない欄だけ（届くのが遅れても入力を上書きしない）。
   * 基準の日時は、予定前後・余裕分を利用者が選び直したとき（force）と、まだ時刻を触っていないときに入れる。
   */
  const applySuggestion = (next: TransitSuggestion | null, options: { force?: boolean; places?: boolean } = {}) => {
    if (!next) return;
    const touched = touchedRef.current;
    if (next.at && (options.force || !touched.has("times"))) {
      const at = isoToLocalInput(next.at, timeZone);
      const currentMs = new Date(`${arriveAt}:00Z`).getTime() - new Date(`${departAt}:00Z`).getTime();
      const lengthMs = Number.isFinite(currentMs) && currentMs > 0 ? currentMs : 30 * 60_000;
      const shift = (local: string, delta: number) => new Date(new Date(`${local}:00Z`).getTime() + delta).toISOString().slice(0, 16);
      if (next.basis === "arrive") {
        setArriveAt(at);
        setDepartAt(shift(at, -lengthMs));
      } else {
        setDepartAt(at);
        setArriveAt(shift(at, lengthMs));
      }
    }
    if (options.force || !touched.has("basis")) setBasis(next.basis);
    if (!options.places) return;
    const before = next.purpose === "BEFORE_EVENT";
    const eventSide = before ? "destination" : "origin";
    const otherSide = before ? "origin" : "destination";
    const setSide = (side: "origin" | "destination", value: string) => (side === "origin" ? setOrigin(value) : setDestination(value));
    if (next.eventPlace && !touched.has(eventSide)) setSide(eventSide, next.eventPlace);
    if (next.candidates[0] && !touched.has(otherSide)) setSide(otherSide, next.candidates[0].text);
  };

  // 周辺の予定・移動は、予定の前後として探せる公共交通のときに1回だけ取る（表示中の範囲に依存しない）
  const contextRequestedRef = useRef(false);
  const loadTransitContext = (nextPurpose: TravelSearchPurpose | null) => {
    if (!suggestTarget || contextRequestedRef.current || suggestTarget.allDay) return;
    contextRequestedRef.current = true;
    setTransitContext("loading");
    const query = new URLSearchParams({ start: suggestTarget.start, end: suggestTarget.end });
    fetch(`/api/travels/context?${query.toString()}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const context = (await response.json()) as TransitContext;
        setTransitContext(context);
        // 開いた直後の提案（新しく作るときだけ）。届くまでに触った欄はそのまま
        if (draft.autoSuggest && nextPurpose && marginMinutes !== null) {
          applySuggestion(buildSuggestion(nextPurpose, marginMinutes, context), { places: true });
        }
      })
      .catch(() => {
        setTransitContext("error");
        // 周辺が読めなくても、基準の日時と自宅の候補までは入れる
        if (draft.autoSuggest && nextPurpose && marginMinutes !== null) {
          applySuggestion(buildSuggestion(nextPurpose, marginMinutes, null), { places: true });
        }
      });
  };
  useEffect(() => {
    if (mode === "PUBLIC_TRANSIT") loadTransitContext(purpose);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 開いたとき（と公共交通へ切り替えたとき）に1回だけ取る
  }, [mode]);

  /** 予定前／予定後を選び直す。余裕分はその向きの既定へ戻し、基準の日時を求め直す */
  const choosePurpose = (next: TravelSearchPurpose) => {
    const margin = next === "BEFORE_EVENT" ? defaultArriveMargin : 0;
    setPurpose(next);
    setMarginText(String(margin));
    applySuggestion(buildSuggestion(next, margin, loadedContext), { force: true, places: loadedContext !== null });
  };
  const changeMargin = (text: string) => {
    setMarginText(text);
    const value = Number(text);
    if (!purpose || text.trim() === "" || !Number.isInteger(value) || value < 0 || value > MAX_TRAVEL_SEARCH_MARGIN_MINUTES) return;
    applySuggestion(buildSuggestion(purpose, value, loadedContext), { force: true });
  };
  const chooseCandidate = (text: string) => {
    if (purpose === "BEFORE_EVENT") editOrigin(text);
    else editDestination(text);
  };
  const routeWarnings =
    suggestion && suggestTarget && departAt && arriveAt
      ? transitRouteWarnings({
          target: suggestTarget,
          purpose: suggestion.purpose,
          marginMinutes: marginMinutes ?? 0,
          departAt: localInputToIso(departAt, timeZone),
          arriveAt: localInputToIso(arriveAt, timeZone),
          nextEvent: suggestion.nextEvent,
          previousEvent: suggestion.previousEvent,
          formatTime: formatClock,
        })
      : [];

  /** アプリ内: 下書きを覚えてからYahoo!アプリを開く。開けなければアプリが同じ条件のWeb版を開く */
  const searchInYahooApp = async () => {
    if (!transitLinks?.app) return;
    const label = `${placeDisplayName(origin)}→${placeDisplayName(destination)}`;
    const session = rememberTransitSession(label, {
      travel: editing,
      origin,
      destination,
      via,
      mode,
      departAt,
      arriveAt,
      note,
      linkedEvent: draft.linkedEvent ?? null,
      notification,
      searchPurpose: purpose,
      searchMarginMinutes: marginMinutes,
      defaultArriveMargin: draft.defaultArriveMargin,
      home: draft.home,
    });
    setTransitStatus(
      await openTransitInNativeApp({
        appUrl: transitLinks.app,
        webUrl: transitLinks.web,
        session: { id: session.id, label: session.label, expiresAt: session.expiresAt },
      }),
    );
  };

  // 所要時間（分）。取得済みの代表時間、無ければ両側を入れていたときの長さ。計算ボタンと保存時の補完に使う（issue #1209）
  const [lengthMinutes, setLengthMinutes] = useState<number | null>(null);
  const knownMinutes = routeMinutes ?? lengthMinutes;
  // 片側だけでも、所要時間が分かれば保存時に反対側を求められる
  const resolvedTimes = (() => {
    if (departAt && arriveAt) return { departAt, arriveAt };
    if (departAt) return { departAt, arriveAt: deriveOtherSide("depart", departAt, knownMinutes) };
    if (arriveAt) return { departAt: deriveOtherSide("arrive", arriveAt, knownMinutes), arriveAt };
    return { departAt: "", arriveAt: "" };
  })();

  const rangeError = (() => {
    if (!resolvedTimes.departAt || !resolvedTimes.arriveAt) {
      return departAt || arriveAt
        ? "所要時間が分からないため、出発時刻と到着時刻の両方を入力してください。"
        : "出発時刻と到着時刻を入力してください。";
    }
    return resolvedTimes.arriveAt <= resolvedTimes.departAt ? "到着時刻が出発時刻より後になるようにしてください。" : null;
  })();

  const inputError =
    rangeError ??
    (origin.trim() && destination.trim() ? null : "出発地と目的地を入力してください。");

  /**
   * 時刻を手で直したとき。出どころを手入力へ戻す。
   *
   * 直した値はもう経路検索・AIが出したものではない。戻さないと、手で入れた時刻に
   * 「経路検索の平均」と付いたまま保存され、Googleの予定の説明にもその断りが残る。
   * 候補を押したときは applyEstimate が直接 setDepartAt / setArriveAt を呼ぶため、
   * この経路は通らない（出どころが押した候補のまま残る）。
   */
  const editTime = (side: TimeBasis, value: string) => {
    touch("times");
    // 直す前に両側が入っていれば、その長さを覚える（計算ボタンで使う）。反対側は自動では動かさない（手入力の所要時間を妨げない）
    if (routeMinutes === null && departAt && arriveAt) {
      const gap = (new Date(`${arriveAt}:00Z`).getTime() - new Date(`${departAt}:00Z`).getTime()) / 60_000;
      if (Number.isFinite(gap) && gap > 0) setLengthMinutes(gap);
    }
    if (side === "depart") setDepartAt(value);
    else setArriveAt(value);
    // 手で直した時刻はGoogle由来の所要時間と混同しない。計算ボタンで求め直すと戻る
    setEstimateSource("MANUAL");
  };
  /** 「出発日時から計算」「到着日時から計算」。押した側を固定し、反対側を所要時間から求める */
  const calculateFrom = (side: TimeBasis) => {
    touch("times");
    touch("basis");
    setBasis(side);
    const fixed = side === "depart" ? departAt : arriveAt;
    const other = deriveOtherSide(side, fixed, knownMinutes);
    if (!other) return;
    if (side === "depart") setArriveAt(other);
    else setDepartAt(other);
    if (routeMinutes !== null) setEstimateSource("GOOGLE_MAPS");
  };
  const editDepartAt = (value: string) => editTime("depart", value);
  const editArriveAt = (value: string) => editTime("arrive", value);

  const editOrigin = (value: string) => {
    touch("origin");
    setOrigin(value);
  };
  const editDestination = (value: string) => {
    touch("destination");
    setDestination(value);
  };
  // 帰りの移動を作るときに、予定から入った「自宅→予定の場所」を1押しで逆向きにする（issue #1323）。
  // 経由地も逆順にする。取り込んだGoogleマップの経路（代表時間・候補）は元の向きのものなので捨て、
  // 解析中の結果も受け取らない。日時の入力値はそのまま残し、所要時間は手入力の扱いへ戻す。
  const swapEnds = () => {
    touch("origin");
    touch("destination");
    touch("via");
    setOrigin(destination);
    setDestination(origin);
    setVia((current) => [...current].reverse());
    googleRouteRequestRef.current += 1;
    setGoogleRouteStatus({ kind: "idle" });
    setRouteMinutes(null);
    setRouteCandidates(null);
    setSelectedRoute(null);
    if (estimateSource === "GOOGLE_MAPS") setEstimateSource("MANUAL");
  };
  const editMode = (value: TravelMode) => {
    touch("mode");
    setMode(value);
  };

  /**
   * 開始・終了（ISO）または所要時間（分）を入力欄へ反映する。予定に紐づく移動は予定の日を動かさず時刻だけ取り込む。
   * 片側（固定側）しか決まらないときは、もう一方を今の長さで保つ。何も決まらなければ触らない。
   */
  const applyTimes = (times: { startAt: string | null; endAt: string | null; minutes: number | null }) => {
    const toInput = (iso: string, reference: string) => {
      const local = isoToLocalInput(iso, timeZone);
      return draft.linkedEvent ? `${reference.slice(0, 10)}${local.slice(10)}` : local;
    };
    const currentMs = new Date(`${arriveAt}:00Z`).getTime() - new Date(`${departAt}:00Z`).getTime();
    const durationMs = times.minutes !== null ? times.minutes * 60_000 : Number.isFinite(currentMs) && currentMs > 0 ? currentMs : null;
    const format = (ms: number) => new Date(ms).toISOString().slice(0, 16);
    if (times.startAt && times.endAt) {
      const depart = toInput(times.startAt, departAt);
      const length = new Date(times.endAt).getTime() - new Date(times.startAt).getTime();
      setDepartAt(depart);
      setArriveAt(format(new Date(`${depart}:00Z`).getTime() + length));
    } else if (times.startAt && durationMs !== null) {
      const depart = toInput(times.startAt, departAt);
      setDepartAt(depart);
      setArriveAt(format(new Date(`${depart}:00Z`).getTime() + durationMs));
    } else if (times.endAt && durationMs !== null) {
      const arrive = toInput(times.endAt, arriveAt);
      setArriveAt(arrive);
      setDepartAt(format(new Date(`${arrive}:00Z`).getTime() - durationMs));
    } else if (times.minutes !== null) {
      // 指定日時が無い共有: 利用者が選んでいる基準側（既定は出発＝入力開始時の現在時刻）を保つ
      if (basis === "arrive" && arriveAt) setDepartAt(format(new Date(`${arriveAt}:00Z`).getTime() - times.minutes * 60_000));
      else setArriveAt(format(new Date(`${departAt}:00Z`).getTime() + times.minutes * 60_000));
    } else {
      return false;
    }
    return true;
  };

  const appendNote = (text: string) =>
    setNote((current) => (current.includes(text) ? current : [current.trim(), text].filter(Boolean).join("\n")));

  // 共有URLに複数の経路候補があるとき、利用者が1件選ぶまで確定しない（先頭を共有時の経路と断定しない・issue #1160・#1168）
  const [routeCandidates, setRouteCandidates] = useState<ShareRouteCandidate[] | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<number | null>(null);

  /** 選んだ経路の行をメモへ置き換える（切り替えても前の経路の行が残らない） */
  const setRouteNote = (candidate: ShareRouteCandidate) => {
    const line = `選んだ経路: ${[candidate.name, candidate.distanceText, candidate.representativeText && `代表時間 ${candidate.representativeText}`].filter(Boolean).join(" / ")}`;
    setNote((current) =>
      [...current.split("\n").filter((row) => !row.startsWith("選んだ経路: ")), line].join("\n").trim(),
    );
  };

  /** 候補を選ぶ。固定した出発／到着日時は保ち、選んだ候補の代表時間だけから反対側を求める（別候補の値は混ぜない） */
  const selectRouteCandidate = (candidates: ShareRouteCandidate[], index: number) => {
    const candidate = candidates[index];
    if (!candidate) return;
    const times = candidateFormTimes(
      candidate,
      { departAt, arriveAt },
      (iso) => isoToLocalInput(iso, timeZone),
      draft.linkedEvent ? { departAt, arriveAt } : null,
      basis,
    );
    setDepartAt(times.departAt);
    setArriveAt(times.arriveAt);
    setRouteMinutes(candidate.minutes);
    setSelectedRoute(index);
    setEstimateSource(candidate.minutes !== null ? "GOOGLE_MAPS" : "MANUAL");
    setRouteNote(candidate);
  };

  /**
   * Googleマップの共有URLを貼り付けたとき、読めた経路を入力欄へ反映する。共有・URL貼り付けで同じ解釈（`SharedImport`）を使う。
   * 日時・所要時間はGoogleを再取得した代表時間で、取れなかった項目は触らず手で入れてもらう（issue #1142・#1160・#1168）。
   */
  const applyGoogleMapsRoute = (item: SharedImport, sourceUrl: string | null) => {
    // 座標だけの地点（Googleの保存地点「自宅」など）は、近くの登録済みの場所の名前へ直す（issue #1197）
    const named = (value: string) => placeTextForCoordinates(value, placeCatalog.places) ?? value;
    // 解析中に利用者が直した項目は上書きしない（issue #1203）
    const touched = touchedRef.current;
    if (item.origin && !touched.has("origin")) setOrigin(named(item.origin));
    if (item.destination && !touched.has("destination")) setDestination(named(item.destination));
    if (!touched.has("via")) setVia(item.via.map(named));
    if (item.mode && !touched.has("mode")) setMode(item.mode);
    // 日時指定ありの共有は、共有された基準（出発指定／到着指定）を採る
    if (item.scheduleBasis && !touched.has("basis")) setBasis(item.scheduleBasis);
    const keepTimes = touched.has("times");

    setRouteCandidates(item.candidates);
    setSelectedRoute(null);
    let applied: boolean;
    if (item.candidates) {
      // 未選択のあいだも、指定された出発／到着日時（固定側）は入力欄へ保持する
      const preselect = draft.preselectRoute;
      const index = preselect
        ? item.candidates.findIndex((candidate) => candidate.name === preselect.name && candidate.distanceText === preselect.distance)
        : -1;
      if (keepTimes) {
        applied = true;
      } else if (index >= 0) {
        selectRouteCandidate(item.candidates, index);
        applied = true;
      } else {
        const fixed = candidateFormTimes(
          { startAt: item.startAt, endAt: item.endAt, minutes: null },
          { departAt, arriveAt },
          (iso) => isoToLocalInput(iso, timeZone),
          draft.linkedEvent ? { departAt, arriveAt } : null,
        );
        if (item.startAt || item.endAt) {
          setDepartAt(fixed.departAt);
          setArriveAt(fixed.arriveAt);
        }
        applied = false;
      }
    } else if (keepTimes) {
      applied = true;
    } else {
      applied = applyTimes({ startAt: item.startAt, endAt: item.endAt, minutes: item.durationMinutes });
      if (applied) {
        setEstimateSource(item.estimateSource ?? "MANUAL");
        setRouteMinutes(item.estimateSource === "GOOGLE_MAPS" ? item.durationMinutes : null);
      }
    }
    // 元の共有URL・予測の幅・距離をメモへ残し、登録後にも参照できるようにする
    const detail = item.detail ?? sourceUrl;
    if (detail) appendNote(detail);
    setError(null);
    return applied;
  };

  const applyRouteRef = useRef(applyGoogleMapsRoute);
  useEffect(() => {
    applyRouteRef.current = applyGoogleMapsRoute;
  });

  const importGoogleMapsRoute = async (value: string) => {
    const requestId = googleRouteRequestRef.current + 1;
    googleRouteRequestRef.current = requestId;
    const isCurrentRequest = () => googleRouteRequestRef.current === requestId;
    setGoogleRouteStatus({ kind: "analyzing" });
    setRouteCandidates(null);
    setSelectedRoute(null);
    setError(null);
    try {
      const response = await fetch("/api/travels/google-maps-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 所要時間はGoogleの代表時間だけ。共有確認画面のAIの目安は引き継がない（issue #1221）
        body: JSON.stringify({ url: value }),
      });
      if (!response.ok) {
        const message = await readErrorMessage(response, "Googleマップの経路URLを読み取れませんでした。");
        if (isCurrentRequest()) setGoogleRouteStatus({ kind: "error", message });
        return;
      }
      const { item } = (await response.json()) as { item: SharedImport };
      if (!isCurrentRequest()) return;
      // 非同期の完了時点の最新の入力値で反映する（古い描画の値で上書きしない）
      const applied = applyRouteRef.current(item, item.sourceUrl ?? value);
      const modeLabel = item.mode ? TRAVEL_MODE_LABELS[item.mode] : "";
      setGoogleRouteStatus({
        kind: "success",
        message: [
          `Googleマップの経路を反映しました${modeLabel ? `（${modeLabel}）` : ""}。`,
          applied ? "出発・到着時刻は保存前に直せます。" : item.candidates ? null : "日時・所要時間を反映できなかったため、出発・到着時刻を入力してください。",
          item.notice,
        ]
          .filter(Boolean)
          .join(""),
      });
    } catch {
      if (isCurrentRequest()) {
        setGoogleRouteStatus({ kind: "error", message: "Googleマップの経路URLを読み取れませんでした。" });
      }
    }
  };

  const changeGoogleRouteUrl = (value: string) => {
    // 手入力でURLを直した時点で、前の解析結果は対象外にする。貼り付け時は直後に新しい解析を始める。
    googleRouteRequestRef.current += 1;
    setGoogleRouteUrl(value);
    setGoogleRouteStatus({ kind: "idle" });
  };

  // 共有拡張から渡されたURLは、開いた直後に1回だけ取り込む（同期でsetStateしないようタイマー内で呼ぶ）
  const resolveUrl = draft.resolveUrl;
  useEffect(() => {
    if (!resolveUrl || editing) return;
    const timer = setTimeout(() => {
      setGoogleRouteUrl(resolveUrl);
      void importGoogleMapsRoute(resolveUrl);
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolveUrl]);

  const save = async () => {
    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const departIso = localInputToIso(resolvedTimes.departAt, timeZone);
      const arriveIso = localInputToIso(resolvedTimes.arriveAt, timeZone);

      const payload = {
        origin: origin.trim(),
        destination: destination.trim(),
        via,
        mode,
        departAt: departIso,
        arriveAt: arriveIso,
        note: note.trim() || null,
        estimateSource,
        // 予定の前後として探した移動だけ、その意図と余裕分を残す（#1332 の再提案が使う・issue #1331）
        ...(suggestTarget && mode === "PUBLIC_TRANSIT" && purpose
          ? { searchPurpose: purpose, searchMarginMinutes: marginMinutes ?? 0 }
          : {}),
        ...(editing
          ? {}
          : {
              linkedEventId: draft.linkedEvent?.id ?? null,
              linkedCalendarId: draft.linkedEvent?.calendarId ?? null,
              ...(draft.linkedEvent
                ? {
                    eventStart: draft.linkedEvent.startAt,
                    eventEnd: draft.linkedEvent.endAt,
                    eventAllDay: !draft.linkedEvent.startAt.includes("T"),
                  }
                : {}),
            }),
      };

      const response = await fetch(
        editing ? `/api/travels/${encodeURIComponent(editing.id)}` : "/api/travels",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        setError(await readErrorMessage(response, "保存できませんでした。"));
        return;
      }

      const body = (await response.json()) as {
        exports?: { status: string; reason?: string }[];
        travels?: { id: string }[];
      };
      // Yahoo!で検索して待っていた下書きは、保存したら用済み（あとの共有を古い下書きへ反映させない・issue #1330）
      clearTransitSession();
      clearTransitInNativeApp();

      // 通知設定は移動の保存後に送る（予定と同じベストエフォート。移動は保存できているため、
      // 失敗してもここでは止めない）。新規作成は往路（先頭）だけが対象で、復路は詳細から設定する。
      const notificationTravelId = editing ? editing.id : (body.travels?.[0]?.id ?? null);
      const notificationChanged = editing
        ? !sameNotificationOverride(editing.notification ?? null, notification)
        : notification !== null;

      if (notificationTravelId && notificationChanged) {
        try {
          const notifyUrl = `/api/travels/${encodeURIComponent(notificationTravelId)}/notification`;
          const notifyResponse = notification?.enabled
            ? await fetch(notifyUrl, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ enabled: true, leadMinutes: notification.leadMinutes }),
              })
            : await fetch(notifyUrl, { method: "DELETE" });
          if (!notifyResponse.ok) console.error("[dayspan] travel notification setting: save failed");
        } catch (cause) {
          console.error("[dayspan] travel notification setting: save failed:", cause);
        }
      }

      const touched: TouchedRange[] = [{ start: departIso, end: arriveIso }];
      if (editing) touched.push({ start: editing.start, end: editing.end });

      const message = exportWarning(body.exports ?? []);
      if (message) {
        // 移動そのものは保存できている。閉じてよいことも伝えたうえで理由を残す。
        setExportNotice({ message, touched });
        return;
      }

      onSaved(touched);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {editing && confirmingDelete && (
        <DeleteItemDialog
          item={{ kind: "travel", travel: editing }}
          onCancel={() => setConfirmingDelete(false)}
          onDeleted={onSaved}
        />
      )}

      <div className="flex min-w-0 flex-col gap-4">
        <LocationInput
          id="travel-origin"
          label="出発地"
          value={origin}
          onChange={editOrigin}
          places={placeCatalog.places}
          eventTitle={destination}
          placeDatabaseReady={placeCatalog.ready}
        />

        {via.length > 0 && (
          <div className="flex min-w-0 flex-col gap-1">
            <span className="type-label-small px-1 text-on-surface-variant">経由地</span>
            <ul className="flex flex-wrap gap-2">
              {via.map((item, index) => (
                <li key={`${index}-${item}`}>
                  <button
                    type="button"
                    className="type-label-medium max-w-full truncate rounded-full border border-outline-variant px-3 py-1 text-on-surface"
                    aria-label={`経由地「${placeDisplayName(item)}」を外す`}
                    onClick={() => {
                      touch("via");
                      setVia((current) => current.filter((_, i) => i !== index));
                    }}
                  >
                    {placeDisplayName(item)} ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 欄の間隔を増やさないよう、上下の欄へ食い込ませて右端に置く。 */}
        <div className="relative z-10 -my-4 flex justify-end pr-2">
          <button
            type="button"
            className="flex size-11 items-center justify-center rounded-full border border-outline-variant bg-surface-container-high text-on-surface-variant transition-[border-radius] active:rounded-xl disabled:opacity-38"
            aria-label="出発地と目的地を入れ替える"
            title="出発地と目的地を入れ替える"
            disabled={!origin.trim() && !destination.trim()}
            onClick={swapEnds}
          >
            <ArrowUpDown className="size-5" aria-hidden="true" />
          </button>
        </div>

        <LocationInput
          id="travel-destination"
          label="目的地"
          value={destination}
          onChange={editDestination}
          places={placeCatalog.places}
          eventTitle={destination}
          placeDatabaseReady={placeCatalog.ready}
        />

        {/* 素の <a> にするのは、iOSがGoogleマップのアプリを開けるようにするため（issue #1225）。
            出発地・目的地・交通手段は入力欄の現在値から組み立てる。 */}
        {mapsLink && (
          <a
            href={mapsLink}
            target="_blank"
            rel="noopener noreferrer"
            className="type-label-large inline-flex items-center gap-1.5 self-start rounded-full border border-outline-variant px-3 py-1.5 text-on-surface"
          >
            <ExternalLink className="size-4" aria-hidden />
            Googleマップで経路を開く
          </a>
        )}

        <div className="flex flex-col gap-2">
          <span className="type-label-small px-1 text-on-surface-variant">交通手段</span>
          <div className="flex flex-wrap gap-2">
            {TRAVEL_MODES.map((option) => (
              <Button
                key={option}
                type="button"
                variant={option === mode ? "secondary" : "outline"}
                size="sm"
                className={cn(
                  "rounded-full",
                  option === mode && "bg-travel-container text-on-travel-container",
                )}
                onClick={() => editMode(option)}
              >
                {TRAVEL_MODE_LABELS[option]}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-2">
          <DateTimeInput
            id="travel-depart"
            dateLabel="出発日"
            timeLabel="出発時刻"
            value={departAt}
            onChange={editDepartAt}
          />
          <DateTimeInput
            id="travel-arrive"
            dateLabel="到着日"
            timeLabel="到着時刻"
            value={arriveAt}
            onChange={editArriveAt}
          />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full"
              disabled={!departAt || knownMinutes === null}
              onClick={() => calculateFrom("depart")}
            >
              出発日時から計算
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full"
              disabled={!arriveAt || knownMinutes === null}
              onClick={() => calculateFrom("arrive")}
            >
              到着日時から計算
            </Button>
          </div>
          <p className="type-label-small px-1 text-on-surface-variant">
            {knownMinutes !== null
              ? `所要時間 ${knownMinutes}分${routeMinutes !== null ? "（Googleマップの代表時間）" : ""}。片方の日時を入力して押すと、もう一方を求めます。時刻を直しても反対側は自動では変わりません。`
              : "所要時間が分からないときは、出発・到着の両方を入力してください。"}
          </p>
        </div>

        {/* 公共交通は、入れた発着地と基準側の日時でYahoo!乗換案内を開き、選んだ経路を共有で戻す（issue #1330）。
            実際の列車・発着時刻はYahoo!で選んだ結果を採る。ここで決めるのは検索の条件だけ。 */}
        {/* 予定の前後の移動として、周辺の予定の場所と余裕分から検索条件を提案する（issue #1331）。
            地点は候補から選ぶか欄で直す。提案は検索の基準で、実際の便はYahoo!で選んだものを採る。 */}
        {suggestTarget && mode === "PUBLIC_TRANSIT" && (
          <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
            <span className="type-label-small text-on-surface-variant">「{suggestTarget.title}」の</span>
            <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="予定の前後どちらの移動か">
              {(["BEFORE_EVENT", "AFTER_EVENT"] as const).map((option) => (
                <Button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={purpose === option}
                  variant={purpose === option ? "secondary" : "outline"}
                  size="sm"
                  className="rounded-full"
                  onClick={() => choosePurpose(option)}
                >
                  {option === "BEFORE_EVENT" ? "予定前（行き）" : "予定後（帰り・次へ）"}
                </Button>
              ))}
            </div>
            {purpose && (
              <Input
                id="travel-search-margin"
                label={purpose === "BEFORE_EVENT" ? "予定の何分前に着くか（分）" : "予定の終了から何分後に出るか（分）"}
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_TRAVEL_SEARCH_MARGIN_MINUTES}
                value={marginText}
                onChange={(e) => changeMargin(e.target.value)}
              />
            )}
            {purpose && marginMinutes === null && (
              <p className="type-body-small text-destructive">0〜{MAX_TRAVEL_SEARCH_MARGIN_MINUTES}分で入力してください。</p>
            )}
            {suggestion?.at && (
              <p className="type-body-small text-on-surface-variant">
                {purpose === "BEFORE_EVENT"
                  ? `おすすめの検索: ${formatClock(suggestion.at)} 到着（開始 ${formatClock(suggestTarget.start)} の${marginMinutes}分前）`
                  : `おすすめの検索: ${formatClock(suggestion.at)} 出発（終了 ${formatClock(suggestTarget.end)}${marginMinutes ? ` の${marginMinutes}分後` : ""}）`}
              </p>
            )}
            {suggestion?.nextEvent && (
              <p className="type-body-small text-on-surface-variant">
                次の予定「{suggestion.nextEvent.title}」は {formatClock(suggestion.nextEvent.start)} 開始です。
              </p>
            )}
            {suggestion && suggestion.candidates.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="type-label-small text-on-surface-variant">
                  {purpose === "BEFORE_EVENT" ? "出発地の候補" : "目的地の候補"}
                </span>
                <ul className="flex flex-col gap-1">
                  {suggestion.candidates.map((candidate) => {
                    const selected = (purpose === "BEFORE_EVENT" ? origin : destination).trim() === candidate.text;
                    return (
                      <li key={candidate.text}>
                        <button
                          type="button"
                          aria-pressed={selected}
                          onClick={() => chooseCandidate(candidate.text)}
                          className={`flex w-full min-w-0 flex-col rounded-lg border px-3 py-1.5 text-left ${selected ? "border-primary bg-primary/10" : "border-outline-variant"}`}
                        >
                          <span className="type-label-large truncate">{placeDisplayName(candidate.text)}</span>
                          <span className="type-body-small text-on-surface-variant">{candidate.reason}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {transitContext === "loading" && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
                <LoaderCircle className="size-4 animate-spin" />
                前後の予定を確かめています…
              </p>
            )}
            {transitContext === "error" && (
              <p className="text-xs text-muted-foreground" role="status">
                前後の予定を読めなかったため、自宅だけを候補にしています。地点を確かめてください。
              </p>
            )}
            {loadedContext?.partial && (
              <p className="text-xs text-muted-foreground">一部のカレンダーを読めなかったため、候補が欠けていることがあります。</p>
            )}
            {suggestion?.notes.map((note) => (
              <p key={note} className="type-body-small text-on-surface-variant">
                {note}
              </p>
            ))}
            {routeWarnings.map((warning) => (
              <p key={warning} className="flex items-start gap-1.5 type-body-small text-destructive" role="alert">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                {warning}
              </p>
            ))}
          </div>
        )}

        {transitCondition && (
          <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
            <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Yahoo!乗換案内で探す基準">
              {(["depart", "arrive"] as const).map((side) => (
                <Button
                  key={side}
                  type="button"
                  role="radio"
                  aria-checked={basis === side}
                  variant={basis === side ? "secondary" : "outline"}
                  size="sm"
                  className="rounded-full"
                  onClick={() => chooseTransitBasis(side)}
                >
                  {side === "depart" ? "出発時刻で探す" : "到着時刻で探す"}
                </Button>
              ))}
            </div>
            {transitCondition.ok ? (
              <p className="type-body-small text-on-surface-variant">
                検索条件: {transitConditionSummary(transitCondition)}
                {via.length > 0 && "（経由地はYahoo!へ渡しません）"}
              </p>
            ) : (
              <p className="type-body-small text-on-surface-variant" role="status">
                Yahoo!乗換案内で探すには、{transitCondition.missing.join("・")}を入力してください。
              </p>
            )}
            {nativeTransit ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                disabled={!transitLinks?.app}
                onClick={() => void searchInYahooApp()}
              >
                <ExternalLink />
                Yahoo!乗換案内で検索
              </Button>
            ) : (
              transitLinks && (
                <div className="flex flex-wrap gap-2">
                  {/* 素の <a>。アプリ未導入の端末でブラウザが警告を出すため、Web版を自動では試さず並べて選ばせる */}
                  {transitLinks.app && (
                    <a
                      href={transitLinks.app}
                      className="type-label-large hidden items-center gap-1.5 rounded-full border border-outline-variant px-3 py-1.5 text-on-surface pointer-coarse:inline-flex"
                    >
                      <ExternalLink className="size-4" aria-hidden />
                      アプリで検索
                    </a>
                  )}
                  <a
                    href={transitLinks.web}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="type-label-large inline-flex items-center gap-1.5 rounded-full border border-outline-variant px-3 py-1.5 text-on-surface"
                  >
                    <ExternalLink className="size-4" aria-hidden />
                    Yahoo!乗換案内（Web版）で検索
                  </a>
                </div>
              )
            )}
            {nativeTransit && (
              <p className="text-xs text-muted-foreground" role={transitStatus ? "status" : undefined}>
                {transitStatus === "failed"
                  ? "Yahoo!乗換案内を開けませんでした。"
                  : `${transitStatus === "web" ? "アプリを開けなかったため、Web版で開きました。" : ""}経路を選んで共有ボタンからYoteiFlowを選び、「…に反映」を押すと、この入力へ戻ります（30分以内）。戻した経路は確かめてから保存してください。`}
              </p>
            )}
          </div>
        )}

        {/* Googleマップの共有URLは、現在選んでいる交通手段によらず貼り付けられる。
            読めた交通手段へ切り替えるため、公共交通から車の経路を貼る場合も入口を隠さない。 */}
        <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
          <Textarea
            id="travel-google-route-url"
            label="Googleマップの経路URL"
            rows={2}
            placeholder="共有した経路URLを貼り付ける"
            value={googleRouteUrl}
            disabled={offline}
            onChange={(e) => changeGoogleRouteUrl(e.target.value)}
            onPaste={(event) => {
              const value = event.clipboardData.getData("text").trim();
              if (!value) return;
              event.preventDefault();
              changeGoogleRouteUrl(value);
              void importGoogleMapsRoute(value);
            }}
            onClear={() => changeGoogleRouteUrl("")}
          />
          {googleRouteStatus.kind === "idle" && (
            <p className="text-xs text-muted-foreground">Googleマップの経路URLを貼り付けると、出発地・目的地・交通手段を入力欄へ反映し、所要時間はGoogleマップの予測を再取得して反映します。</p>
          )}
          {googleRouteStatus.kind === "analyzing" && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status" aria-live="polite">
              <LoaderCircle className="size-4 animate-spin" />
              Googleマップの経路を読み取っています…
            </p>
          )}
          {googleRouteStatus.kind === "success" && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status" aria-live="polite">
              <CheckCircle2 className="size-4 text-travel" />
              {googleRouteStatus.message}
            </p>
          )}
          {routeCandidates && (
            <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="経路候補">
              <p className="text-xs text-muted-foreground">
                {selectedRoute === null
                  ? "使う経路を1つ選んでください。選んだ経路の代表時間で出発・到着時刻を求めます（予測幅は参考です）。"
                  : "経路を変えると、代表時間から時刻を求め直します。"}
              </p>
              {routeCandidates.map((candidate, index) => {
                const selected = selectedRoute === index;
                const range =
                  candidate.startAt && candidate.endAt
                    ? `${isoToLocalInput(candidate.startAt, timeZone).slice(11)}〜${isoToLocalInput(candidate.endAt, timeZone).slice(11)}`
                    : null;
                return (
                  <button
                    key={`${candidate.name}-${index}`}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => selectRouteCandidate(routeCandidates, index)}
                    className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm ${selected ? "border-primary bg-primary/10" : "border-outline-variant"}`}
                  >
                    <span aria-hidden className={`mt-1 size-3.5 shrink-0 rounded-full border-2 ${selected ? "border-primary bg-primary" : "border-outline"}`} />
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium">
                        {[candidate.name || `候補${index + 1}`, candidate.distanceText].filter(Boolean).join(" / ")}
                      </span>
                      <span>
                        {candidate.representativeText ? `代表時間 ${candidate.representativeText}` : "代表時間は未取得（時刻は手入力）"}
                        {range ? `（${range}）` : ""}
                      </span>
                      {candidate.rangeText && <span className="text-xs text-muted-foreground">参考: 予測幅 {candidate.rangeText}</span>}
                    </span>
                  </button>
                );
              })}
              <Button type="button" variant="ghost" size="xs" className="self-start" onClick={() => setRouteCandidates(null)}>
                手入力で続ける
              </Button>
            </div>
          )}
          {googleRouteStatus.kind === "error" && (
            <div className="flex items-center gap-2 text-xs text-destructive" role="alert">
              <CircleAlert className="size-4 shrink-0" />
              <span>{googleRouteStatus.message}</span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="ml-auto"
                disabled={offline || !googleRouteUrl.trim()}
                onClick={() => void importGoogleMapsRoute(googleRouteUrl)}
              >
                <RefreshCw />
                再試行
              </Button>
            </div>
          )}
        </div>

        {draft.notice && <p className="px-4 text-sm text-on-surface-variant">{draft.notice}</p>}

        <Textarea
          id="travel-note"
          label="メモ"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onClear={() => setNote("")}
        />

        {/* 通知設定（issue #1112）。出発時刻の何分前に知らせるかを、予定と同じダイアログで選ぶ。 */}
        <div className="flex flex-wrap items-center gap-2 px-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={notification?.enabled ? "bg-primary-container text-on-primary-container" : undefined}
            onClick={() => setEditingNotification(true)}
          >
            {notification?.enabled ? <Bell className="size-4" /> : <BellOff className="size-4" />}
            {eventNotificationSummary(notification)}
          </Button>
          <span className="type-label-small text-on-surface-variant">出発時刻を基準に知らせます</span>
        </div>

        {editingNotification && (
          <EventNotificationDialog
            title={origin && destination ? travelTitle({ origin, via, destination }) : "この移動"}
            initial={notification}
            onCancel={() => setEditingNotification(false)}
            onSaved={(next) => {
              setEditingNotification(false);
              setNotification(next);
            }}
          />
        )}

        {inputError && <p className="text-sm text-destructive">{inputError}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {exportNotice && <p className="text-sm text-on-surface-variant">{exportNotice.message}</p>}
      </div>

      {/* 書き出しの報せを出している間は、閉じる以外にすることが無い（移動そのものは保存済み）。 */}
      {exportNotice ? (
        <ItemFormActions saveLabel="閉じる" onSave={() => onSaved(exportNotice.touched)} />
      ) : (
        <ItemFormActions
          saveDisabled={busy || offline || inputError !== null}
          onSave={save}
          onDelete={editing ? () => setConfirmingDelete(true) : undefined}
          deleteDisabled={busy || offline}
        />
      )}
    </>
  );
}

/** Googleへ書き出せなかった理由。移動そのものは保存できているため、断りではなく報せとして出す。 */
function exportWarning(exports: { status: string; reason?: string }[]): string | null {
  if (exports.some((result) => result.status === "failed")) {
    return "移動は保存しましたが、Googleカレンダーへ書き出せませんでした。もう一度保存すると書き出しをやり直します。";
  }
  if (exports.some((result) => result.reason === "write_disabled")) {
    return "移動は保存しましたが、書き出し先のカレンダーが使用しない設定のため、Googleカレンダーには出ません。設定 ▸ 移動 で書き出し先を確認してください。";
  }
  if (exports.some((result) => result.reason === "no_calendar")) {
    return "移動は保存しましたが、書き出し先のカレンダーが無いためGoogleカレンダーには出ません。設定 ▸ Google Calendar でカレンダーを接続してください。";
  }
  return null;
}

/** 編集用の初期値。ISO 8601 を入力欄の形式へ直す。 */
export function toTravelDraft(travel: TravelItem, timeZone: string): TravelDraft {
  return {
    travel,
    origin: travel.origin,
    destination: travel.destination,
    via: travel.via,
    mode: travel.mode,
    departAt: isoToLocalInput(travel.start, timeZone),
    arriveAt: isoToLocalInput(travel.end, timeZone),
    note: travel.note ?? "",
  };
}
