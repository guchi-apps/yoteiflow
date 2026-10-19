import { resolveActivityStopUserId, shortcutJson } from "@/app/api/shortcuts/shared";
import { listActivityPresets } from "@/services/activity/presets";

/**
 * 記録の項目の一覧を返す（issue #1281）。iOSのコントロールが、オフで押されたときに
 * どの項目で始めるかを選ばせるために読む。DBだけで、Google・Notionへの往復は無い。
 */
export async function GET(request: Request) {
  const auth = await resolveActivityStopUserId(request);
  if (!auth.ok) return auth.response;

  const presets = await listActivityPresets(auth.userId);
  return shortcutJson({
    ok: true,
    presets: presets.map((preset) => ({ id: preset.id, name: preset.name, icon: preset.icon })),
    message: presets.length > 0 ? `${presets.length}件の項目があります。` : "記録の項目がありません。",
  });
}
