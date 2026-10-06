"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { HeartPulse } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  hasNativeHealth,
  importNativeHealth,
  nativeHealthImportSummary,
  nativeHealthSummary,
  statusNativeHealth,
  syncNativeHealth,
  type NativeHealthStatus,
} from "@/lib/native-health";

/**
 * ヘルスケア連携の設定（docs/spec.md §40）。
 *
 * 連携そのものはiOSアプリ（HealthKit）が行う。ここでは許可の状態と、最後に送った・取り込んだ
 * 結果を見せ、「いますぐ」実行するボタンを置く。ブリッジ（アプリ）の有無はマウント後に決める
 * （サーバーの描画と食い違うとハイドレーションが一致しない）。ブラウザ・ホーム画面のWebアプリでは
 * HealthKitに触れないため、iOSアプリで使えることだけを案内する。
 */
export function HealthSection({
  title,
  exportedLabel,
}: {
  /** 睡眠の項目名（設定 ▸ 活動記録）。 */
  title: string;
  /** 最後にヘルスケアへ送り終えた睡眠の終わり。設定タイムゾーンで整形済み。未送信なら null。 */
  exportedLabel: string | null;
}) {
  const available = useSyncExternalStore(
    () => () => {},
    hasNativeHealth,
    () => false,
  );
  const [status, setStatus] = useState<NativeHealthStatus | null>(null);
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    statusNativeHealth()
      .then((value) => !cancelled && setStatus(value))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [available]);

  async function run(kind: "export" | "import") {
    setBusy(kind);
    try {
      if (kind === "export") {
        const result = await syncNativeHealth();
        setMessage(nativeHealthSummary(result, title));
      } else {
        const result = await importNativeHealth();
        setMessage(nativeHealthImportSummary(result, title));
      }
      setStatus(await statusNativeHealth());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ヘルスケアと連携できませんでした。");
    } finally {
      setBusy(null);
    }
  }

  if (!available) {
    return (
      <Card>
        <CardContent className="flex items-start gap-3">
          <HeartPulse className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <p className="type-body-medium text-on-surface-variant">
            ヘルスケアとの連携はiOSアプリでのみ利用できます。ブラウザやホーム画面に追加したWebアプリでは、
            iPhoneのヘルスケアに触れないため設定できません。
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-3">
          <h2 className="type-title-medium font-bold">状態</h2>
          <dl className="type-body-medium flex flex-col gap-2">
            <Row label={`${title}の書き込み`} value={permissionLabel(status?.permission)} />
            <Row label={`${title}の読み取り`} value={importLabel(status?.importPermission)} />
            <Row label="最後にヘルスケアへ送った" value={exportedLabel ? `${exportedLabel} まで` : "未送信"} />
          </dl>
          <p className="type-body-small text-on-surface-variant">
            許可は、初めて送る・取り込むときにiPhoneが確認します。あとから変えるときは、iPhoneの
            「設定 ＞ ヘルスケア ＞ データアクセスとデバイス」から行います。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <h2 className="type-title-medium font-bold">YoteiFlow → ヘルスケア</h2>
          <p className="type-body-medium text-on-surface-variant">
            YoteiFlowで付けた{title}をヘルスケアの睡眠分析へ送ります。{title}の画面を開いたときも自動で送ります。
          </p>
          <Button className="self-start" disabled={busy !== null} onClick={() => void run("export")}>
            {busy === "export" ? "送っています…" : "いますぐ送る"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <h2 className="type-title-medium font-bold">ヘルスケア → YoteiFlow</h2>
          <p className="type-body-medium text-on-surface-variant">
            Apple Watchなどで測った{title}を、{title}の活動記録として取り込みます。直近の数日ぶんを読み、
            同じ時間帯の{title}がすでにあれば追加しません。YoteiFlowから送ったものは取り込みません。
          </p>
          <Button
            variant="outline"
            className="self-start"
            disabled={busy !== null}
            onClick={() => void run("import")}
          >
            {busy === "import" ? "取り込んでいます…" : "いま取り込む"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <h2 className="type-title-medium font-bold">睡眠モードと連動</h2>
          <p className="type-body-medium text-on-surface-variant">
            iPhoneの睡眠モードをオンにすると{title}の記録を始め、オフにすると止めます。アラームを止めたときも
            睡眠モードが解除されるため、そこで止まります。
          </p>
          <p className="type-body-small text-on-surface-variant">
            iPhoneの「設定 ＞ 集中モード ＞ 睡眠 ＞ フォーカスフィルタ」でYoteiFlowを追加し、
            「睡眠を記録する」をオンにしてください。止まらなかったときは、記録の画面から止められます。
          </p>
        </CardContent>
      </Card>

      {message && (
        <p
          role="status"
          aria-live="polite"
          className="type-body-medium rounded-lg bg-secondary-container px-3 py-2 text-on-secondary-container"
        >
          {message}
        </p>
      )}
    </>
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

function permissionLabel(value: NativeHealthStatus["permission"] | undefined): string {
  switch (value) {
    case "granted":
      return "許可済み";
    case "denied":
      return "許可されていません";
    case "unavailable":
      return "この端末では使えません";
    case "notDetermined":
      return "未確認（初回の送信時に確認）";
    default:
      return "確認中…";
  }
}

function importLabel(value: NativeHealthStatus["importPermission"] | undefined): string {
  switch (value) {
    case "requested":
      return "確認済み";
    case "unavailable":
      return "この端末では使えません";
    case "notDetermined":
      return "未確認（初回の取り込み時に確認）";
    default:
      return "確認中…";
  }
}
