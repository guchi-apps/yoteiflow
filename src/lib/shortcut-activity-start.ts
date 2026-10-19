/**
 * iOSのコントロール（#1281）から記録を始める要求の読み取りと判定。
 * DBやNotionを触らない純粋関数にして、`node --test` で確かめられるようにしている。
 */

/** 項目IDの上限。cuid（25文字）より十分長く、任意の長文は受けない */
const PRESET_ID_MAX_LENGTH = 64;

/** 本文の `presetId` を取り出す。文字列でない・空・長すぎるときは null */
export function parseStartPresetId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const { presetId } = body as { presetId?: unknown };
  if (typeof presetId !== "string") return null;
  const trimmed = presetId.trim();
  if (trimmed.length === 0 || trimmed.length > PRESET_ID_MAX_LENGTH) return null;
  return trimmed;
}

/**
 * 選んだ項目をすでに記録中なら何もしない（"not_changed"）。
 * コントロールの表示が古いまま押されたとき、同じ項目を止めて始め直すと、
 * 記録が細切れの予定に分かれてしまうため。別の項目を記録中なら切り替える（記録画面と同じ扱い）。
 */
export function decideControlStart(
  runningTitle: string | null,
  presetName: string,
): "start" | "not_changed" {
  return runningTitle === presetName ? "not_changed" : "start";
}
