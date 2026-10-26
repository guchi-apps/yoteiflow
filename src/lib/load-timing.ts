/**
 * カレンダーの取得にかかった時間を取得元ごとに測る（issue #1431）。
 *
 * 「反映が遅い」が Notion・Google・DaySpanのDB・回線のどれによるのかを、本番で
 * 切り分けられるようにするためのもの。サーバー側の内訳は `Server-Timing` ヘッダーと
 * サーバーログへ出す。ブラウザの開発者ツールでは、応答全体の待ち時間とこの内訳の差が
 * 回線（とService Worker）で使った時間になる。
 *
 * 外部I/Oを持たない純粋なロジックに閉じ、`load-timing.test.mts` で確かめる。
 */

export type LoadSpan = { name: string; ms: number };

export type LoadTimer = {
  /** 渡したPromiseが終わるまで（成功・失敗とも）の時間を `name` で記録する。 */
  time<T>(name: string, task: Promise<T>): Promise<T>;
  /** 記録した区間を記録した順に返す。 */
  spans(): LoadSpan[];
  /** 作ってからの経過時間。 */
  elapsed(): number;
};

/** この時間を超えた取得はサーバーログへ内訳を残す（毎回出すとログが埋まるため）。 */
export const SLOW_LOAD_LOG_MS = 1500;

export function createLoadTimer(now: () => number = () => performance.now()): LoadTimer {
  const startedAt = now();
  const recorded: LoadSpan[] = [];

  return {
    time(name, task) {
      const begin = now();
      const record = () => {
        recorded.push({ name, ms: now() - begin });
      };
      return task.then(
        (value) => {
          record();
          return value;
        },
        (error: unknown) => {
          record();
          throw error;
        },
      );
    },
    spans: () => [...recorded],
    elapsed: () => now() - startedAt,
  };
}

// Server-Timing の metric 名は token（RFC 7230）でなければならない。
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** `Server-Timing` ヘッダーの値を組み立てる（例: `google;dur=412, notion;dur=2380`）。 */
export function serverTimingHeader(spans: LoadSpan[], totalMs?: number): string {
  const entries = spans
    .filter((span) => TOKEN.test(span.name))
    .map((span) => `${span.name};dur=${Math.round(span.ms)}`);
  if (totalMs !== undefined) entries.push(`total;dur=${Math.round(totalMs)}`);
  return entries.join(", ");
}

/** ログ1行ぶんの内訳（遅い順）。例: `total=2410ms notion=2380ms notion-tasks=2290ms google=412ms` */
export function formatLoadSpans(spans: LoadSpan[], totalMs: number): string {
  const parts = [...spans]
    .sort((a, b) => b.ms - a.ms)
    .map((span) => `${span.name}=${Math.round(span.ms)}ms`);
  return [`total=${Math.round(totalMs)}ms`, ...parts].join(" ");
}
