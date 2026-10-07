/**
 * 睡眠モード連動（issue #1109・#1167）の状態を、設定画面に出す日本語へ直す。
 *
 * 元データはiOSアプリが App Group に残す最後の呼び出しと、停止専用トークンの準備状態
 * （`SleepFocusDiagnostics`）。トークンそのものは含まれない。
 */

export type SleepFocusOutcome = "running" | "succeeded" | "noToken" | "network" | "httpError";

export type SleepFocusLast = {
  at: string;
  mode: "start" | "stop";
  outcome: SleepFocusOutcome;
  httpStatus: number | null;
  attempts: number;
};

export type SleepFocusStatus = {
  /** 停止専用トークンがKeychainにあるか。 */
  hasToken: boolean;
  /** 本体が最後にトークンを取得・保存した結果。未試行は null。 */
  credential: "saved" | "fetchFailed" | "keychainFailed" | null;
  last: SleepFocusLast | null;
};

const OUTCOMES: SleepFocusOutcome[] = ["running", "succeeded", "noToken", "network", "httpError"];

/** アプリからの返事を扱える形へ寄せる。想定外の形は「呼び出しなし」として扱う。 */
export function parseSleepFocusStatus(value: unknown): SleepFocusStatus {
  const record = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const credential =
    record.credential === "saved" || record.credential === "fetchFailed" || record.credential === "keychainFailed"
      ? record.credential
      : null;

  let last: SleepFocusLast | null = null;
  const raw = record.last as Record<string, unknown> | undefined;
  if (
    raw &&
    typeof raw.at === "string" &&
    (raw.mode === "start" || raw.mode === "stop") &&
    OUTCOMES.includes(raw.outcome as SleepFocusOutcome)
  ) {
    last = {
      at: raw.at,
      mode: raw.mode,
      outcome: raw.outcome as SleepFocusOutcome,
      httpStatus: typeof raw.httpStatus === "number" ? raw.httpStatus : null,
      attempts: typeof raw.attempts === "number" ? raw.attempts : 0,
    };
  }
  return { hasToken: record.hasToken === true, credential, last };
}

/** 最後の呼び出しの結果。成功は ok、それ以外は原因と復旧方法を添える。 */
export function describeSleepFocusLast(last: SleepFocusLast): { ok: boolean; text: string } {
  const action = last.mode === "start" ? "記録の開始" : "記録の停止";
  switch (last.outcome) {
    case "succeeded":
      return { ok: true, text: `${action}に成功しました。` };
    case "running":
      return {
        ok: false,
        text: `${action}の処理が完了していません。通信が途中で切れた可能性があります。記録の画面で状態を確認してください。`,
      };
    case "noToken":
      return {
        ok: false,
        text: `${action}に失敗しました（認証情報がありません）。YoteiFlowのアプリを開き、ログインした状態で数秒待ってからもう一度お試しください。`,
      };
    case "network":
      return {
        ok: false,
        text: `${action}に失敗しました（通信できませんでした）。通信状況を確認してください。次の切り替えで改めて送ります。`,
      };
    case "httpError": {
      const status = last.httpStatus;
      const hint =
        status === 401
          ? "認証が無効です。アプリを開き直すか、いったんログアウトして再ログインしてください。"
          : "しばらくしてから睡眠モードを切り替えるか、記録の画面から操作してください。";
      return { ok: false, text: `${action}に失敗しました（サーバーの応答 ${status ?? "不明"}）。${hint}` };
    }
  }
}

/** 認証情報の準備状態。問題が無いときは null。 */
export function describeSleepFocusCredential(status: SleepFocusStatus): string | null {
  if (status.credential === "keychainFailed") {
    return "認証情報を端末へ保存できませんでした。アプリを開き直してください。直らないときは再ログインしてください。";
  }
  if (status.credential === "fetchFailed" && !status.hasToken) {
    return "認証情報を取得できていません。ログインした状態でアプリを開き、通信できる場所でしばらく待ってください。";
  }
  if (!status.hasToken) {
    return "認証情報がまだ準備できていません。ログインした状態でアプリを一度開いてください。";
  }
  return null;
}
