import * as cheerio from "cheerio";
import { decode } from "html-entities";

export function getCheerioDoc(html: string) {
  return cheerio.load(html);
}

export function metaTagContent(
  doc: cheerio.CheerioAPI,
  type: string,
  attr: "property" | "name" = "property",
): string | undefined {
  const content = doc(`meta[${attr}='${type}']`).attr("content");
  if (!content) return undefined;
  return decode(content).trim();
}

