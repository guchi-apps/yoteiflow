/**
 * サーバーが起動したときに1回だけ走る（Next.js の instrumentation）。
 *
 * ここで通知のタイマーを始める（docs/spec.md §32）。時刻が来たことに気付けるのはサーバーだけで、
 * 画面を開いていない間も送る必要があるため、リクエストの外に置き場所が要る。
 */
export async function register(): Promise<void> {
  // Edgeランタイムでも呼ばれる。node:crypto とPrismaを使うため、Node側でだけ動かす。
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { startNotificationScheduler, startWorkApplyMailScheduler } = await import(
    "@/services/notifications/scheduler"
  );
  startNotificationScheduler();
  startWorkApplyMailScheduler();

  // StatusHubの共通アクセス設定へ、利用者の操作が無くても5分以内に1回は確認を送り、適用中の版を伝える
  // （管理画面の「反映済み」の根拠になる）。4分ごと＋起動直後。
  const { sendAccessHeartbeat } = await import("@/lib/access/client");
  void sendAccessHeartbeat();
  setInterval(() => void sendAccessHeartbeat(), 4 * 60 * 1000).unref();
}
