import { isTravelMode, type TravelMode } from "@/types/calendar";

const MAX_TEXT = 500;
const MAX_NOTE = 20_000;

export type SharedTravelBody = {
  origin: string;
  destination: string;
  mode: TravelMode;
  departAt: string;
  arriveAt: string;
  note: string;
  estimateSource: "YAHOO" | "AI";
};

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() && value.length <= max ? value.trim() : null;
}

function iso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/**
 * 共有拡張が preview で得た経路を登録に載せ直したものを検証する（再解析しない・issue #1083）。
 * 形・長さ・時刻の前後だけを確かめ、通らなければ null。
 */
export function parseSharedTravelBody(value: unknown): SharedTravelBody | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const origin = text(raw.origin, MAX_TEXT);
  const destination = text(raw.destination, MAX_TEXT);
  const departAt = iso(raw.departAt);
  const arriveAt = iso(raw.arriveAt);
  const note = typeof raw.note === "string" && raw.note.length <= MAX_NOTE ? raw.note : "";
  if (!origin || !destination || !departAt || !arriveAt || !isTravelMode(raw.mode)) return null;
  if (new Date(arriveAt).getTime() <= new Date(departAt).getTime()) return null;
  return {
    origin,
    destination,
    mode: raw.mode,
    departAt,
    arriveAt,
    note,
    estimateSource: raw.estimateSource === "AI" ? "AI" : "YAHOO",
  };
}
