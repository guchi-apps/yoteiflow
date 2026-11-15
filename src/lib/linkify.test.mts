import assert from "node:assert/strict";
import test from "node:test";

import { splitTextWithLinks } from "@/lib/linkify";

test("splitTextWithLinks: URLを含まない文字列はそのまま1つのtextセグメント", () => {
  const segments = splitTextWithLinks("ただのメモです");
  assert.deepEqual(segments, [{ type: "text", value: "ただのメモです" }]);
});

test("splitTextWithLinks: 文中のURL", () => {
  const segments = splitTextWithLinks("資料は https://example.com/doc を見てください");
  assert.deepEqual(segments, [
    { type: "text", value: "資料は " },
    { type: "link", url: "https://example.com/doc" },
    { type: "text", value: " を見てください" },
  ]);
});

test("splitTextWithLinks: 文頭のURL", () => {
  const segments = splitTextWithLinks("https://example.com これを確認");
  assert.deepEqual(segments, [
    { type: "link", url: "https://example.com" },
    { type: "text", value: " これを確認" },
  ]);
});

test("splitTextWithLinks: 文末のURL", () => {
  const segments = splitTextWithLinks("確認してください https://example.com");
  assert.deepEqual(segments, [
    { type: "text", value: "確認してください " },
    { type: "link", url: "https://example.com" },
  ]);
});

test("splitTextWithLinks: 全角句点が直後に続く場合は切り離す", () => {
  const segments = splitTextWithLinks("こちら。https://example.com/path。以上です。");
  assert.deepEqual(segments, [
    { type: "text", value: "こちら。" },
    { type: "link", url: "https://example.com/path" },
    { type: "text", value: "。以上です。" },
  ]);
});

test("splitTextWithLinks: 全角の丸括弧が直後に続く場合も切り離す", () => {
  const segments = splitTextWithLinks("参考: https://example.com/path）以上");
  assert.deepEqual(segments, [
    { type: "text", value: "参考: " },
    { type: "link", url: "https://example.com/path" },
    { type: "text", value: "）以上" },
  ]);
});

test("splitTextWithLinks: 文がURLを半角括弧で囲むと、対応の取れない閉じ括弧だけ切り離す", () => {
  const segments = splitTextWithLinks("(https://example.com)を参照");
  assert.deepEqual(segments, [
    { type: "text", value: "(" },
    { type: "link", url: "https://example.com" },
    { type: "text", value: ")を参照" },
  ]);
});

test("splitTextWithLinks: URL自身が持つ対応の取れた括弧は残す", () => {
  const segments = splitTextWithLinks("https://en.wikipedia.org/wiki/Foo_(bar) を参照");
  assert.deepEqual(segments, [
    { type: "link", url: "https://en.wikipedia.org/wiki/Foo_(bar)" },
    { type: "text", value: " を参照" },
  ]);
});

test("splitTextWithLinks: URL自身の括弧の外側にさらに文の括弧が重なる場合", () => {
  const segments = splitTextWithLinks("(参照: https://en.wikipedia.org/wiki/Foo_(bar))");
  assert.deepEqual(segments, [
    { type: "text", value: "(参照: " },
    { type: "link", url: "https://en.wikipedia.org/wiki/Foo_(bar)" },
    { type: "text", value: ")" },
  ]);
});

test("splitTextWithLinks: 複数のURLをそれぞれ検出する", () => {
  const segments = splitTextWithLinks("https://a.example.com と https://b.example.com の両方");
  assert.deepEqual(segments, [
    { type: "link", url: "https://a.example.com" },
    { type: "text", value: " と " },
    { type: "link", url: "https://b.example.com" },
    { type: "text", value: " の両方" },
  ]);
});

test("splitTextWithLinks: 改行を含むテキストは改行をそのまま残す", () => {
  const segments = splitTextWithLinks("1行目\nhttps://example.com\n3行目");
  assert.deepEqual(segments, [
    { type: "text", value: "1行目\n" },
    { type: "link", url: "https://example.com" },
    { type: "text", value: "\n3行目" },
  ]);
});

test("splitTextWithLinks: httpのみ・大文字小文字を区別しない", () => {
  const segments = splitTextWithLinks("HTTP://example.com と http://example.jp");
  assert.deepEqual(segments, [
    { type: "link", url: "HTTP://example.com" },
    { type: "text", value: " と " },
    { type: "link", url: "http://example.jp" },
  ]);
});

test("splitTextWithLinks: 英数字の直後に地続きのhttpsはURLとして扱わない", () => {
  const segments = splitTextWithLinks("myhttps://example.com");
  assert.deepEqual(segments, [{ type: "text", value: "myhttps://example.com" }]);
});

test("splitTextWithLinks: 空文字列", () => {
  assert.deepEqual(splitTextWithLinks(""), []);
});

test("splitTextWithLinks: クエリ文字列を含むURLの直後に空白無しで日本語が続く", () => {
  const segments = splitTextWithLinks("詳細はhttps://example.com/search?q=abc&lang=jaをご覧ください");
  assert.deepEqual(segments, [
    { type: "text", value: "詳細は" },
    { type: "link", url: "https://example.com/search?q=abc&lang=ja" },
    { type: "text", value: "をご覧ください" },
  ]);
});

test("splitTextWithLinks: URLの直後に空白無しで全角読点が続く", () => {
  const segments = splitTextWithLinks("参照先はhttps://example.com、以上です");
  assert.deepEqual(segments, [
    { type: "text", value: "参照先は" },
    { type: "link", url: "https://example.com" },
    { type: "text", value: "、以上です" },
  ]);
});

test("splitTextWithLinks: 「Morrowで開く: /mail/…」はMorrowの本番URLへ補ってリンクにする（issue #1524）", () => {
  const segments = splitTextWithLinks("メール: 件名\nMorrowで開く: /mail/main~1a1da2527a796f53");
  assert.deepEqual(segments, [
    { type: "text", value: "メール: 件名\nMorrowで開く: " },
    { type: "link", url: "https://aide-bot.gucchii.com/mail/main~1a1da2527a796f53", label: "/mail/main~1a1da2527a796f53" },
  ]);
});

test("splitTextWithLinks: 「Morrowで開く」の手掛かりが無い相対パスはリンクにしない", () => {
  const segments = splitTextWithLinks("保存先は /mail/abc です");
  assert.deepEqual(segments, [{ type: "text", value: "保存先は /mail/abc です" }]);
});
