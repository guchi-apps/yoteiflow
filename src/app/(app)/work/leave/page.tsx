import Link from "next/link";
import { redirect } from "next/navigation";
import { Briefcase } from "lucide-react";

import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import { AnnualLeaveScreen } from "@/components/work/annual-leave-screen";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { externalApiMessage } from "@/lib/api-error";
import { fiscalYearOf, fiscalYearRange, normalizeStartMonth } from "@/lib/annual-leave";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { createNotionClient } from "@/services/notion/client";
import {
  listAnnualLeaveRecords,
  workCapabilities,
  workDatabaseReady,
} from "@/services/notion/work-logs";
import { normalizeWorkMinutes, type WorkRecordItem } from "@/types/work";
import { SESSION_UNLINKED_LOGIN_PATH } from "@/lib/login-errors";

/**
 * 年度ごとの年休の取得状況（docs/spec.md §34）。
 *
 * 勤務画面（`/work`）の下位画面。あちらが「入れる・申請する」ための画面なのに対し、ここは
 * 「あと何日使えるのか・いまどのくらいのペースか」を見るための画面で、開く理由が違う。
 */
export default async function AnnualLeavePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_UNLINKED_LOGIN_PATH);

  const [connection, uiSetting] = await Promise.all([
    db.notionConnection.findUnique({ where: { userId: user.id } }),
    db.uiSetting.findUnique({
      where: { userId: user.id },
      select: { timeZone: true, fiscalYearStartMonth: true, workMinutesPerDay: true },
    }),
  ]);

  const timeZone = uiSetting?.timeZone ?? "Asia/Tokyo";
  const todayKey = createCalendarDateUtils(timeZone).todayKey();
  const startMonth = normalizeStartMonth(uiSetting?.fiscalYearStartMonth);

  const { year } = await searchParams;
  const requested = Number(year);
  // 年度はURLで決まる。書かれていない・読めない値のときだけ今日の年度にする。
  const fiscalYear =
    Number.isInteger(requested) && requested >= 2000 && requested <= 2100
      ? requested
      : fiscalYearOf(todayKey, startMonth);
  const range = fiscalYearRange(fiscalYear, startMonth);

  if (!connection || !workDatabaseReady(connection)) return <ConnectPrompt />;

  const capabilities = workCapabilities(connection);
  // 年休の列が無いDBでは、そもそも年休を1件も登録できない。数える対象が存在しない画面を
  // 開いても、できることが無い。
  if (!capabilities.annualLeave) return <NoLeavePrompt />;

  const grant = await db.annualLeaveGrant.findUnique({
    where: { userId_fiscalYear: { userId: user.id, fiscalYear } },
  });

  // Notionが失敗しても画面は開く。ここで投げるとNext.jsの汎用のエラー画面へ落ち、
  // 何が起きたのかも年度を送り直せることも画面から分からなくなる（issue #402）。
  let records: WorkRecordItem[] = [];
  let loadError: string | null = null;
  try {
    records = await listAnnualLeaveRecords(createNotionClient(connection), connection, range);
  } catch (error) {
    loadError = `年休の記録を取得できませんでした。${externalApiMessage("notion", "年休の取得", error)}`;
  }

  return (
    <AnnualLeaveScreen
      fiscalYear={fiscalYear}
      startMonth={startMonth}
      todayKey={todayKey}
      records={records}
      grantedDays={grant?.grantedDays ?? null}
      carriedOverDays={grant?.carriedOverDays ?? 0}
      workMinutesPerDay={normalizeWorkMinutes(uiSetting?.workMinutesPerDay)}
      loadError={loadError}
    />
  );
}

/** 勤務記録DBが未設定のとき。勤務画面の同じ面と揃える。 */
function ConnectPrompt() {
  return (
    <Prompt
      title="勤務記録DBが設定されていません"
      description="年休はNotionの勤務記録DBに記録します。設定のNotion画面で勤務記録DBを選ぶか、新しく作成してください。"
      href="/settings/notion"
      label="設定へ"
    />
  );
}

/** 年休のプロパティが揃っていないDBのとき。何を足せばここが使えるのかまで出す。 */
function NoLeavePrompt() {
  return (
    <Prompt
      title="年休のプロパティがありません"
      description="年休を記録するには、勤務記録DBに「年休」（select）と「事前申請」（checkbox）が要ります。設定のNotion画面から追加できます。"
      href="/settings/notion"
      label="設定へ"
    />
  );
}

function Prompt({
  title,
  description,
  href,
  label,
}: {
  title: string;
  description: string;
  href: string;
  label: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center gap-2 text-xl font-semibold">
        <Briefcase className="size-6 text-primary" />
        年休
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button asChild>
            <Link href={href}>{label}</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/work">勤務へ戻る</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
