import { redirect } from "next/navigation";

import { AccountSection } from "@/components/settings/account-section";
import { SettingsShell } from "@/components/settings/settings-shell";
import { getCurrentUser } from "@/lib/auth-user";
import { SESSION_UNLINKED_LOGIN_PATH } from "@/lib/login-errors";

export default async function AccountSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_UNLINKED_LOGIN_PATH);

  return (
    <SettingsShell
      title="アカウント"
      description="YoteiFlowへのログインに使っているGoogleアカウントです。"
      backHref="/settings"
      backLabel="設定"
    >
      <AccountSection email={user.email} name={user.name} />
    </SettingsShell>
  );
}
