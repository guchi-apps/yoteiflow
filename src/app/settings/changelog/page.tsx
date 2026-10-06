import { redirect } from "next/navigation";
import { format, parseISO } from "date-fns";
import { ja } from "date-fns/locale";

import { SettingsShell } from "@/components/settings/settings-shell";
import { Card, CardContent } from "@/components/ui/card";
import { APP_VERSION } from "@/lib/app-version";
import { getCurrentUser } from "@/lib/auth-user";
import { APP_CHANGELOG } from "@/lib/changelog";
import { SESSION_UNLINKED_LOGIN_PATH } from "@/lib/login-errors";

export default async function ChangelogPage() {
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_UNLINKED_LOGIN_PATH);

  return (
    <SettingsShell
      title="更新履歴"
      description={`現在のバージョンは v${APP_VERSION} です。`}
      backHref="/settings"
      backLabel="設定"
    >
      <Card>
        <CardContent className="flex flex-col gap-6">
          {APP_CHANGELOG.map((entry, index) => (
            <section
              key={entry.version}
              className={
                index < APP_CHANGELOG.length - 1 ? "border-b border-outline-variant pb-6" : ""
              }
            >
              <div className="mb-2 flex items-baseline justify-between gap-4">
                <h2 className="type-title-small font-mono">v{entry.version}</h2>
                <time
                  dateTime={entry.date}
                  className="type-body-small shrink-0 text-on-surface-variant"
                >
                  {format(parseISO(entry.date), "yyyy年M月d日", { locale: ja })}
                </time>
              </div>

              <ul className="type-body-medium flex flex-col gap-1.5 text-on-surface-variant">
                {entry.changes.map((change) => (
                  <li key={change} className="flex gap-2">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-on-surface-variant/60" />
                    <span>{change}</span>
                  </li>
                ))}
              </ul>

              {/* Card自体が surface-container-low のため、1段濃い面に置いて変更点と読み分けられるようにする */}
              {entry.usage && entry.usage.length > 0 && (
                <div className="mt-3 rounded-lg bg-surface-container p-3">
                  <h3 className="mb-1.5 type-label-large text-on-surface">使い方</h3>
                  <ol className="type-body-medium flex flex-col gap-1.5 text-on-surface-variant">
                    {entry.usage.map((step, stepIndex) => (
                      <li key={step} className="flex gap-2">
                        <span className="shrink-0 tabular-nums">{stepIndex + 1}.</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </section>
          ))}
        </CardContent>
      </Card>
    </SettingsShell>
  );
}
