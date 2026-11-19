/**
 * 勤務先の「よく使う電車」をYahoo!乗換案内の共有から取り込む（issue #1716・docs/spec.md §46）。
 *
 * 勤務先の登録画面の公共交通から「Yahoo!乗換案内で調べて取り込む」を押すと、移動の入力と同じ下書きの印
 * （`transit-search-session.ts`・#1330）に `workTrain` を付けて覚え、Yahoo!アプリを開く。共有拡張は
 * いつもどおり `/calendar?…&session=` で本体へ戻すので（Swiftは変えない）、カレンダーの受け口が
 * `workTrain` を見て、取り込んだ電車をここ（端末のlocalStorage）へ置いてから勤務先の登録画面へ移す。
 * 登録画面は開いたときに取り出し、確認枠に出す。自動では保存しない。
 *
 * 30分で失効させ、別の日の取り込みを黙って確認枠に出さない。保持するのは直近の1件だけ。
 */

import type { TrainFromText } from "@/lib/work-sync/train";
import { isAutoOffDay } from "@/lib/work-days";

export type WorkTrainLeg = "out" | "back";

/** 下書きの印に付ける、取り込み先の勤務先と区間。 */
export type WorkTrainTarget = {
  place: string;
  leg: WorkTrainLeg;
  /** 勤務場所の選択肢に無い出張先（詳細画面のURLに `extra=1` が要る） */
  extra?: boolean;
};

export type WorkTrainImport = WorkTrainTarget & {
  train: TrainFromText;
  expiresAt: number;
};

const STORAGE_KEY = "dayspan_work_train_import";
export const WORK_TRAIN_IMPORT_TTL_MS = 30 * 60 * 1000;

function isTrain(value: unknown): value is TrainFromText {
  const train = value as Partial<TrainFromText> | null;
  return (
    !!train &&
    typeof train.label === "string" &&
    typeof train.note === "string" &&
    Number.isInteger(train.departMinutes) &&
    Number.isInteger(train.durationMinutes) &&
    (train.departMinutes as number) >= 0 &&
    (train.departMinutes as number) < 1440 &&
    (train.durationMinutes as number) >= 1 &&
    (train.durationMinutes as number) <= 1440
  );
}

/** 下書きの印に付いた取り込み先を検証して返す（純粋関数・テスト用）。 */
export function parseWorkTrainTarget(value: unknown): WorkTrainTarget | null {
  const target = value as Partial<WorkTrainTarget> | null;
  if (!target || typeof target.place !== "string" || target.place.trim() === "") return null;
  if (target.leg !== "out" && target.leg !== "back") return null;
  return { place: target.place, leg: target.leg, extra: target.extra === true };
}

/** 保存した値から、まだ有効で勤務先が一致するものだけを返す（純粋関数・テスト用）。 */
export function matchWorkTrainImport(
  raw: string | null,
  place: string,
  extra: boolean,
  now: number,
): WorkTrainImport | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<WorkTrainImport>;
    const target = parseWorkTrainTarget(value);
    if (!target || target.place !== place || (target.extra ?? false) !== extra) return null;
    if (typeof value.expiresAt !== "number" || value.expiresAt <= now || !isTrain(value.train)) return null;
    return { ...target, train: value.train, expiresAt: value.expiresAt };
  } catch {
    return null;
  }
}

/** 取り込んだ電車を置く。保存できたか（プライベートブラウズ等では false）を返す。 */
export function rememberWorkTrainImport(target: WorkTrainTarget, train: TrainFromText, now = Date.now()): boolean {
  try {
    const value: WorkTrainImport = { ...target, train, expiresAt: now + WORK_TRAIN_IMPORT_TTL_MS };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** この勤務先の取り込み待ちを取り出して消す（同じ取り込みを2回出さない）。 */
export function takeWorkTrainImport(place: string, extra: boolean, now = Date.now()): WorkTrainImport | null {
  try {
    const matched = matchWorkTrainImport(localStorage.getItem(STORAGE_KEY), place, extra, now);
    if (matched) localStorage.removeItem(STORAGE_KEY);
    return matched;
  } catch {
    return null;
  }
}

/** 取り込み先の勤務先の詳細画面。 */
export function workTrainImportPath(target: WorkTrainTarget): string {
  return `/work/places?place=${encodeURIComponent(target.place)}${target.extra ? "&extra=1" : ""}`;
}

function nextDayKey(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Yahoo!乗換案内で探す日時（入力欄の形式 `YYYY-MM-DDTHH:mm`・純粋関数・テスト用）。
 * 日付は今日の翌日以降で最初の平日（土日祝を除く）。時刻は往路なら勤務開始（到着）、復路なら勤務終了（出発）。
 */
export function workTrainSearchAt(todayKey: string, minutes: number): string {
  let key = nextDayKey(todayKey);
  for (let i = 0; i < 14 && isAutoOffDay(key); i += 1) key = nextDayKey(key);
  const clamped = Math.min(Math.max(Math.round(minutes), 0), 1439);
  const hh = String(Math.floor(clamped / 60)).padStart(2, "0");
  const mm = String(clamped % 60).padStart(2, "0");
  return `${key}T${hh}:${mm}`;
}
