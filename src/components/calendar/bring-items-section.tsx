"use client";

import { Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { CalendarEventItem, TaskItem } from "@/types/calendar";

import { readErrorMessage } from "./response-error";
import { formatLinkedDate } from "./task-link-label";

type BringTravel = {
  id: string;
  title: string;
  start: string;
  end: string;
  relationLabel: string;
};
type DueState = { state: "set" | "unset" | "reselect"; reason?: "unlinked" | "not-before" };

/**
 * 予定の「持ち物」（issue #1080）。1項目 = 1 Task で、その場で完了にできる。
 * 期限は「予定前の移動」が日時からちょうど1件に決まるとき、その出発へ自動で紐づく。
 * 複数・終日・時間重複・時刻不明で決まらないときは、その予定に紐づく移動から利用者が選ぶ
 * （issue #1137）。移動が無い間は期限を推測せず「期限未設定」と示し、紐づけ先が無効になったものは
 * 「再選択が必要」と示す（別の移動へ無言で付け替えない）。
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
  const [travels, setTravels] = useState<BringTravel[]>([]);
  const [states, setStates] = useState<Record<string, DueState>>({});
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams({
        eventId: event.id,
        eventStart: event.start,
        eventEnd: event.end,
        eventAllDay: String(event.allDay),
      });
      const response = await fetch(`/api/bring-items?${query}`);
      if (!response.ok) return;
      const body = (await response.json()) as {
        tasks: TaskItem[];
        travels: BringTravel[];
        states: Record<string, DueState>;
      };
      setTasks(body.tasks);
      setTravels(body.travels);
      setStates(body.states);
    } catch {
      // 取れなければ持ち物の区画を出さないだけ（予定の表示は妨げない）。
    }
  }, [event.id, event.start, event.end, event.allDay]);

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
          eventStart: event.start,
          eventEnd: event.end,
          eventAllDay: event.allDay,
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

  const attach = async (travelId: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/bring-items/attach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: event.id,
          travelId,
          eventStart: event.start,
          eventEnd: event.end,
          eventAllDay: event.allDay,
        }),
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

  // 期限が未設定、または再選択が必要な持ち物があるときは、対象の移動を選べるようにする。
  const needsChoice = tasks?.some((task) => (states[task.id]?.state ?? "unset") !== "set") ?? false;

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
                  : "期限未設定"}
                {states[task.id]?.state === "reselect" && (
                  <span className="text-error">
                    {" "}
                    ・再選択が必要（
                    {states[task.id].reason === "unlinked"
                      ? "紐づけ先の移動がこの予定から外れています"
                      : "予定前の移動ではなくなっています"}
                    ）
                  </span>
                )}
              </span>
            </span>
          </label>
        );
      })}

      {needsChoice && !readOnly && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            {travels.length > 0
              ? "期限にする移動の出発を選ぶ"
              : "この予定に移動を紐づけると、出発が期限になります"}
          </span>
          {travels.map((travel) => (
            <Button
              key={travel.id}
              variant="outline"
              size="sm"
              className="h-auto w-full justify-start py-1.5 text-left"
              disabled={busy}
              onClick={() => void attach(travel.id)}
            >
              <span className="flex min-w-0 flex-col">
                <span className="clip-nowrap">{travel.title}</span>
                <span className="text-xs text-on-surface-variant">
                  {travel.relationLabel}・出発 {formatLinkedDate(travel.start, timeZone)}
                </span>
              </span>
            </Button>
          ))}
        </div>
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
