/**
 * 処理済みの共有の引き継ぎ（`/calendar?newTravel=1&…`）を端末に覚える（issue #1779）。
 *
 * iOSアプリはWebの描画プロセスが落ちたとき・通信エラーの再試行で、共有から開いたときのURLを
 * そのまま読み直す。画面は `history.replaceState` でクエリを外しているが、ネイティブ側の記録には
 * 届かない。覚えておかないと、使い切った下書き（`session`）をもう一度探して
 * 「検索したときの入力が見つかりませんでした」を出したり、同じ入力画面を開き直したりする。
 *
 * 覚えるのは内容ではなく共有の操作（issue #1784）。共有拡張は操作ごとに一意の `op` を付けるため、
 * 同じ場所・経路を共有し直しても別の操作として扱い、同じURLの読み直しだけを捨てる。
 * `op` を付けない配布済みの共有拡張からの引き継ぎは、検索ごとに一意の `session` があるものだけを覚える。
 * どちらも無いものは操作を見分けられないため覚えない（利用者が始めた新しい共有を捨てない）。
 *
 * 判定はWeb側のこの記録だけで行う。ネイティブ側でクエリを外すと、画面が処理する前の再読み込みで
 * 未処理の共有を失うため（計画レビュー）。
 */
export const HANDLED_HANDOFF_STORAGE_KEY = "yoteiflow:handled-handoffs";
/** 覚えておく期間 */
export const HANDLED_HANDOFF_TTL_MS = 24 * 60 * 60_000;
export const HANDLED_HANDOFF_MAX = 20;

export type HandledHandoff = { key: string; at: number };

/**
 * 共有の操作を表すキー。`op`（共有拡張が操作ごとに付ける）、無ければ旧い拡張の `session`。
 * どちらも無ければ null（覚えない）。出発地・住所・経路メモなどの内容は端末に残さないため、キーに含めない。
 */
export function handoffKey(search: string): string | null {
  const params = new URLSearchParams(search);
  const op = params.get("op");
  if (op) return `op=${op}`;
  const session = params.get("session");
  return session ? `session=${session}` : null;
}

/** 保存値を読み、期限切れ・壊れた項目を落とす */
export function parseHandled(raw: string | null, now: number): HandledHandoff[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is HandledHandoff =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as HandledHandoff).key === "string" &&
        typeof (item as HandledHandoff).at === "number" &&
        now - (item as HandledHandoff).at < HANDLED_HANDOFF_TTL_MS &&
        (item as HandledHandoff).at <= now,
    );
  } catch {
    return [];
  }
}

export function isHandled(list: HandledHandoff[], key: string): boolean {
  return list.some((item) => item.key === key);
}

/** 記録を足す。同じキーは新しい時刻へ置き換え、古いものから上限を超えたぶんを捨てる */
export function addHandled(list: HandledHandoff[], key: string, now: number): HandledHandoff[] {
  return [...list.filter((item) => item.key !== key), { key, at: now }].slice(-HANDLED_HANDOFF_MAX);
}

/** この端末ですでに処理した引き継ぎか。読めないとき（プライベートモード等）は未処理として扱う */
export function wasHandoffHandled(search: string, now = Date.now()): boolean {
  const key = handoffKey(search);
  if (!key) return false;
  try {
    return isHandled(parseHandled(window.localStorage.getItem(HANDLED_HANDOFF_STORAGE_KEY), now), key);
  } catch {
    return false;
  }
}

/** 処理した引き継ぎを覚える。書けなくても処理は続ける（従来どおりの動き） */
export function rememberHandledHandoff(search: string, now = Date.now()): void {
  const key = handoffKey(search);
  if (!key) return;
  try {
    const list = parseHandled(window.localStorage.getItem(HANDLED_HANDOFF_STORAGE_KEY), now);
    window.localStorage.setItem(HANDLED_HANDOFF_STORAGE_KEY, JSON.stringify(addHandled(list, key, now)));
  } catch {
    // 保存できない端末では従来どおり
  }
}
