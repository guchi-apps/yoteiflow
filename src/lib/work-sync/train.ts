import type { WorkTrainItem } from "@/lib/work-sync/plan";
import { parseYahooTransitRoute, readYahooRouteEndpoints, readYahooRouteStops } from "@/lib/yahoo-transit-route";

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

/** 取り込みで経路の詳細の末尾に付く「電車の発着 … ／ 徒歩 …を含む」行（`yahoo-transit-import.ts`）。 */
const WALK_NOTE_LINE = /\n*電車の発着 [^\n]+ ／ 徒歩 [^\n]+を含む\s*$/;

/**
 * Yahoo!乗換案内の共有で戻った経路の詳細から、電車の登録値を作る（issue #1716）。
 *
 * 共有で戻る発着時刻（`departAt`/`arriveAt`）はサーバー・勤務場所の徒歩を足した値なので使わない。
 * 電車の発着は経路の詳細の本文から読み、徒歩の注記行は詳細から外す（徒歩は勤務先の「徒歩（前後の合計）」で別に足す）。
 */
export function trainFromSharedRoute(detail: string): TrainFromText | null {
  return trainFromYahooText(detail.replace(WALK_NOTE_LINE, "").trim());
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

export type CommuteTravelSource = {
  /** ISO 8601 */
  start: string;
  end: string;
  title: string;
  routeDetail: string | null;
  note: string | null;
};

/** 日付をまたいでも使える、設定タイムゾーンの0時からの分。 */
function minutesOfDay(iso: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/**
 * 勤務に紐づく移動の詳細から「よく使う電車」を登録する値を作る（issue #1701）。
 * 出発地・行き先は移動の文字列（`名前 住所`）ではなく、勤務同期のキー（生の場所名）を呼び出し側が渡す。
 * 名前は経路の最初に乗る路線の行、読めなければ「出発駅 → 到着駅」、それも無ければ移動の見出し。
 */
export function trainFromTravel(
  travel: CommuteTravelSource,
  keys: { origin: string; destination: string },
  timeZone: string,
): TrainInput | null {
  const detail = (travel.routeDetail || travel.note || "").trim();
  const departMinutes = minutesOfDay(travel.start, timeZone);
  const duration = Math.round((new Date(travel.end).getTime() - new Date(travel.start).getTime()) / 60_000);
  if (!Number.isFinite(duration) || duration < 1 || duration > MAX_DURATION) return null;
  const line = detail
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter((row) => row.startsWith("↓"))
    .map((row) => row.replace(/^↓\s*/, ""))
    .find((row) => row !== "" && !/^\d{1,2}:\d{2}/.test(row) && !/番線|号車/.test(row));
  const stations = readYahooRouteEndpoints(detail);
  const label =
    line ?? (stations.origin && stations.destination ? `${stations.origin} → ${stations.destination}` : travel.title);
  return {
    origin: keys.origin,
    destination: keys.destination,
    label: label.slice(0, 191),
    departMinutes,
    durationMinutes: duration,
    isDefault: false,
    note: detail && readYahooRouteStops(detail).length > 0 ? detail.slice(0, MAX_NOTE) : null,
  };
}
