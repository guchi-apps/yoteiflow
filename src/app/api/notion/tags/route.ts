import { NextResponse } from "next/server";
import type { NotionConnection } from "@prisma/client";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import {
  addTagOption,
  isTagColor,
  removeTagOption,
  renameTagOption,
  reorderTagOptions,
  tagLocation,
  TagOptionConflictError,
  type TagColor,
  type TagKind,
} from "@/services/notion/tag-options";
import { workPlaceShortLabels, workTripPlaces } from "@/services/notion/work-logs";

// タスクのタグ・日付リマインドの種類・勤務場所・買い物のカテゴリ・場所のタグの選択肢を扱う。
// 選択肢はNotion側のプロパティ定義が一次情報源のため、DaySpanのDBには保存しない。
// 色だけはNotion APIが既存の選択肢への変更を受け付けないため、追加のときにしか選べない。

const TAG_KINDS: TagKind[] = ["task", "reminder", "work", "shopping", "place", "progress"];

function isTagKind(value: unknown): value is TagKind {
  return typeof value === "string" && (TAG_KINDS as string[]).includes(value);
}

type Prepared =
  | { error: NextResponse; kind?: undefined; connection?: undefined }
  | { error?: undefined; kind: TagKind; connection: NotionConnection };

function reject(body: Record<string, unknown>, status: number): Prepared {
  return { error: NextResponse.json(body, { status }) };
}

/** タグ用のプロパティが無いDBを選んでいることもある。何を直せばよいか分かる形で返す。 */
const TAG_PROPERTY_MISSING_MESSAGES: Record<TagKind, string> = {
  task: "タスクDBにタグ（マルチセレクト）のプロパティがありません。",
  reminder: "日付リマインドDBに種類（セレクト）のプロパティがありません。",
  work: "勤務記録DBに勤務場所（セレクト）のプロパティがありません。",
  shopping: "買い物リストDBにカテゴリ（セレクト）のプロパティがありません。",
  progress: "タスクDBに進捗（セレクト）のプロパティがありません。",
  place: "場所DBにタグ（マルチセレクト）のプロパティがありません。",
};

/** どの操作もNotionの現状を取り直して書き戻すため、前準備は同じ。 */
async function prepare(rawKind: unknown): Promise<Prepared> {
  const userId = await requireUserId();
  if (!userId) return reject({ error: "unauthorized" }, 401);

  if (!isTagKind(rawKind)) return reject({ error: "kind is required" }, 400);
  const kind: TagKind = rawKind;

  // 場所のタグは固定の4種で、選択肢の追加・削除・改名・並び替えは受けない（issue #1361）。
  // 画面から入口を無くすだけだと、APIの直接呼び出しが素通りするためここでも断る。
  if (kind === "place") {
    return reject({ error: "place_tags_fixed", message: "場所のタグは変更できません。" }, 403);
  }

  const connection = await db.notionConnection.findUnique({ where: { userId } });
  if (!connection) return reject({ error: "not_connected" }, 404);

  if (!tagLocation(connection, kind)) {
    return reject(
      { error: "tag_property_missing", message: TAG_PROPERTY_MISSING_MESSAGES[kind] },
      422,
    );
  }

  return { kind, connection };
}

/** 現在の状態と食い違う要求（消えた選択肢・重複する名前）は、Notionへ書く前に断る。 */
function conflict(error: TagOptionConflictError): NextResponse {
  return NextResponse.json({ error: "tag_option_conflict", message: error.message }, { status: 409 });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { kind?: unknown; name?: unknown; color?: unknown };

  const prepared = await prepare(body.kind);
  if (prepared.error) return prepared.error;

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  // 色を選べるのは追加のときだけ。Notionは既存の選択肢の色を変更させない。
  const color: TagColor = isTagColor(body.color) ? body.color : "default";

  try {
    const options = await addTagOption(prepared.connection, prepared.kind, name, color);
    return NextResponse.json({ options });
  } catch (error) {
    return externalApiError("notion", "add tag option", error);
  }
}

/**
 * 選択肢の改名（`optionId` + `name`）と並び替え（`order`）。
 *
 * どちらもIDで既存の選択肢を指すため、それが付いている既存ページの値はそのまま残る
 * （選択肢を消して作り直すのとは違い、ページから外れない）。
 */
