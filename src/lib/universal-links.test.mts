import assert from "node:assert/strict";
import test from "node:test";

import { appleAppSiteAssociation } from "@/lib/universal-links";

test("AASAはアプリのIDと /calendar だけを対象にする（issue #1366）", () => {
  assert.deepEqual(appleAppSiteAssociation(), {
    applinks: {
      details: [{ appIDs: ["6AA3WFTR94.com.gucchii.yoteiflow"], components: [{ "/": "/calendar" }] }],
    },
  });
});
