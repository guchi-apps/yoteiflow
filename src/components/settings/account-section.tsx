"use client";

import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { clearQueue } from "@/lib/activity-queue/store";
import { clearWriteQueue } from "@/lib/offline-queue/store";

export function AccountSection({ email, name }: { email: string | null; name: string | null }) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          {name && <span className="type-body-large truncate font-medium">{name}</span>}
          <span className="type-body-medium truncate text-on-surface-variant">
            {email ?? "ログイン中"}
          </span>
        </div>

        {/* JSの読み込みを待たずに押せるよう、fetchではなく素のフォーム送信にする。 */}
        {/* 別のアカウントで入り直したとき、前のユーザーの未送信の記録操作を送らないよう捨てる（issue #974）。 */}
        <form action="/auth/signout" method="post" onSubmit={() => {
          clearQueue();
          clearWriteQueue();
        }}>
          <Button type="submit" variant="outline" size="sm">
            <LogOut className="size-4" />
            ログアウト
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
