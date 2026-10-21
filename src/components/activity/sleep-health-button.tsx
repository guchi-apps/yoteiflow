"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { HeartPulse } from "lucide-react";

import { isoToLocalInput } from "@/components/calendar/datetime-fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  hasNativeHealth,
  importLabel,
  importNativeHealth,
  nativeHealthImportSummary,
  nativeHealthSummary,
  permissionLabel,
  statusNativeHealth,
  syncNativeHealth,
  type NativeHealthRange,
  type NativeHealthStatus,
} from "@/lib/native-health";
import { cn } from "@/lib/utils";

type LastRun = {
  /** 画面に出す一文。 */
  message: string;
  /** 実行した時刻（ISO）。 */
  at: string;
  /** 利用者が手を打つ必要がある結果か（失敗・未許可・ヘルスケアに古い時間帯が残っている）。 */
  attention: boolean;
};

/** アプリのブリッジの有無。サーバーの描画では false にし、マウント後に実際の値へ切り替える。 */
function useNativeHealthAvailable(): boolean {
  return useSyncExternalStore(
    () => () => {},
    hasNativeHealth,
    () => false,
  );
}

function formatRange({ start, end }: NativeHealthRange, timeZone: string): string {
  const startLabel = isoToLocalInput(start, timeZone);
  return `${startLabel.slice(5, 10).replace("-", "/")} ${startLabel.slice(11)}〜${isoToLocalInput(end, timeZone).slice(11)}`;
}

function formatAt(iso: string, timeZone: string): string {
  const label = isoToLocalInput(iso, timeZone);
  return `${label.slice(5, 10).replace("-", "/")} ${label.slice(11)}`;
}

/**
 * 睡眠画面のヘッダー右上に置く、ヘルスケア連携のアイコン（issue #1302・docs/spec.md §40）。
 *
 * 以前は本文の先頭に送信の帯を出していたが、毎回開くたびに送るだけの経過を画面の上部で見せる
 * 理由が無く、グラフが下へ押し出されていた。経過はアイコンの回転と赤い点に寄せ、中身はシートで読む。
 * iOSアプリの中だけ出し（ブラウザ・ホーム画面のWebアプリはHealthKitに触れない）、開いたとき
 * 1回だけ自動で送るのは帯のときと同じ。
 */
