import { NextResponse } from "next/server";

import { APP_VERSION } from "@/lib/app-version";

// 稼働中の版の照合用（deploy.yml のヘルスチェックが APP_COMMIT_SHA と突き合わせる。issue #1257）。
// ビルド時に固められないよう毎回評価し、古い応答が再生されないようキャッシュさせない。
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { version: APP_VERSION, sha: process.env.APP_COMMIT_SHA || null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
