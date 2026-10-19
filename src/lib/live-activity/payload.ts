/**
 * ライブアクティビティ（iOSアプリ・issue #971）へ送るAPNsの本文と、送り分けの判定。
 *
 * このファイルは他のモジュールを読み込まない（`node --test` で単体に動かすため）。
 */

/** Swift側の `RecordingActivityAttributes`（ios/Shared/ActivityAttributes.swift）の型名と揃える。 */
export const LIVE_ACTIVITY_ATTRIBUTES_TYPE = "RecordingActivityAttributes";

/**
 * ContentState。時刻は **Unix秒の数値** で持つ。
 * ActivityKit は既定の JSONDecoder で復号するため、Date をISO文字列で送ると復号に失敗して
 * 更新が無視され、Unix秒を Date として読ませると31年ずれる。Swift側は
 * `Date(timeIntervalSince1970:)` に直す。
 */
export type LiveActivityContentState = {
  title: string;
  startedAtEpoch: number;
};

export type LiveActivityRunning = { title: string; startedAt: string };

export function toContentState(running: LiveActivityRunning): LiveActivityContentState {
  return {
    title: running.title,
    startedAtEpoch: new Date(running.startedAt).getTime() / 1000,
  };
}

/** 記録に起きた変化。呼び出し元が分かっていることだけを渡す。 */
export type LiveActivityChange =
  | { type: "started"; running: LiveActivityRunning; switched: boolean }
  | { type: "updated"; running: LiveActivityRunning }
  | { type: "stopped" };

export type LiveActivityPlan = "start" | "update" | "end";

/**
 * どの種類を送るか。
 *
 * 切り替え（前の記録を止めて次を始めた）は、既存のアクティビティへ `update` を1通だけ送る。
 * end と start を別々に送るとAPNsは順序を保証しないため、表示が消えたり新旧が並んだりする。
 * 更新先（activity token）が1つも無いときは、更新できないので push-to-start に落とす。
 */
export function planLiveActivity(
  change: LiveActivityChange,
  hasActivityTokens: boolean,
): LiveActivityPlan {
  if (change.type === "stopped") return "end";
  if (change.type === "updated") return hasActivityTokens ? "update" : "start";
  if (change.switched && hasActivityTokens) return "update";
  return "start";
}

export function buildLiveActivityPayload(
  plan: LiveActivityPlan,
  running: LiveActivityRunning | null,
  nowSeconds: number,
): object {
  const state: LiveActivityContentState = running
    ? toContentState(running)
    : { title: "", startedAtEpoch: nowSeconds };

  if (plan === "start") {
    return {
      aps: {
        timestamp: nowSeconds,
        event: "start",
        "content-state": state,
        "attributes-type": LIVE_ACTIVITY_ATTRIBUTES_TYPE,
        attributes: {},
        // start では alert が要る（ロック画面に出す文面）
        alert: { title: "記録中", body: state.title },
      },
    };
  }

  if (plan === "update") {
    return { aps: { timestamp: nowSeconds, event: "update", "content-state": state } };
  }

  // 終了。すぐに消す（dismissal-date が過去・現在ならロック画面から即座に外れる）
  return {
    aps: {
      timestamp: nowSeconds,
      event: "end",
      "content-state": state,
      "dismissal-date": nowSeconds,
    },
  };
}

export type LiveActivityTokenPlan = "keep" | "end" | "update";

/**
 * アプリがactivity push tokenを登録してきたとき、そのアクティビティへすぐ送るものを決める（issue #1280）。
 *
 * 停止の end は「その時点で登録済みのトークン」にしか届かない。push-to-start で裏起動された端末は
 * トークンの登録が停止より遅れることがあり、そのままだと停止後も表示が残る。登録の時点で記録中で
 * なければ end を、別の記録を表示していれば update を送って合わせる。
 * `shown` は端末が表示している内容（古いアプリは添えないため null。そのときは記録中なら触らない）。
 */
export function planTokenRegistration(
  running: LiveActivityRunning | null,
  shown: LiveActivityContentState | null,
): LiveActivityTokenPlan {
  if (!running) return "end";
  if (!shown) return "keep";
  const current = toContentState(running);
  // 端末側の Double とサーバーの値で端数が揺れうるため、秒未満の差は同じとみなす
  const sameStart = Math.abs(current.startedAtEpoch - shown.startedAtEpoch) < 1;
  return sameStart && current.title === shown.title ? "keep" : "update";
}
