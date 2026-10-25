import { NextResponse } from "next/server";

import { appleAppSiteAssociation } from "@/lib/universal-links";

// Universal Link の関連付け（issue #1366）。AppleのCDN・端末が未ログインで取りに来るため、
// proxy では `isTokenAuthApiPath()` で素通しにしている。拡張子が無いので Content-Type を明示する。
export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(appleAppSiteAssociation(), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
