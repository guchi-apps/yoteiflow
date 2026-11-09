import assert from "node:assert/strict";
import test from "node:test";

import { externalLinksToRichText, readExternalLinks } from "@/lib/external-links";

test("リンクはrich_textに往復できる（区切りの改行は無視する）", () => {
  const links = [
    { label: "メール", url: "https://a.example/1" },
    { label: "資料", url: "https://b.example/2" },
  ];
  const rich = externalLinksToRichText(links) as Array<{ text: { content: string; link?: { url: string } } }>;
  assert.equal(rich.length, 3);
  const read = readExternalLinks({
    rich_text: rich.map((r) => ({ plain_text: r.text.content, href: r.text.link?.url ?? null, text: r.text })),
  });
  assert.deepEqual(read, links);
  assert.deepEqual(readExternalLinks(undefined), []);
});
