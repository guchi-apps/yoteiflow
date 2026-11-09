import type { ExternalLink } from "@/types/calendar";

/**
 * 「リンク」プロパティ（ハイパーリンク付きのrich_text）から外部リンクを読む。
 * リンクの付いた断片だけを拾い、区切りの改行などリンクの無い断片は無視する。
 */
export function readExternalLinks(property: { rich_text?: Array<{ plain_text?: string; href?: string | null; text?: { content?: string; link?: { url?: string } | null } }> } | undefined): ExternalLink[] {
  const links: ExternalLink[] = [];
  for (const item of property?.rich_text ?? []) {
    const url = item.href ?? item.text?.link?.url;
    if (!url) continue;
    const label = (item.plain_text ?? item.text?.content ?? "").trim() || url;
    links.push({ label, url });
  }
  return links;
}

/** 外部リンクをハイパーリンク付きrich_textへ直す。リンク間は改行で区切る。 */
export function externalLinksToRichText(links: ExternalLink[]): unknown[] {
  return links.flatMap((link, index) => [
    ...(index > 0 ? [{ type: "text", text: { content: "\n" } }] : []),
    { type: "text", text: { content: link.label, link: { url: link.url } } },
  ]);
}
