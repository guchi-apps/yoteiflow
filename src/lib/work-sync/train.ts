import type { WorkTrainItem } from "@/lib/work-sync/plan";
import { parseYahooTransitRoute } from "@/lib/yahoo-transit-route";

/**
 * 「よく使う電車」（`WorkTrain`・issue #1347）の入力検証と表示用の計算。DBにも外部APIにも触らない。
 */

export type TrainInput = Omit<WorkTrainItem, "id">;

export type TrainParse = { ok: true; train: TrainInput } | { ok: false; message: string };

const MAX_DURATION = 1440;
const MAX_NOTE = 4000;

/** 出発・到着の時刻（0時からの分）から所要分を求める。到着が出発以前なら翌日の到着とみなす。 */
export function trainDuration(departMinutes: number, arriveMinutes: number): number {
  const diff = arriveMinutes - departMinutes;
  return diff > 0 ? diff : diff + 1440;
}

export function parseTrainInput(raw: unknown): TrainParse {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "電車の指定が正しくありません。" };
  }
  const body = raw as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const origin = text(body.origin);
  const destination = text(body.destination);
  const label = text(body.label);
  if (!origin || !destination) return { ok: false, message: "出発地と行き先を入力してください。" };
  if (origin === destination) return { ok: false, message: "出発地と行き先が同じです。" };
  if (origin.length > 191 || destination.length > 191) {
    return { ok: false, message: "出発地・行き先が長すぎます。" };
  }
  if (!label) return { ok: false, message: "電車の名前を入力してください。" };
  if (label.length > 191) return { ok: false, message: "電車の名前が長すぎます。" };

  const depart = body.departMinutes;
  if (typeof depart !== "number" || !Number.isInteger(depart) || depart < 0 || depart > 1439) {
    return { ok: false, message: "出発時刻が正しくありません。" };
  }
  const duration = body.durationMinutes;
  if (
    typeof duration !== "number" ||
    !Number.isInteger(duration) ||
    duration < 1 ||
    duration > MAX_DURATION
  ) {
    return { ok: false, message: "所要時間は1〜1440分で入力してください。" };
  }
  const noteText = typeof body.note === "string" ? body.note.trim() : "";
  if (noteText.length > MAX_NOTE) {
    return { ok: false, message: `詳細は${MAX_NOTE}文字までです。` };
  }
  return {
    ok: true,
    train: {
      origin,
      destination,
      label,
      departMinutes: depart,
      durationMinutes: duration,
      isDefault: body.isDefault === true,
      note: noteText || null,
    },
  };
}

export type TrainFromText = {
  label: string;
  departMinutes: number;
  durationMinutes: number;
  note: string;
};

/**
 * Yahoo!乗換案内の「共有 ▸ コピー」の文字列から、電車の登録値を作る（issue #1371）。
 * 結果ページは取得せず、貼り付けられた文字列だけを読む。詳細は案内文を除いた全文。
 * 名前は最初に乗る路線の行（`↓ ＪＲ琵琶湖線 姫路行`）。読めなければ空で、呼び出し側が入力させる。
 */
export function trainFromYahooText(text: string): TrainFromText | null {
  const route = parseYahooTransitRoute(text);
  if (!route) return null;
  const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const departMinutes = toMinutes(route.departTime);
  const label =
    route.noteText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("↓"))
      .map((line) => line.replace(/^↓\s*/, ""))
      .find((line) => line !== "" && !/^\d{1,2}:\d{2}/.test(line) && !/番線|号車/.test(line)) ?? "";
  return {
    label,
    departMinutes,
    durationMinutes: trainDuration(departMinutes, toMinutes(route.arriveTime)),
    note: route.noteText,
  };
}

/** 往路・復路の初期選択に使うデフォルトの電車。複数あっても出発時刻順の先頭に固定する。 */
export function defaultTrain(trains: WorkTrainItem[]): WorkTrainItem | null {
  return (
    trains
      .filter((train) => train.isDefault)
      .sort((a, b) => a.departMinutes - b.departMinutes)[0] ?? null
  );
}

/**
 * 往路の電車が勤務開始に間に合うか。到着（出発 + 所要）が勤務開始より後なら間に合わない。
 * 戻り値は遅れる分（間に合うなら null）。
 */
export function lateByForOutbound(train: WorkTrainItem, workStartMinutes: number): number | null {
  const arrive = train.departMinutes + train.durationMinutes;
  return arrive > workStartMinutes ? arrive - workStartMinutes : null;
}

/** 復路の電車が勤務終了より前に出るか。出発が勤務終了より前なら早すぎる。戻り値は早い分。 */
export function earlyByForReturn(train: WorkTrainItem, workEndMinutes: number): number | null {
  return train.departMinutes < workEndMinutes ? workEndMinutes - train.departMinutes : null;
}
