/**
 * カレンダーの簡易入力（`QuickEventSheet`）からタスクを作るときの冪等キーと、失敗の読み分け（issue #1316）。
 *
 * 簡易入力はシートを開いた時点で作成IDを1つ決め、同じシートでの保存の再試行には同じIDを
 * `clientId` として送る。`POST /api/tasks` は `clientId` があると `runCreateOperation()`
 * （オフラインキューの作成・内部タスクAPIと同じ冪等処理）を通すため、Notionへの作成が済んだあとに
 * 応答だけ失われても、もう一度保存したときに2件目は作られず、作成済みのIDが返る。
 */

/** シートを開いたときに1つ決める作成ID。`POST /api/tasks` の `clientId` の形（印字可能ASCII・150字以内）に収まる。 */
export function newQuickTaskClientId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export type QuickTaskFailure = {
  message: string;
  /**
   * 前回の保存が届いたかどうか分からず、同じIDでは作れない（確かめてもらう）状態か。
   * true のときだけ「新しいタスクとして作り直す」（IDを作り直す）を出す。自動では作り直さない。
   */
  needsConfirmation: boolean;
};

/** `POST /api/tasks`（`clientId` 付き）の失敗応答を、画面に出す文言と次の操作へ読み分ける。 */
export function classifyQuickTaskFailure(
  status: number,
  body: { message?: string; error?: string; reconciliationRequired?: boolean } | null,
  fallback: string,
): QuickTaskFailure {
  // 作成を始めたが結果が分からないまま止まった記録。同じIDで再送しても作らず同じ答えになる。
  if (body?.reconciliationRequired) {
    return {
      message: "タスクが作成済みか確認できませんでした。タスク一覧で確かめてから、必要なら作り直してください。",
      needsConfirmation: true,
    };
  }
  // 前回の保存が受け付けられたあとに内容を変えて保存した。前回の分が作られている可能性がある。
  if (status === 409 && body?.error === "idempotency_key_reused") {
    return {
      message:
        "前回の保存が届いている可能性があるため、内容を変えて保存し直せませんでした。タスク一覧で確かめてから、必要なら作り直してください。",
      needsConfirmation: true,
    };
  }
  // 同じ保存がまだ処理中。同じIDのまま待って押し直せば二重にならない。
  if (status === 409 && body?.error === "operation_in_progress") {
    return { message: "保存を処理しています。少し待ってからもう一度保存してください。", needsConfirmation: false };
  }
  return { message: body?.message ?? body?.error ?? fallback, needsConfirmation: false };
}
