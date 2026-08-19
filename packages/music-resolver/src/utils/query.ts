/**
 * Cleans a search query by removing problematic typographic characters
 * while preserving valid content (emojis, punctuation, etc.)
 */
export function cleanSearchQuery(query: string): string {
  return query
    // Remove special quotation marks (German „", French «», Asian 『』, etc.)
    .replace(/[\u201E\u201C\u201D\u00AB\u00BB\u2039\u203A\u300E\u300F\u300C\u300D]/g, '')
    // Normalize fancy apostrophes to standard apostrophe
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    // Normalize fancy double quotes to nothing
    .replace(/[\u201C\u201D]/g, '')
    // Remove middle dot
    .replace(/\u00B7/g, ' ')
    // Normalize dash types to standard hyphen
    .replace(/[\u2013\u2014\u2015]/g, '-')
    // Remove zero-width characters
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // Collapse multiple spaces and trim
    .replace(/\s+/g, ' ')
    .trim();
}
