// Googleマップの共有経路URLから得た情報を、移動の入力に使える形へ補完する（issue #1053）。
// URLをそのまま外部へ開かせず、サーバーで安全に展開・構文解析した値だけをAIへ渡す。

import { requestAnthropicMessage } from "@/lib/anthropic-messages";
import { isTravelMode, type TravelMode } from "@/types/calendar";

const MODEL = "claude-haiku-4-5";
const MAX_MINUTES = 24 * 60;
const MAX_PLACE_LENGTH = 500;

export type GoogleMapsRouteAnalysis = {
  origin: string;
  destination: string;
  mode: TravelMode;
  minutes: number;
};

export type GoogleMapsRouteAnalysisInput = {
  origin: string;
  destination: string;
  /** 経由地（順番どおり）。所要時間は経由を含む全行程で求める（issue #1197） */
  waypoints?: string[];
  mode: TravelMode;
  url: string;
};

function extractJsonText(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1].trim() : trimmed;
}

export function buildGoogleMapsRouteAnalysisPrompt(input: GoogleMapsRouteAnalysisInput): string {
  return `Googleマップの共有経路URLを解析して、カレンダーの移動入力に必要な情報を返してください。URLは利用者が明示的に貼り付けたものです。与えられた構造化情報を優先し、分からない内容を創作しないでください。

出力は前置きや説明・コードフェンスを一切付けず、次のJSONだけにしてください。
{"origin":"出発地","destination":"目的地","mode":"CAR","minutes":40}

# 条件
- origin と destination は構造化情報にある値をそのまま使う。空文字にしない
- mode は ${["CAR", "PUBLIC_TRANSIT", "WALK", "OTHER"].join(", ")} のいずれか
- minutes は経路の所要時間を分で表す1以上1440以下の整数
- URLに所要時間が含まれない場合だけ、発着地（経由地があれば経由して通る全行程）と交通手段から妥当な所要時間を1つ補完する
- 実在しない路線・施設・交通手段を創作しない

# 構造化情報
出発地: ${input.origin}
${input.waypoints && input.waypoints.length > 0 ? `経由地（この順に通る）: ${input.waypoints.join(" → ")}\n` : ""}目的地: ${input.destination}
交通手段: ${input.mode}
共有URL: ${input.url}`;
}

export async function analyzeGoogleMapsRoute(
  token: string,
  input: GoogleMapsRouteAnalysisInput,
): Promise<GoogleMapsRouteAnalysis> {
  const { text } = await requestAnthropicMessage({
    feature: "travel-estimate",
    token,
    model: MODEL,
    maxTokens: 512,
    prompt: buildGoogleMapsRouteAnalysisPrompt(input),
    failureMessage: "Googleマップ経路のAI解析に失敗しました",
  });
  if (!text) throw new Error("AIの応答からテキストを取得できませんでした");

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonText(text));
  } catch {
    throw new Error("AIの応答をJSONとして解析できませんでした");
  }

  const value = parsed as Partial<GoogleMapsRouteAnalysis>;
  if (
    typeof value.origin !== "string" ||
    !value.origin.trim() ||
    value.origin.trim().length > MAX_PLACE_LENGTH ||
    typeof value.destination !== "string" ||
    !value.destination.trim() ||
    value.destination.trim().length > MAX_PLACE_LENGTH ||
    !isTravelMode(value.mode) ||
    !Number.isFinite(value.minutes)
  ) {
    throw new Error("AIの応答の形式が不正です");
  }

  const minutes = Math.round(value.minutes as number);
  if (minutes < 1 || minutes > MAX_MINUTES) throw new Error("AIが返した所要時間が不正です");

  return { origin: value.origin.trim(), destination: value.destination.trim(), mode: value.mode, minutes };
}
