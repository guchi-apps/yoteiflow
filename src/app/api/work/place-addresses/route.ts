import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { getNotionPlaceConnection } from "@/services/calendar/write-context";
import { listPlaces } from "@/services/notion/places";
import { getWorkAutoSettings } from "@/services/work-sync/settings";

/**
 * 勤務の入力ダイアログで、選んだ勤務場所に住所が登録されているかを示すための材料（issue #1319）。
 *
 * ダイアログを開いたときにだけ読む（`/work` のレンダーに含めると、月送り・保存後の再取得の
 * たびにNotionへの往復が増える。出張の行き先候補と同じ扱い）。場所DBが未設定なら
 * `ready: false` を返し、画面は何も出さない。取得の失敗は空にせずエラーで返す
 * （空にすると、登録済みの場所まで「未登録」と出てしまう）。
 */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [connection, settings] = await Promise.all([
    getNotionPlaceConnection(userId),
    getWorkAutoSettings(userId),
  ]);
  const base = { remotePlaces: settings.remotePlaces, homeOrigin: settings.homeOrigin };
  if (!connection) return NextResponse.json({ ready: false, places: [], ...base });

  try {
    return NextResponse.json({ ready: true, places: await listPlaces(connection), ...base });
  } catch (error) {
    return externalApiError("notion", "場所の取得", error);
  }
}
