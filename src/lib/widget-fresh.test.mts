import assert from "node:assert/strict";
import test from "node:test";

import { isWidgetFreshRequest } from "@/lib/widget-fresh";

test("ヘッダーが1のときだけ取り直しとみなす", () => {
  assert.equal(isWidgetFreshRequest(new Headers({ "X-Widget-Fresh": "1" })), true);
  assert.equal(isWidgetFreshRequest(new Headers({ "x-widget-fresh": " 1 " })), true);
});

test("ヘッダーが無い・1以外なら持ち回しを使う", () => {
  assert.equal(isWidgetFreshRequest(new Headers()), false);
  assert.equal(isWidgetFreshRequest(new Headers({ "X-Widget-Fresh": "0" })), false);
  assert.equal(isWidgetFreshRequest(new Headers({ "X-Widget-Fresh": "true" })), false);
});
