import assert from "node:assert/strict";
import { test } from "node:test";

import { fitBounds, project, type LatLng } from "@/lib/coordinates";

const SIZE = { width: 600, height: 400 };

test("0件は中心を決めない", () => {
  assert.equal(fitBounds([], SIZE), null);
});

test("1件はその地点を固定のズームで中心にする", () => {
  const point = { lat: 34.7025, lng: 135.4959 };
  assert.deepEqual(fitBounds([point], SIZE, { singleZoom: 15 }), { center: point, zoom: 15 });
});

test("複数件はすべての地点が余白の内側に収まる", () => {
  const points: LatLng[] = [
    { lat: 34.7809, lng: 135.4697 },
    { lat: 34.7025, lng: 135.4959 },
    { lat: 34.6937, lng: 135.5023 },
    { lat: 34.7208, lng: 135.3615 },
  ];
  const padding = 48;
  const result = fitBounds(points, SIZE, { padding });
  assert.ok(result);

  const center = project(result.center, result.zoom);
  for (const point of points) {
    const p = project(point, result.zoom);
    const x = p.x - center.x + SIZE.width / 2;
    const y = p.y - center.y + SIZE.height / 2;
    assert.ok(x >= padding - 0.5 && x <= SIZE.width - padding + 0.5, `x=${x}`);
    assert.ok(y >= padding - 0.5 && y <= SIZE.height - padding + 0.5, `y=${y}`);
  }
  // 1段上げると収まらない（必要以上に引いていない）。
  const tighter = result.zoom + 1;
  const c2 = project(result.center, tighter);
  const fitsAll = points.every((point) => {
    const p = project(point, tighter);
    const x = p.x - c2.x + SIZE.width / 2;
    const y = p.y - c2.y + SIZE.height / 2;
    return x >= padding && x <= SIZE.width - padding && y >= padding && y <= SIZE.height - padding;
  });
  assert.equal(fitsAll, false);
});

test("同じ地点が複数あっても上限のズームに留める", () => {
  const point = { lat: 35.681, lng: 139.767 };
  const result = fitBounds([point, point], SIZE, { maxZoom: 17 });
  assert.equal(result?.zoom, 17);
});
