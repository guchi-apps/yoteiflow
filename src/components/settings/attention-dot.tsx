/**
 * 「操作が必要」を示す丸印。色だけに意味を持たせないよう、読み上げ用の文字を添える（issue #1171）。
 */
export function AttentionDot({ label = "操作が必要" }: { label?: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="inline-block size-2 shrink-0 rounded-full bg-error"
    />
  );
}
