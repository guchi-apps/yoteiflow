"use client";

import { useOffline } from "next/offline";
import { Bell, BellOff, CheckCircle2, CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { eventNotificationSummary, sameNotificationOverride } from "@/lib/event-notification";
import { cn } from "@/lib/utils";
import { candidateFormTimes, deriveOtherSide, type TimeBasis } from "@/lib/share-import/candidate-times";
import type { ShareRouteCandidate, SharedImport } from "@/lib/share-import/types";
import { placeDisplayName } from "@/lib/place-text";
import { placeTextForCoordinates } from "@/lib/place-by-coordinates";
import { travelTitle } from "@/lib/travel-title";
import type { PlaceCatalog } from "@/services/notion/places";
import {
  TRAVEL_MODES,
  TRAVEL_MODE_LABELS,
  type EventNotificationOverride,
  type TravelEstimateSource,
  type TravelItem,
  type TravelMode,
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
  linkedEvent?: { id: string; calendarId: string; startAt: string; endAt: string } | null;
  /** 入力欄の上に添える案内（共有拡張から紐づけて作るときの日付・メモの断り。issue #1128）。 */
  notice?: string;
  /** 所要時間の出どころの初期値（共有で受けたAIの目安など。issue #1142）。無ければ手入力。 */
  estimateSource?: TravelEstimateSource;
  /** 共有拡張から渡されたGoogleマップのURL。開いた直後に取り込み、候補が複数なら選ばせる（issue #1160）。 */
  resolveUrl?: string;
  /** 共有拡張の確認画面で選んだ経路。再取得した候補のうち名前・距離が一致するものを選択済みにする（issue #1168）。 */
  preselectRoute?: { name: string; distance: string | null };
};

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
  const [basis, setBasis] = useState<TimeBasis>("depart");
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
    editing?.notification ?? null,
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

  const rangeError = (() => {
    if (!departAt || !arriveAt) return "出発時刻と到着時刻を入力してください。";
    return arriveAt <= departAt ? "到着時刻が出発時刻より後になるようにしてください。" : null;
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
    if (side === "depart") setDepartAt(value);
    else setArriveAt(value);
    if (side === basis && routeMinutes !== null) {
      // 基準側を直したときは、取得済みの代表時間で反対側を求め直す（出どころはGoogleのまま）
      const other = deriveOtherSide(basis, value, routeMinutes);
      if (other) {
        if (basis === "depart") setArriveAt(other);
        else setDepartAt(other);
        return;
      }
    }
    // 反対側を直した・代表時間が無いときは手入力の時間帯。Google由来の所要時間と混同しない
    setRouteMinutes(null);
    setEstimateSource("MANUAL");
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
      const departIso = localInputToIso(departAt, timeZone);
      const arriveIso = localInputToIso(arriveAt, timeZone);

      const payload = {
        origin: origin.trim(),
        destination: destination.trim(),
        via,
        mode,
        departAt: departIso,
        arriveAt: arriveIso,
        note: note.trim() || null,
        estimateSource,
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

        <LocationInput
          id="travel-destination"
          label="目的地"
          value={destination}
          onChange={editDestination}
          places={placeCatalog.places}
          eventTitle={destination}
          placeDatabaseReady={placeCatalog.ready}
        />

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

        <div className="flex flex-col gap-2" role="radiogroup" aria-label="時刻の基準">
          <span className="type-label-small px-1 text-on-surface-variant">時刻の基準</span>
          <div className="flex flex-wrap gap-2">
            {(["depart", "arrive"] as const).map((option) => (
              <Button
                key={option}
                type="button"
                role="radio"
                aria-checked={option === basis}
                variant={option === basis ? "secondary" : "outline"}
                size="sm"
                className="rounded-full"
                onClick={() => {
                  touch("basis");
                  setBasis(option);
                }}
              >
                {option === "depart" ? "出発日時を指定" : "到着日時を指定"}
              </Button>
            ))}
          </div>
          <p className="type-label-small px-1 text-on-surface-variant">
            {routeMinutes !== null
              ? `Googleマップの代表時間（${routeMinutes}分）から${basis === "depart" ? "到着" : "出発"}を求めます。反対側を直すと手入力の時間帯になります。`
              : "所要時間を取得できていないときは、出発・到着の両方を入力してください。"}
          </p>
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
