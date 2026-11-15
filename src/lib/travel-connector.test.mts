import assert from "node:assert/strict";
import test from "node:test";

import { travelConnectors, type ConnectorBox, type ConnectorTravel } from "@/lib/travel-connector";

const box = (id: string, top: number, height: number, column = 0, columns = 1): ConnectorBox => ({
  id,
  top,
  height,
  column,
  columns,
});

const travel = (
  id: string,
  linkedEventId: string | null,
  top: number,
  height: number,
  column = 0,
  columns = 1,
): ConnectorTravel => ({ ...box(id, top, height, column, columns), linkedEventId });

test("行きの移動は、移動の下端から予定の上端まで線を引く", () => {
  const [connector] = travelConnectors([travel("t", "e", 100, 20)], [box("e", 200, 30)]);
  assert.deepEqual(connector, {
    key: "t:e",
    eventId: "e",
    top: 120,
    bottom: 200,
    upper: { column: 0, columns: 1 },
    lower: { column: 0, columns: 1 },
    bendAt: null,
  });
});

test("帰りの移動は、予定の下端から移動の上端まで線を引く", () => {
  const [connector] = travelConnectors([travel("t", "e", 300, 20)], [box("e", 200, 30)]);
  assert.equal(connector.top, 230);
  assert.equal(connector.bottom, 300);
});

test("行き・帰りの両方があれば2本引く", () => {
  const connectors = travelConnectors(
    [travel("go", "e", 100, 20), travel("back", "e", 300, 20)],
    [box("e", 200, 30)],
  );
  assert.deepEqual(
    connectors.map((c) => c.key),
    ["go:e", "back:e"],
  );
});

test("接している・重なっている・隙間が2px未満なら線を出さない", () => {
  assert.equal(travelConnectors([travel("t", "e", 100, 100)], [box("e", 200, 30)]).length, 0);
  assert.equal(travelConnectors([travel("t", "e", 150, 100)], [box("e", 200, 30)]).length, 0);
  assert.equal(travelConnectors([travel("t", "e", 100, 99)], [box("e", 200, 30)]).length, 0);
});

test("紐づけが無い・予定がこの列に無い（別の日・活動記録のレーン）なら線を出さない", () => {
  assert.equal(travelConnectors([travel("t", null, 100, 20)], [box("e", 200, 30)]).length, 0);
  assert.equal(travelConnectors([travel("t", "other", 100, 20)], [box("e", 200, 30)]).length, 0);
  assert.equal(travelConnectors([travel("t", "e", 100, 20)], []).length, 0);
});

test("左端の位置がずれるときは中間で折る", () => {
  const [connector] = travelConnectors(
    [travel("t", "e", 100, 20)],
    [box("e", 201, 30, 1, 2)],
  );
  assert.equal(connector.bendAt, 161);
  assert.deepEqual(connector.upper, { column: 0, columns: 1 });
  assert.deepEqual(connector.lower, { column: 1, columns: 2 });
});

test("列の数が違っても左端が同じなら折らない", () => {
  const [connector] = travelConnectors(
    [travel("t", "e", 100, 20, 1, 2)],
    [box("e", 200, 30, 2, 4)],
  );
  assert.equal(connector.bendAt, null);
});
