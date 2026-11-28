"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { NAV_ITEMS } from "@/components/nav/nav-items";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { rememberStartPath } from "@/lib/home-path";

/**
 * アプリを開いたときに最初に出す画面（起動画面）の設定（issue #637）。
 *
 * サーバーAPIを叩かないのは、この設定がユーザー単位ではなく端末ごとのCookieに持つため
 * （`docs/spec.md` §4）。書き込みはブラウザの中だけで完結し、失敗しうる外部との往復も無い。
 */
export function StartPathSection({ startPath }: { startPath: string }) {
  const router = useRouter();
  const [value, setValue] = useState(startPath);

  const change = (next: string) => {
    setValue(next);
    rememberStartPath(next);
    // /settings 一覧の行の値（起動画面ラベル）はサーバーコンポーネントがCookieを読んで
    // 描いているため、書き換えたことをそちらへ反映させる。
    router.refresh();
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="start-path">起動時に開く画面</Label>
            <p className="type-body-small text-on-surface-variant">
              アプリを開いたときに最初に出す画面です。いま設定を開いているこのアプリだけに
              反映されます。ホーム画面に追加したアプリとブラウザは別々に持つため、スマートフォンと
              パソコンはもちろん、同じ端末でも別々に設定できます。
            </p>
          </div>

          <Select value={value} onValueChange={change}>
            <SelectTrigger id="start-path" variant="flat" className="max-w-[60%] shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NAV_ITEMS.map((item) => (
                <SelectItem key={item.href} value={item.href}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
