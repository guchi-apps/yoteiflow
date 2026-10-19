import { isApnsConfigured } from "@/lib/apns/config";
import {
  isApnsEnvironment,
  sendLiveActivity,
  type ApnsEnvironment,
  type ApnsResult,
} from "@/lib/apns/send";
import {
  buildLiveActivityPayload,
  planLiveActivity,
  planTokenRegistration,
  type LiveActivityChange,
  type LiveActivityContentState,
} from "@/lib/live-activity/payload";
import { db } from "@/lib/db";
import { getRunningActivity } from "@/services/activity/running";

/**
 * 記録の開始・切り替え・停止・開始時刻の修正を、iOSアプリのライブアクティビティへ伝える（issue #971）。
 *
 * 呼び出し元（記録を変える全ての経路）から同じこの1関数を呼ぶ。サービス（running.ts）の中に
 * 置かないのは、`startActivity()` が内部で停止を呼ぶため、そこへ置くと切り替えで end と start が
 * 別々に飛ぶため。ベストエフォートで、失敗しても記録そのものは成功のまま（例外を投げない）。
 */
export async function notifyLiveActivity(
  userId: string,
  change: LiveActivityChange,
): Promise<void> {
  try {
    if (!isApnsConfigured()) return;

    const tokenRows = await db.liveActivityToken.findMany({ where: { userId } });
    const plan = planLiveActivity(change, tokenRows.length > 0);
    const running = change.type === "stopped" ? null : change.running;
    const payload = buildLiveActivityPayload(plan, running, Math.floor(Date.now() / 1000));

    const targets =
      plan === "start"
        ? await db.liveActivityDevice.findMany({ where: { userId } })
        : tokenRows;

    await Promise.all(
      targets
        .filter((target) => isApnsEnvironment(target.environment))
        .map(async (target) => {
          const result: ApnsResult = await sendLiveActivity(
            { token: target.token, environment: target.environment as "sandbox" | "production" },
            payload,
          );
          if (result.status === "gone") {
            // 失効（終了済みのアクティビティなど）は消す。次の記録ではpush-to-startで始まる。
            await (plan === "start"
              ? db.liveActivityDevice.deleteMany({ where: { id: target.id } })
              : db.liveActivityToken.deleteMany({ where: { id: target.id } })
            ).catch(() => null);
          } else if (result.status === "failed") {
            console.error("[dayspan] live activity push failed:", result.reason);
          }
        }),
    );

    // 終わったアクティビティのトークンはもう使えない。残すと次の記録でupdateの宛先になり得る。
    // 消すのは end を送ったものだけにする。送っている間に登録されたトークンまで消すと、その端末へは
    // end が届かないまま宛先が無くなる（登録側は記録中でないことを見て自分で end を送る・issue #1280）。
    if (change.type === "stopped" && tokenRows.length > 0) {
      await db.liveActivityToken
        .deleteMany({ where: { id: { in: tokenRows.map((row) => row.id) } } })
        .catch(() => null);
    }
  } catch (error) {
    console.error("[dayspan] live activity notify failed:", error);
  }
}

/**
 * 登録されたばかりのactivity push tokenのアクティビティを、今の記録に合わせる（issue #1280）。
 *
 * push-to-start で裏起動された端末は、トークンの登録が停止より遅れることがある。停止の end は
 * その時点で登録済みのトークンにしか送られないため、登録の時点で記録中でなければここで end を送り、
 * トークンは残さない。別の記録を表示していれば update で合わせる。ベストエフォート（例外を投げない）。
 */
export async function syncRegisteredLiveActivityToken(
  userId: string,
  target: { token: string; environment: ApnsEnvironment },
  shown: LiveActivityContentState | null,
): Promise<void> {
  try {
    if (!isApnsConfigured()) return;

    const running = await getRunningActivity(userId);
    const plan = planTokenRegistration(running, shown);
    if (plan === "keep") return;

    const payload = buildLiveActivityPayload(plan, running, Math.floor(Date.now() / 1000));
    const result = await sendLiveActivity(target, payload);
    if (result.status === "failed") {
      console.error("[dayspan] live activity push failed:", result.reason);
    }
    if (plan === "end" || result.status === "gone") {
      await db.liveActivityToken
        .deleteMany({ where: { token: target.token.toLowerCase() } })
        .catch(() => null);
    }
  } catch (error) {
    console.error("[dayspan] live activity token sync failed:", error);
  }
}
