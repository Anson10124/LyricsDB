import * as cheerio from 'cheerio';
import { decode } from 'html-entities';

export function getCheerioDoc(html: string) {
  return cheerio.load(html);
}

export function metaTagContent(
  doc: cheerio.CheerioAPI,
  type: string,
  attr: 'property' | 'name' = 'property'
): string | undefined {
  const content = doc(`meta[${attr}='${type}']`).attr('content');
  if (!content) return undefined;
  return decode(content).trim();
}

export function linkedDataScript(
  doc: cheerio.CheerioAPI,
  searchInBody = false
): Record<string, unknown> | undefined {
  const context = searchInBody ? undefined : 'head';
  const content = doc('script[type="application/ld+json"]', context).text();
  if (!content) return undefined;

  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}
