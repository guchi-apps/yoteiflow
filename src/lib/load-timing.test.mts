import assert from "node:assert/strict";
import test from "node:test";

import { createLoadTimer, formatLoadSpans, serverTimingHeader } from "@/lib/load-timing";

function fakeClock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test("成功・失敗のどちらでも区間を記録する", async () => {
  const clock = fakeClock();
  const timer = createLoadTimer(clock.now);

  let resolveOk!: (v: string) => void;
  const ok = timer.time("google", new Promise<string>((r) => (resolveOk = r)));
  clock.advance(120);
  resolveOk("done");
  assert.equal(await ok, "done");

  let rejectNg!: (e: Error) => void;
  const ng = timer.time("notion", new Promise<never>((_, r) => (rejectNg = r)));
  clock.advance(300);
  rejectNg(new Error("boom"));
  await assert.rejects(ng, /boom/);

  assert.deepEqual(timer.spans(), [
    { name: "google", ms: 120 },
    { name: "notion", ms: 300 },
  ]);
  assert.equal(timer.elapsed(), 420);
});

test("Server-Timingは丸めたmsで並べ、tokenでない名前は落とす", () => {
  assert.equal(
    serverTimingHeader(
      [
        { name: "google", ms: 412.4 },
        { name: "notion-tasks", ms: 2380.6 },
        { name: "日本語", ms: 1 },
      ],
      2401.2,
    ),
    "google;dur=412, notion-tasks;dur=2381, total;dur=2401",
  );
  assert.equal(serverTimingHeader([]), "");
});

test("ログの内訳は遅い順に並べる", () => {
  assert.equal(
    formatLoadSpans(
      [
        { name: "db", ms: 30 },
        { name: "notion", ms: 2380 },
        { name: "google", ms: 412 },
      ],
      2410,
    ),
    "total=2410ms notion=2380ms google=412ms db=30ms",
  );
});
