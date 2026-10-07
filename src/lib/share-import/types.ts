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
  /** ISO 8601。日時が取れなかったとき（Googleマップの日時未指定など）は null */
  startAt: string | null;
  endAt: string | null;
  durationMinutes: number | null;
  /** 取得できたときだけ（円） */
  fare: number | null;
  mode: TravelMode | null;
  sourceUrl: string | null;
  /** 折りたたんで出す経路の詳細（生テキスト） */
  detail: string | null;
  /** 所要時間がAI・Googleの予測など「目安」か。画面に「（目安）」を出す */
  estimated: boolean;
  /** 所要時間の出どころ（登録時の `estimateSource`）。取れなかった・Yahoo!以外の確定値でないときは null */
  estimateSource: "YAHOO" | "AI" | "GOOGLE_MAPS" | null;
  /** Googleマップで指定された基準（出発指定なら開始、到着指定なら終了が固定側）。指定が無ければ null */
  scheduleBasis: "depart" | "arrive" | null;
  /** 経路候補が複数あり共有時の選択を特定できないとき、取得した候補（先頭を選んだものとは扱わない・issue #1160）。無ければ null */
  candidates: ShareRouteCandidate[] | null;
  /** 直接登録できるか。日時の無い経路は false で、アプリの移動入力へ引き継ぐ */
  registrable: boolean;
  /** 不足している項目・推定値である旨など、確認画面に添える案内（issue #1142）。無ければ null */
  notice: string | null;
};

/** 再取得した経路候補1件。開始・終了・所要時間はこの候補だけから求めた値で、別候補の値と混ぜない */
export type ShareRouteCandidate = {
  name: string;
  distanceText: string | null;
  /** 予測の表示（「35 分～1 時間 20 分」など）。無ければ代表時間の表示 */
  durationText: string | null;
  minutes: number | null;
  startAt: string | null;
  endAt: string | null;
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
