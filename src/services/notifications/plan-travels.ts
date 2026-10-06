import { eventLeadAnnouncement, resolveEventLeadMinutes } from "@/lib/event-notification";
import { placeDisplayName } from "@/lib/place-text";
import type { EventNotificationOverride } from "@/types/calendar";

/**
 * 移動の通知の下書き（issue #1112）。予定（plan.ts の planEvents）と同じ規則で、基準は出発時刻。
 *
 * 外部APIもDBも見ない純粋関数にして、node:test で確かめられるようにする。
 */

export type TravelDraftSource = {
  id: string;
  origin: string;
  destination: string;
  departAt: Date;
  arriveAt: Date;
};

export type TravelJobDraft = {
  kind: "EVENT";
  dedupeKey: string;
  scheduledAt: Date;
  title: string;
  body: string;
  url: string;
};

const TITLE_LIMIT = 255;

export function planTravelDrafts(
  travels: TravelDraftSource[],
  overrides: Map<string, EventNotificationOverride>,
  accountEnabled: boolean,
  now: Date,
  windowEnd: Date,
  format: { formatTime: (iso: string) => string; itemDateKey: (iso: string) => string },
): TravelJobDraft[] {
  const drafts: TravelJobDraft[] = [];

  for (const travel of travels) {
    const leadList = resolveEventLeadMinutes(overrides.get(travel.id) ?? null, accountEnabled);
    if (leadList.length === 0) continue;
    if (travel.departAt > windowEnd) continue;

    const name = `${placeDisplayName(travel.origin)} → ${placeDisplayName(travel.destination)}`;
    const departIso = travel.departAt.toISOString();
    const timeRange = `${format.formatTime(departIso)}〜${format.formatTime(travel.arriveAt.toISOString())}`;

    for (const leadMinutes of leadList) {
      const scheduledAt = new Date(travel.departAt.getTime() - leadMinutes * 60_000);
      // 通知の時刻が過ぎている移動は作らない（予定と同じ）。
      if (scheduledAt <= now) continue;

      const title = leadMinutes === 0 ? `出発: ${name}` : `${eventLeadAnnouncement(leadMinutes)} ${name}`;

      drafts.push({
        kind: "EVENT",
        dedupeKey: `travel:${travel.id}:${departIso}:${leadMinutes}`,
        scheduledAt,
        title: title.length > TITLE_LIMIT ? title.slice(0, TITLE_LIMIT) : title,
        body: timeRange,
        url: `/calendar?date=${format.itemDateKey(departIso)}`,
      });
    }
  }

  return drafts;
}
