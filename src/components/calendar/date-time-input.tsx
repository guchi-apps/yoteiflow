"use client";

import { DateTimePickerField } from "./date-time-picker";

/**
 * 日付と時刻を1つの押せる欄で受け取り、中央のモーダル（カレンダー＋時刻ホイール）で選ばせる。
 * 返す値は `YYYY-MM-DDTHH:mm`。時刻なしを許すのは `allowNoTime` の欄だけで、その場合のみ
 * `YYYY-MM-DD` を返す（issue #1527。旧: 日付欄と時刻欄を別々の入力にしていた）。
 */
export function DateTimeInput({
  id,
  label,
  value,
  onChange,
  allowNoTime,
  defaultTime,
}: {
  id: string;
  label: string;
  /** `YYYY-MM-DDTHH:mm`（時刻なしを許す欄は `YYYY-MM-DD` も可）。未入力は空文字。 */
  value: string;
  onChange: (value: string) => void;
  allowNoTime?: boolean;
  /** 時刻が無いとき最初に提示する時刻（HH:mm）。 */
  defaultTime?: string;
}) {
  return (
    <DateTimePickerField
      id={id}
      label={label}
      value={value}
      onChange={onChange}
      allowNoTime={allowNoTime}
      defaultTime={defaultTime}
    />
  );
}
