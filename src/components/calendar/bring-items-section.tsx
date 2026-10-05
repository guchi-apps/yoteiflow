"use client";

import { Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { CalendarEventItem, TaskItem } from "@/types/calendar";

import { readErrorMessage } from "./response-error";
import { formatLinkedDate } from "./task-link-label";

/**
 * 予定の「持ち物」（issue #1080）。1項目 = 1 Task で、その場で完了にできる。
 * 期限は「その予定へ向かう移動の出発」から自動で決まり、ここでは設定させない。
 * 移動が決まらない間は期限を推測せず「移動未設定」と示す。
 */
export function BringItemsSection({
  event,
  timeZone,
  readOnly,
  onChanged,
}: {
  event: CalendarEventItem;
  timeZone: string;
  readOnly: boolean;
  /** 追加・完了・紐づけのあと、カレンダーの取り直しを頼む（期限がカレンダーに出るため）。 */
  onChanged: () => void;
}) {
  const [tasks, setTasks] = useState<TaskItem[] | null>(null);
  const [canAttach, setCanAttach] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/bring-items?eventId=${encodeURIComponent(event.id)}`);
      if (!response.ok) return;
      const body = (await response.json()) as { tasks: TaskItem[]; canAttach: boolean };
      setTasks(body.tasks);
      setCanAttach(body.canAttach);
    } catch {
      // 取れなければ持ち物の区画を出さないだけ（予定の表示は妨げない）。
    }
  }, [event.id]);

  useEffect(() => {
    // 予定詳細を開いたときにだけ取る（カレンダーの取得に混ぜない）。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const add = async () => {
    const title = name.trim();
    if (!title || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/bring-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          calendarId: event.calendarId,
          eventId: event.id,
          eventTitle: event.title,
          title,
        }),
      });
      if (!response.ok) {
        setError(await readErrorMessage(response, "持ち物を追加できませんでした。"));
        return;
      }
      setName("");
      await load();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "持ち物を追加できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (task: TaskItem, done: boolean) => {
    setTasks((current) => current?.map((t) => (t.id === task.id ? { ...t, done } : t)) ?? null);
    setError(null);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completeAction: true, done }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response, "更新できませんでした。"));
      onChanged();
    } catch (cause) {
      setTasks((current) =>
        current?.map((t) => (t.id === task.id ? { ...t, done: !done } : t)) ?? null,
      );
      setError(cause instanceof Error ? cause.message : "更新できませんでした。");
    }
  };

  const attach = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/bring-items/attach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: event.id }),
      });
      if (!response.ok) {
        setError(await readErrorMessage(response, "移動の出発へ紐づけられませんでした。"));
        return;
      }
      await load();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "移動の出発へ紐づけられませんでした。");
    } finally {
      setBusy(false);
    }
  };

  // 取得前、または持ち物が無く追加もできない（オフライン）ときは何も出さない。
  if (tasks === null || (tasks.length === 0 && readOnly)) return null;

  return (
    <div className="flex flex-col gap-1.5">
      {tasks.length > 0 && <span className="text-xs text-muted-foreground">持ち物</span>}

      {tasks.map((task) => {
        const departure = task.links.find((link) => link.target === "DUE" && link.travelId);
        return (
          <label
            key={task.id}
            className="flex min-w-0 items-start gap-2 text-sm text-on-surface"
          >
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-primary"
              checked={task.done}
              disabled={readOnly}
              onChange={(e) => toggle(task, e.target.checked)}
            />
            <span className="min-w-0 flex-1">
              <span className={cn("break-words", task.done && "text-on-surface-variant line-through")}>
                {task.title}
              </span>
              <span className="block text-xs text-on-surface-variant">
                {departure
                  ? `出発 ${formatLinkedDate(departure.resolvedAt, timeZone)} まで`
                  : "移動未設定"}
              </span>
            </span>
          </label>
        );
      })}

      {canAttach && (
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={readOnly || busy}
          onClick={attach}
        >
          移動の出発に合わせる
        </Button>
      )}

      {!readOnly &&
        (adding ? (
          <div className="flex items-center gap-2">
            <Input
              value={name}
              autoFocus
              placeholder="持ち物の名前"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void add();
                }
              }}
            />
            <Button size="sm" disabled={busy || !name.trim()} onClick={add}>
              追加
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => setAdding(true)}
          >
            <Plus className="size-4" />
            持ち物を追加
          </Button>
        ))}

      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}
