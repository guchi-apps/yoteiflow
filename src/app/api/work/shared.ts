import { NextResponse } from "next/server";

import { parseWorkOverride } from "@/lib/work-sync/override";
import type { WorkRecordOverride } from "@/lib/work-sync/plan";
import type { WorkWriteInput } from "@/services/notion/work-logs";
import { getWorkAutoSettings } from "@/services/work-sync/settings";
import { validateOverrideForRecord } from "@/services/work-sync/sync";
import type { WorkRecordItem } from "@/types/work";

/** リクエスト本文のうち、Notionへ書かない「勤務予定・移動の反映の指定」。 */
export type WorkRequestBody = WorkWriteInput & { workSync?: unknown };

/**
 * 本文から `workSync` を取り出して検証する（issue #1099）。指定が無ければ `override` は undefined
 * （既存の指定・既定をそのまま使う）。不正なら400の応答を返す。
 */
export function splitWorkSync(
  body: WorkRequestBody,
): { input: WorkWriteInput; override?: WorkRecordOverride; error?: NextResponse } {
  const { workSync, ...input } = body;
  if (workSync === undefined) return { input };
  const parsed = parseWorkOverride(workSync);
  if (!parsed.ok) {
    return {
      input,
      error: NextResponse.json({ error: "invalid_work_sync", message: parsed.message }, { status: 400 }),
    };
  }
  return { input, override: parsed.override };
}

/**
 * 保存前に、指定で反映ONの項目に必要な時間が揃っているかを確かめる。Notionへ書く前に断るのは、
 * 勤務記録だけ保存されて指定が通らない食い違いを作らないため。自動生成がオフなら確かめない。
 */
export async function checkWorkSync(
  userId: string,
  base: WorkRecordItem | null,
  input: WorkWriteInput,
  override: WorkRecordOverride,
): Promise<NextResponse | null> {
  if (!(await getWorkAutoSettings(userId)).enabled) return null;
  const startDate = input.startDate ?? base?.startDate;
  if (!startDate) return null;
  const record: WorkRecordItem = {
    id: base?.id ?? "pending",
    title: input.title ?? base?.title ?? "",
    startDate,
    endDate: input.endDate ?? (input.startDate ? input.startDate : (base?.endDate ?? startDate)),
    place: input.place !== undefined ? input.place : (base?.place ?? null),
    annualLeave: input.annualLeave !== undefined ? input.annualLeave : (base?.annualLeave ?? null),
    businessTrip: input.businessTrip ?? base?.businessTrip ?? false,
    companyHoliday: input.companyHoliday ?? base?.companyHoliday ?? false,
    preApplied: false,
    postRegistered: false,
    memo: null,
    url: null,
  };
  const message = await validateOverrideForRecord(userId, record, override);
  return message
    ? NextResponse.json({ error: "work_sync_incomplete", message }, { status: 400 })
    : null;
}

/**
 * 勤務記録の入力の検証（docs/spec.md §34）。
 *
 * 画面でも同じ条件で止めているが、DaySpanのAPIや将来のMCPから直接呼ばれた要求は画面を通らない。
 * 作成と更新のどちらの経路でも同じ条件で断る。
 */

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function validateWorkBody(
  body: WorkWriteInput,
  { requireStartDate }: { requireStartDate: boolean },
): NextResponse | null {
  if (requireStartDate && !body.startDate) {
    return NextResponse.json({ error: "startDate is required" }, { status: 400 });
  }
  if (body.startDate !== undefined && !DATE_KEY.test(body.startDate)) {
    return NextResponse.json({ error: "startDate must be YYYY-MM-DD" }, { status: 400 });
  }
  if (body.endDate != null && !DATE_KEY.test(body.endDate)) {
    return NextResponse.json({ error: "endDate must be YYYY-MM-DD" }, { status: 400 });
  }
  if (body.startDate && body.endDate && body.endDate < body.startDate) {
    return NextResponse.json(
      { error: "invalid_range", message: "終了日は開始日より後にしてください。" },
      { status: 400 },
    );
  }
  // 日付を動かすときは、開始日も一緒に送ってもらう。終了日だけを受けると、
  // 重なりの判定に使う期間がサーバー側で決まらない。
  if (body.endDate !== undefined && body.startDate === undefined) {
    return NextResponse.json(
      { error: "startDate is required", message: "期間を変えるときは開始日も送ってください。" },
      { status: 400 },
    );
  }
  // 出張・年休・会社休業日は同じ日に立てられない。月の集計でどれに数えるかが決まらないため。
  // 画面では択一にして選べないようにしているが、隠すだけだとAPIや将来のMCPから直接
  // 呼ばれた要求が素通りする。
  const kinds = [
    body.businessTrip ? "出張" : null,
    body.annualLeave ? "年休" : null,
    body.companyHoliday ? "休み" : null,
  ].filter((kind): kind is string => kind !== null);
  if (kinds.length > 1) {
    return NextResponse.json(
      {
        error: "conflicting_kind",
        message: `${kinds.join("と")}は同じ記録には登録できません。どれかにしてください。`,
      },
      { status: 400 },
    );
  }
  return null;
}

/**
 * その日にすでに別の記録がある（1日1件）ときの応答。
 * 応答は毎回作る（NextResponseの本文はストリームで、使い回すと2回目が空になる）。
 */
export const dateTaken = () =>
  NextResponse.json(
    {
      error: "date_taken",
      // 期間で作る記録（出張・全休の年休・会社休業日）でも読める言い方にする。「その日」だと、
      // お盆の休業のように何日もある期間のどこが重なっているのかが伝わらない。
      message:
        "すでに別の勤務記録がある日が含まれています。その日の記録を直してから登録してください。",
    },
    { status: 409 },
  );

/** 勤務記録DB以外のページへの書き込みは、経路によらず断る。 */
export const notEditable = () =>
  NextResponse.json(
    { error: "not_editable", message: "この項目はYoteiFlowからは変更できません。" },
    { status: 403 },
  );
