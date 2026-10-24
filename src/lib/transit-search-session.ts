/**
 * 移動の入力から「Yahoo!乗換案内で検索」を押したときの下書きを、共有で戻ってくるまで端末に覚えておく
 * （issue #1330・docs/spec.md §29）。
 *
 * Yahoo!アプリへ出ている間にWebViewの入力ダイアログは閉じうる。戻ってきた共有をどの下書き
 * （新規の入力・既存の移動の編集）へ反映するかを決めるため、押した時点のフォームの値をIDと一緒に置く。
 * 共有拡張にはIDと表示名だけをApp Group経由で渡し（`ios/Shared/TransitSearchSession.swift`）、
 * 拡張が `session=<ID>` を付けて本体へ戻す。値の本体はこの端末のlocalStorageから引く。
 *
 * サーバーに持たないのは、#1301 の置き換え待ち（`travel-replace-pending.ts`）と同じく、判断が
 * 端末の操作の流れに閉じているため（DBに持つとマイグレーションが要る）。30分で失効させ、
 * 別の日の共有を黙ってこの下書きへの反映に化けさせない。保持するのは直近の1件だけ。
 */

import type { EventNotificationOverride, TravelItem, TravelMode, TravelSearchPurpose } from "@/types/calendar";

const STORAGE_KEY = "dayspan_transit_search_session";
export const TRANSIT_SEARCH_SESSION_TTL_MS = 30 * 60 * 1000;
const SESSION_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** 押した時点のフォームの値（`TravelDraft` の保存できる部分）。 */
export type TransitSearchDraft = {
  /** 編集中の移動。あれば戻ったあとも同じ移動の更新（PATCH）になる。 */
  travel?: TravelItem;
  origin: string;
  destination: string;
  via?: string[];
  mode: TravelMode;
  departAt: string;
  arriveAt: string;
  note?: string;
  linkedEvent?: {
    id: string;
    calendarId: string;
    startAt: string;
    endAt: string;
    title?: string;
    location?: string | null;
  } | null;
  notification?: EventNotificationOverride | null;
  /** 予定の前後として探した意図と余裕分（issue #1331）。戻ってきた確認画面で注意を出すのに使う */
  searchPurpose?: TravelSearchPurpose | null;
  searchMarginMinutes?: number | null;
  defaultArriveMargin?: number;
  home?: string | null;
};

export type TransitSearchSession = {
  id: string;
  /** 共有拡張のボタンに出す名前（「梅田→本社」）。 */
  label: string;
  draft: TransitSearchDraft;
  expiresAt: number;
};

export function isTransitSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID.test(value);
}

/** 保存した値から、まだ有効でIDが一致するものだけを返す（純粋関数・テスト用）。 */
export function matchTransitSession(raw: string | null, id: string, now: number): TransitSearchSession | null {
  if (!raw || !isTransitSessionId(id)) return null;
  try {
    const value = JSON.parse(raw) as Partial<TransitSearchSession>;
    if (
      value.id !== id ||
      typeof value.expiresAt !== "number" ||
      value.expiresAt <= now ||
      typeof value.label !== "string" ||
      !value.draft ||
      typeof value.draft.origin !== "string" ||
      typeof value.draft.destination !== "string" ||
      typeof value.draft.departAt !== "string" ||
      typeof value.draft.arriveAt !== "string"
    ) {
      return null;
    }
    return value as TransitSearchSession;
  } catch {
    return null;
  }
}

function newSessionId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

/** 下書きを覚え、作ったセッションを返す。保存できない端末でも返す（戻ったときに見つからないだけ）。 */
export function rememberTransitSession(
  label: string,
  draft: TransitSearchDraft,
  now = Date.now(),
): TransitSearchSession {
  const session: TransitSearchSession = { id: newSessionId(), label, draft, expiresAt: now + TRANSIT_SEARCH_SESSION_TTL_MS };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // プライベートブラウズ等。戻ったときは「下書きが見つからない」として従来の流れへ倒れる。
  }
  return session;
}

/** 共有で戻ってきたIDが一致したときだけ取り出し、取り出したら消す（同じ共有で2回反映しない）。 */
export function takeTransitSession(id: string, now = Date.now()): TransitSearchSession | null {
  try {
    const matched = matchTransitSession(localStorage.getItem(STORAGE_KEY), id, now);
    if (matched) localStorage.removeItem(STORAGE_KEY);
    return matched;
  } catch {
    return null;
  }
}

/** 共有拡張から戻った経路（発着時刻は設定タイムゾーンの入力欄の形式 `YYYY-MM-DDTHH:mm`）。 */
export type SharedTransitRoute = {
  origin: string;
  destination: string;
  departAt: string;
  arriveAt: string;
  /** 経路の詳細（共有拡張のpreviewの `detail`）。無ければ空文字。 */
  note: string;
};

/**
 * 覚えていた下書きへ、共有で戻った経路を重ねた入力の初期値（純粋関数・テスト用）。
 *
 * - 発着地・発着時刻は選んだ経路で置き換える（貼り付けは選んだ経路という強い意思表示・issue #498 と同じ扱い）
 * - 日付も共有の日時を採る。検索はこの下書きの日時で開いているため通常は同じ日で、日付をまたぐ便
 *   （終電）も正しく残る。違う日だったときだけ報せる（Yahoo!側で日付を変えて選んだとき）
 * - メモは元のメモを残し、経路の詳細を後ろへ足す（編集中の移動のメモを失わない）
 * - 編集中の移動・紐づく予定・通知の選択はそのまま（保存は利用者が確かめてから行う）
 */
export function applySharedRoute(
  session: TransitSearchSession,
  route: SharedTransitRoute,
): TransitSearchDraft & { notice: string; adoptCheck: boolean } {
  const { draft } = session;
  const previousNote = (draft.note ?? "").trim();
  const routeNote = route.note.trim();
  const note = !routeNote || previousNote.includes(routeNote) ? previousNote : [previousNote, routeNote].filter(Boolean).join("\n\n");
  const searchedDate = (draft.arriveAt || draft.departAt).slice(0, 10);
  const dateDiffers = searchedDate !== "" && route.arriveAt.slice(0, 10) !== searchedDate && route.departAt.slice(0, 10) !== searchedDate;
  const notice = [
    draft.travel
      ? `選んだ経路で移動「${draft.travel.title}」を更新します。確かめてから保存してください。`
      : "選んだ経路を入力しました。確かめてから保存してください。",
    dateDiffers ? "検索したときの日付と違う日の経路です。日付を確かめてください。" : null,
  ]
    .filter(Boolean)
    .join("");
  return {
    ...draft,
    mode: "PUBLIC_TRANSIT",
    origin: route.origin,
    destination: route.destination,
    departAt: route.departAt,
    arriveAt: route.arriveAt,
    note,
    notice,
    // 元の移動を更新するときは、保存の前に予定の今の状態と紐づけを確かめる（issue #1332）
    adoptCheck: Boolean(draft.travel && draft.linkedEvent),
  };
}

/** 入力画面で保存したとき。待っている下書きは用済みなので消す（あとの共有を古い下書きへ反映させない）。 */
export function clearTransitSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 消せない端末では30分で失効するのを待つ
  }
}
