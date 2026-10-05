import assert from "node:assert/strict";
import test from "node:test";

import {
  applyOverride,
  checkForm,
  defaultForm,
  describePlan,
  rebase,
  resolveKey,
  type SyncConfig,
  type SyncField,
} from "@/lib/work-sync/form";

const config: SyncConfig = {
  enabled: true,
  startMinutes: 525,
  endMinutes: 1035,
  lunchStartMinutes: 720,
  lunchEndMinutes: 780,
  remotePlaces: ["在宅"],
  homeOrigin: "自宅",
  defaults: [
    { key: "栗東", isTrip: false, workEnabled: true, startMinutes: 540, endMinutes: 1080, outboundEnabled: true, returnEnabled: true },
    { key: "門真", isTrip: true, workEnabled: true, startMinutes: null, endMinutes: null, outboundEnabled: true, returnEnabled: false },
  ],
  routes: [
    { origin: "自宅", destination: "栗東", minutes: 60 },
    { origin: "栗東", destination: "自宅", minutes: 70 },
  ],
  override: null,
};
const ctx = (key: string, isTrip = false, annualLeave: string | null = null) => ({ key, isTrip, annualLeave });

test("勤務先ごとの時刻・往復の所要時間を既定として引く", () => {
  const form = defaultForm(config, ctx("栗東"));
  assert.deepEqual([form.start, form.end, form.outMinutes, form.backMinutes], ["09:00", "18:00", "60", "70"]);
  assert.equal(defaultForm(config, ctx("門真", true)).backEnabled, false);
});

test("未設定の勤務先は共通設定で始め、所要時間は推測せず空にする", () => {
  const form = defaultForm(config, ctx("新宿"));
  assert.deepEqual([form.start, form.end, form.outMinutes], ["08:45", "17:15", ""]);
});

test("記録で保存した指定が既定より優先される", () => {
  const form = applyOverride(defaultForm(config, ctx("栗東")), {
    startMinutes: 600,
    endMinutes: 900,
    outbound: { enabled: false, minutes: null },
  });
  assert.equal(form.start, "10:00");
  assert.equal(form.outEnabled, false);
  assert.equal(form.backMinutes, "70");
});

test("勤務先を変えても手で変えた項目は残し、残した項目を知らせる", () => {
  const current = { ...defaultForm(config, ctx("栗東")), start: "10:00" };
  const { form, kept } = rebase(current, new Set<SyncField>(["start"]), defaultForm(config, ctx("新宿")));
  assert.equal(form.start, "10:00");
  assert.equal(form.end, "17:15");
  assert.deepEqual(kept, ["start"]);
});

test("反映ONの移動に所要時間が無ければ項目を示して断り、OFFなら要求しない", () => {
  const form = defaultForm(config, ctx("新宿"));
  const result = checkForm(form, config, ctx("新宿"), { fullDayOff: false });
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.message : "", /往路/);

  const off = checkForm({ ...form, outEnabled: false, backEnabled: false }, config, ctx("新宿"), { fullDayOff: false });
  assert.equal(off.ok, true);
});

test("全部OFFなら時刻が空でも保存でき、在宅は移動の指定を送らない", () => {
  const allOff = { ...defaultForm(config, ctx("栗東")), workEnabled: false, outEnabled: false, backEnabled: false, start: "", end: "" };
  assert.equal(checkForm(allOff, config, ctx("栗東"), { fullDayOff: false }).ok, true);
  const remote = checkForm(defaultForm(config, ctx("在宅")), config, ctx("在宅"), { fullDayOff: false });
  assert.ok(remote.ok && remote.payload.outbound === undefined);
});

test("終了が開始以前ならエラー", () => {
  const form = { ...defaultForm(config, ctx("栗東")), end: "08:00" };
  assert.equal(checkForm(form, config, ctx("栗東"), { fullDayOff: false }).ok, false);
});

test("年休（全休）は何も送らない", () => {
  const result = checkForm(defaultForm(config, ctx("栗東")), config, ctx("栗東"), { fullDayOff: true });
  assert.deepEqual(result.ok && result.payload, {});
});

test("確認用の文面は反映ONの項目だけで、期間では往路は初日・復路は最終日", () => {
  const form = { ...defaultForm(config, ctx("栗東")), backEnabled: false };
  const lines = describePlan(form, config, ctx("栗東"), { startDate: "2026-10-05", endDate: "2026-10-07" });
  assert.deepEqual(lines, ["勤務予定 09:00–18:00（期間の各日）", "往路 08:00–09:00（2026-10-05）"]);
});

test("名前と住所が続く行き先から勤務先名を当てる", () => {
  assert.equal(resolveKey("門真 大阪府門真市1-1", ["門真", "栗東"]), "門真");
  assert.equal(resolveKey("大阪", ["門真"]), "大阪");
});