export function SleepHealthButton({
  title,
  timeZone,
  exportedLabel,
}: {
  /** 睡眠の項目名（設定 ▸ 活動記録）。 */
  title: string;
  /** 利用者のタイムゾーン。ヘルスケアに残る古い時間帯・実行時刻を出すために使う。 */
  timeZone: string;
  /** 最後にヘルスケアへ送り終えた睡眠の終わり。設定タイムゾーンで整形済み。未送信なら null。 */
  exportedLabel: string | null;
}) {
  const router = useRouter();
  const available = useNativeHealthAvailable();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [last, setLast] = useState<LastRun | null>(null);
  const [staleLeft, setStaleLeft] = useState<NativeHealthRange[]>([]);
  const [status, setStatus] = useState<NativeHealthStatus | null>(null);
  const started = useRef(false);

  async function readStatus() {
    try {
      setStatus(await statusNativeHealth());
    } catch {
      // 状態が読めなくても送る・取り込むは試せる。表示は「確認中…」のまま残す。
    }
  }

  async function run(kind: "export" | "import") {
    setBusy(kind);
    const at = new Date().toISOString();
    try {
      if (kind === "export") {
        const result = await syncNativeHealth();
        setLast({
          message: nativeHealthSummary(result, title),
          at,
          attention:
            result.error !== null ||
            result.permission === "denied" ||
            result.permission === "unavailable" ||
            result.staleLeft.length > 0,
        });
        setStaleLeft(result.staleLeft);
        // 「最後に送った」はサーバーの印から描いている。送れたときだけ取り直す
        // （0件で取り直すと、開くたびにGoogleへの往復が1回増える・§20）。
        if (result.sent > 0 || result.removed > 0) router.refresh();
      } else {
        const result = await importNativeHealth();
        setLast({
          message: nativeHealthImportSummary(result, title),
          at,
          attention: result.error !== null || result.importPermission === "unavailable",
        });
        // 取り込んだ睡眠を夜の一覧へ出す。
        if (result.imported > 0) router.refresh();
      }
    } catch (error) {
      setLast({
        message: error instanceof Error ? error.message : "ヘルスケアと連携できませんでした。",
        at,
        attention: true,
      });
      if (kind === "export") setStaleLeft([]);
    } finally {
      setBusy(null);
    }
    void readStatus();
  }

  useEffect(() => {
    if (!available || started.current) return;
    started.current = true;
    void run("export");
    // 開いたとき1回だけ（run は毎回作り直されるが、中身は同じ）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available]);

  if (!available) return null;

  const attention = busy === null && last?.attention === true;
  const label = busy
    ? `ヘルスケア連携：${busy === "export" ? "送信中" : "取り込み中"}`
    : attention
      ? "ヘルスケア連携：要対応"
      : "ヘルスケア連携";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="icon"
        className="relative size-10 md:size-9"
        aria-label={label}
        aria-busy={busy !== null}
        onClick={() => {
          setOpen(true);
          void readStatus();
        }}
      >
        <HeartPulse aria-hidden className={cn("size-5", busy && "text-primary")} />
        {busy && (
          // 再取得ボタン（`RefreshSpinIcon`）と同じく、動いていることを印そのものの回転で示す。
          <span
            aria-hidden
            className="absolute inset-1 animate-spin rounded-full border-2 border-primary-container border-t-primary motion-reduce:[animation-duration:2.4s]"
          />
        )}
        {attention && (
          <span
            aria-hidden
            className="absolute top-1.5 right-1.5 size-2.5 rounded-full border-2 border-surface-container-low bg-error"
          />
        )}
      </Button>

      <DialogContent position="bottom" className="gap-4 pb-[calc(1.5rem_+_env(safe-area-inset-bottom))]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HeartPulse aria-hidden className="size-5 text-primary" />
            ヘルスケア連携
          </DialogTitle>
          <DialogDescription>
            YoteiFlowの{title}とiPhoneのヘルスケアの睡眠分析をつなぎます。この画面を開いたときは自動で送ります。
          </DialogDescription>
        </DialogHeader>

        <p
          role="status"
          aria-live="polite"
          className={cn(
            "type-body-medium rounded-lg px-3 py-2",
            attention
              ? "bg-error-container text-on-error-container"
              : "bg-secondary-container text-on-secondary-container",
          )}
        >
          {busy === "export"
            ? "ヘルスケアへ送っています…"
            : busy === "import"
              ? "ヘルスケアから取り込んでいます…"
              : last
                ? `${last.message}（${formatAt(last.at, timeZone)}）`
                : "まだ送っていません。"}
        </p>

        <dl className="type-body-medium flex flex-col gap-2">
          <Row label={`${title}の書き込み`} value={permissionLabel(status?.permission)} />
          <Row label={`${title}の読み取り`} value={importLabel(status?.importPermission)} />
          <Row label="最後にヘルスケアへ送った" value={exportedLabel ? `${exportedLabel} まで` : "未送信"} />
        </dl>

        {staleLeft.length > 0 && (
          <p className="type-body-small rounded-lg bg-error-container px-3 py-2 text-on-error-container">
            ヘルスケアには送ったときの時間帯が残っています。睡眠分析から削除してください（
            {staleLeft.map((range) => formatRange(range, timeZone)).join("、")}）。
          </p>
        )}

        <div className="flex flex-col gap-2">
          <Button disabled={busy !== null} onClick={() => void run("export")}>
            {busy === "export" ? "送っています…" : "ヘルスケアへ送る"}
          </Button>
          <Button variant="outline" disabled={busy !== null} onClick={() => void run("import")}>
            {busy === "import" ? "取り込んでいます…" : "ヘルスケアから取り込む"}
          </Button>
          <p className="type-body-small text-on-surface-variant">
            Apple Watchなどで測った{title}を、直近の数日ぶん活動記録として取り込みます。同じ時間帯の
            {title}がすでにあれば追加しません。YoteiFlowから送ったものは取り込みません。
          </p>
        </div>

        <Link href="/settings/health" className="type-label-large self-start text-primary underline-offset-4 hover:underline">
          ヘルスケア連携の設定へ
        </Link>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-on-surface-variant">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
