const ISRC_PATTERN = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;

export async function fetchLrcRedTtml(
  isrc: string,
  timeoutMs = 8000,
): Promise<string | null> {
  const normalizedIsrc = isrc.trim().toUpperCase();
  if (!ISRC_PATTERN.test(normalizedIsrc)) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `https://lrc.red/s/${normalizedIsrc}.ttml`,
      {
        headers: {
          Accept: "application/ttml+xml, application/xml, text/xml",
        },
        signal: controller.signal,
      },
    );
    if (!response.ok) return null;

    const ttml = await response.text();
    return /<\s*(?:[\w.-]+:)?tt(?:\s|>)/i.test(ttml) ? ttml : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
