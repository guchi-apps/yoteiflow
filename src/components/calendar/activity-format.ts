/**
 * 記録を始めてからの長さ。
 *

 * 既定では秒は出さない。記録の刻みは分（Google Calendarの予定として保存する単位）で、
 * 秒まで動かすと、目に入るたびに数字が変わって画面がざわつくため。
 */
export function formatElapsed(startIso: string, nowIso: string, withSeconds = false): string {
  if (withSeconds) {
    // 記録の画面の大きな経過時間だけ秒まで出す（issue #1124）。保存する単位は分のまま。
    const total = Math.max(
      0,
      Math.floor((new Date(nowIso).getTime() - new Date(startIso).getTime()) / 1000),
    );
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    if (h > 0) return `${h}時間${m}分${sec}秒`;
    if (m > 0) return `${m}分${sec}秒`;
    return `${sec}秒`;
  }

  const minutes = Math.max(
    0,
    Math.floor((new Date(nowIso).getTime() - new Date(startIso).getTime()) / 60_000),
  );

  if (minutes < 60) return `${minutes}分`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}時間` : `${hours}時間${rest}分`;
}
