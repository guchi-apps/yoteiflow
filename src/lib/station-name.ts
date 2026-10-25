/**
 * 最寄り駅の駅名の扱い（docs/spec.md §29・issue #1356）。
 *
 * 保存と表示は「梅田駅」の形にそろえ、Yahoo!乗換案内へ渡す直前だけ末尾の「駅」を外す。
 * 保存値は変えないので、場所DB・画面表示には影響しない。
 */

/** 末尾が「駅」でなければ「駅」を補う。空・空白だけは null（最寄り駅を消す）。 */
export function ensureStationSuffix(value: string | null | undefined): string | null {
  const station = value?.trim();
  if (!station) return null;
  return station.endsWith("駅") ? station : `${station}駅`;
}

/**
 * Yahoo!乗換案内の検索語にする駅名。末尾が「駅」で、外した残りが1文字以上のときだけ外す。
 * 「駅」だけの値や「駅前」のように末尾が駅でない値は触らない。
 */
export function yahooSearchStationName(station: string): string {
  const value = station.trim();
  if (value.length > 1 && value.endsWith("駅")) return value.slice(0, -1);
  return value;
}