export async function PATCH(request: Request) {
  const body = (await request.json()) as {
    kind?: unknown;
    optionId?: unknown;
    name?: unknown;
    order?: unknown;
  };

  const prepared = await prepare(body.kind);
  if (prepared.error) return prepared.error;

  if (Array.isArray(body.order)) {
    const order = body.order.filter((id): id is string => typeof id === "string");
    if (order.length !== body.order.length) {
      return NextResponse.json({ error: "order must be string[]" }, { status: 400 });
    }

    try {
      const options = await reorderTagOptions(prepared.connection, prepared.kind, order);
      return NextResponse.json({ options });
    } catch (error) {
      if (error instanceof TagOptionConflictError) return conflict(error);
      return externalApiError("notion", "reorder tag options", error);
    }
  }

  const optionId = typeof body.optionId === "string" ? body.optionId : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!optionId) return NextResponse.json({ error: "optionId is required" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const connection = prepared.connection;

  let renamed;
  try {
    renamed = await renameTagOption(connection, prepared.kind, optionId, name);
  } catch (error) {
    if (error instanceof TagOptionConflictError) return conflict(error);
    return externalApiError("notion", "rename tag option", error);
  }

  // 出張扱いは勤務場所の「名前」で覚えている（docs/spec.md §34）。改名に追従させないと、
  // 一覧に出ていない名前が設定に残り、その勤務場所は出張扱いから外れる。
  if (prepared.kind === "work" && renamed.previousName !== name) {
    const tripPlaces = workTripPlaces(connection);
    const shortLabels = workPlaceShortLabels(connection);
    const data: { workTripPlaces?: string[]; workPlaceShortLabels?: Record<string, string> } = {};
    if (tripPlaces.includes(renamed.previousName)) {
      data.workTripPlaces = tripPlaces.map((place) =>
        place === renamed.previousName ? name : place,
      );
    }
    // 狭い月表示の1文字も名前で覚えているため、改名に追従させる（issue #1381）。
    if (renamed.previousName in shortLabels) {
      const { [renamed.previousName]: label, ...rest } = shortLabels;
      data.workPlaceShortLabels = { ...rest, [name]: label };
    }
    // 正式名称の結び付け（WorkPlaceLink）と勤務先別の既定値（WorkPlaceDefault）も名前キー（issue #1417）。
    // 新しい名前に古い行が残っていると一意制約に当たるため、先に消してから付け替える。
    // 出張の行き先（isTrip）は場所DBの名前で、勤務場所の選択肢ではないため触らない。
    const userId = connection.userId;
    const previous = renamed.previousName;
    await db.$transaction([
      ...(Object.keys(data).length > 0
        ? [db.notionConnection.update({ where: { id: connection.id }, data })]
        : []),
      db.workPlaceLink.deleteMany({ where: { userId, workPlace: name } }),
      db.workPlaceLink.updateMany({ where: { userId, workPlace: previous }, data: { workPlace: name } }),
      db.workPlaceDefault.deleteMany({ where: { userId, key: name, isTrip: false } }),
      db.workPlaceDefault.updateMany({
        where: { userId, key: previous, isTrip: false },
        data: { key: name },
      }),
    ]);
  }

  return NextResponse.json({ options: renamed.options });
}

export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;

  const prepared = await prepare(params.get("kind"));
  if (prepared.error) return prepared.error;

  const name = params.get("name")?.trim() ?? "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  try {
    const options = await removeTagOption(prepared.connection, prepared.kind, name);

    // 消した勤務場所が出張扱いのままだと、どの画面からも外せない名前が設定に居座る
    // （出張扱いのスイッチは選択肢の一覧に添えて出しているため）。
    if (prepared.kind === "work") {
      const tripPlaces = workTripPlaces(prepared.connection);
      const shortLabels = workPlaceShortLabels(prepared.connection);
      const data: { workTripPlaces?: string[]; workPlaceShortLabels?: Record<string, string> } = {};
      if (tripPlaces.includes(name)) {
        data.workTripPlaces = tripPlaces.filter((place) => place !== name);
      }
      if (name in shortLabels) {
        data.workPlaceShortLabels = Object.fromEntries(
          Object.entries(shortLabels).filter(([place]) => place !== name),
        );
      }
      const userId = prepared.connection.userId;
      await db.$transaction([
        ...(Object.keys(data).length > 0
          ? [db.notionConnection.update({ where: { id: prepared.connection.id }, data })]
          : []),
        // 名前キーの設定も消す（issue #1417）。残ると設定画面のどこからも消せない。
        db.workPlaceLink.deleteMany({ where: { userId, workPlace: name } }),
        db.workPlaceDefault.deleteMany({ where: { userId, key: name, isTrip: false } }),
      ]);
    }

    return NextResponse.json({ options });
  } catch (error) {
    return externalApiError("notion", "remove tag option", error);
  }
}
