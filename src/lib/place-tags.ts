/**
 * 場所に付けられるタグ（issue #1361）。
 *
 * 自由に増えると整理しづらいため、新しく付けられるのはこの4つに固定する。
 * 増減はここを直してGitHubから変更する（アプリ画面・APIからは足せない）。
 * 旧タグ（自宅・勤務先など）はNotion側に残っていてよく、読み替えも削除もしない。
 */
export const PLACE_TAGS = ["家", "仕事", "駅・空港", "お気に入り"] as const;

/**
 * 保存しようとしているタグのうち、新しく付けることが許されないものを返す。
 * 固定の4つ、またはその場所に既に付いているタグ（旧タグの据え置き）なら許す。
 */
export function disallowedPlaceTags(next: readonly string[], current: readonly string[]): string[] {
  const allowed = new Set<string>([...PLACE_TAGS, ...current]);
  return next.filter((name) => !allowed.has(name));
}
