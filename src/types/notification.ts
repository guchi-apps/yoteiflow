/**
 * 通知の設定（docs/spec.md §32）のうち、画面とサーバーの両方で使う型と選択肢。
 *
 * サービス層（services/notifications/settings.ts）に置くと、設定画面（クライアント
 * コンポーネント）がそこを読んだ時点でPrismaまでブラウザのバンドルへ引き込まれる。
 * 型と定数だけをここへ分ける。
 */

export type NotificationSettings = {
  eventEnabled: boolean;
  eventLeadMinutes: number;
  taskEnabled: boolean;
  /** 時刻の無い期限をまとめて知らせる時刻（設定タイムゾーンでの HH:MM）。 */
  taskDigestTime: string;
  /** 出張・年休の事前申請が未完了のとき、前営業日の16時に会社宛てメールで知らせるか（issue #1552）。 */
  workApplyMailEnabled: boolean;
};

/**
 * 予定の何分前に知らせるか。アカウント既定（NotificationSetting.eventLeadMinutes）の
 * 選択肢で、0は開始時刻ちょうど。予定ごとの上書き（EventNotificationSetting・issue #708）
 * では任意の値（MAX_EVENT_LEAD_MINUTES まで）を指定できるが、この6つはそちらでも
 * よく使う値のチップとして出す（issue #849）。
 */
export const EVENT_LEAD_MINUTES = [0, 5, 10, 15, 30, 60] as const;

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  eventEnabled: true,
  eventLeadMinutes: 10,
  taskEnabled: true,
  taskDigestTime: "08:00",
  workApplyMailEnabled: false,
};

/**
 * 通知の下書きを作る先読みの時間幅（services/notifications/plan.ts）。作り直しの間隔
 * （30分）より十分長く取り、日をまたぐ手前で切れないようにする。
 */
export const PLAN_WINDOW_HOURS = 36;

/**
 * 予定ごとの通知の上書き（EventNotificationSetting）で「何分前」に指定できる上限
 * （issue #849）。PLAN_WINDOW_HOURS（下書きを作る先読みの範囲）を超える値を許すと、
 * その予定が下書き作成の対象になった時点で通知時刻はすでに過去になっており、一度も
 * 送信されない設定を保存できてしまう（黙って失敗する）。作り直し間隔（30分）ぶんの
 * 余裕を持たせ、実際に送信され得る範囲（24時間）に絞る。
 */
export const MAX_EVENT_LEAD_MINUTES = 24 * 60; // 1440
