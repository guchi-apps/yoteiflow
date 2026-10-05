/**
 * 外部アプリの共有から取り込む内容の共通モデル（issue #1083・docs/spec.md §29）。
 *
 * Yahoo!乗換案内・Googleマップ固有の解析は `yahoo.ts`・`google-maps.ts` が行い、
 * この形へ変換して確認画面（iOS共有拡張・Web）へ渡す。表示と登録はこの形だけを見る。
 */

import type { TravelMode } from "@/types/calendar";

export type ShareImportSource = "yahoo_transit" | "google_maps";
export type ShareImportType = "place" | "route";

export type SharedImport = {
  source: ShareImportSource;
  type: ShareImportType;
  /** ヘッダーに出す文言（「Yahoo!乗換案内から経路を追加」など） */
  heading: string;
  /** 場所は場所名、経路は「出発地 → 到着地」 */
  title: string;
  origin: string | null;
  destination: string | null;
  address: string | null;
  coordinates: { lat: number; lng: number } | null;
  /** ISO 8601。Googleマップの経路は日時を持たないことが多く、そのときは null */
  startAt: string | null;
  endAt: string | null;
  durationMinutes: number | null;
  /** 取得できたときだけ（円） */
  fare: number | null;
  mode: TravelMode | null;
  sourceUrl: string | null;
  /** 折りたたんで出す経路の詳細（生テキスト） */
  detail: string | null;
  /** 所要時間がAIの見積もりか（Googleマップ経路）。画面に「（目安）」を出す */
  estimated: boolean;
  /** 直接登録できるか。日時の無い経路は false で、アプリの移動入力へ引き継ぐ */
  registrable: boolean;
};

export type ShareImportFailure = {
  ok: false;
  status: number;
  error: string;
  message: string;
};

export type ShareImportResult = { ok: true; item: SharedImport } | ShareImportFailure;

export const SHARE_IMPORT_HEADINGS = {
  yahooRoute: "Yahoo!乗換案内から経路を追加",
  googlePlace: "Googleマップから場所を追加",
  googleRoute: "Googleマップから経路を追加",
} as const;
