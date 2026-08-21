import type { CompactLyricLine, SyncedLyricsPayload } from "@repo/types";

// Dictionary of keywords commonly found in credit / metadata lines at the start/end of lyrics
const CREDIT_KEYWORDS = [
  "作词",
  "作词人",
  "填词",
  "词作者",
  "作曲",
  "作曲人",
  "曲作者",
  "编曲",
  "编曲人",
  "歌名",
  "歌曲",
  "歌曲名",
  "曲名",
  "歌手",
  "演唱者",
  "原唱",
  "配唱",
  "伴唱",
  "演唱",
  "主唱",
  "合唱",
  "专辑",
  "专集",
  "唱片",
  "吉他",
  "贝斯",
  "鼓",
  "缩混",
  "录音",
  "录音室",
  "录音棚",
  "弦乐",
  "键盘",
  "钢琴",
  "出品",
  "出品人",
  "和声",
  "和音",
  "混音",
  "混音室",
  "混音棚",
  "混音师",
  "母带棚",
  "母带师",
  "封面",
  "发行",
  "发行人",
  "制作",
  "制作人",
  "监制",
  "策划",
  "企划",
  "推广",
  "母带",
  "文案",
  "编辑",
  "统筹",
  "总监",
  "鸣谢",
  "感谢",
  "设计",
  "视觉",
  "工程",
  "乐队",
  "调校",
  "伴奏",
  "校对",
  "商务",
  "合作",
  "指挥",
  "经纪",
  "团队",
  "顾问",
  "翻译",
  "厂牌",
  "分轨",
  "版权",
  "提供",
  "上传",
  "打字",
  "动态歌词",
  "滚动歌词",
  "歌词制作",
  "歌词编辑",
  "ISRC",
  "Title",
  "Artist",
  "Artists",
  "Album",
  "Singer",
  "Singers",
  "Lyricist",
  "Composer",
  "Arranger",
  "Producer",
  "Recorded",
  "Recording",
  "Mixed",
  "Mixer",
  "Mixing",
  "Mastered",
  "Mastering",
  "Publisher",
  "Copyright",
];

export const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^暂无(歌词|滚动歌词|翻译|音译|lrc歌词)?([，,\s]*欢迎补充)?$/i,
  /^未收录歌词$/i,
  /^暂未收录歌词$/i,
  /^没有(歌词|填词)$/i,
  /^无歌词$/i,
  /^暂无$/i,
  /^(此歌曲|该歌曲)?为?(没有填词的)?纯音乐([，,\s]*请(您)?欣赏)?$/i,
  /^请欣赏纯音乐$/i,
  /^instrumental(\s*track)?$/i,
  /^pure\s*music$/i,
  /^no\s*lyrics(\s*available)?$/i,
  /^no\s*synced\s*lyrics$/i,
];

export function isPlaceholderText(str: string): boolean {
  if (!str || typeof str !== "string") return true;
  const trimmed = str.trim();
  if (!trimmed) return true;

  const norm = trimmed
    .replace(/^[\s[\]()（）"'【】「」]+|[\s[\]()（）"'【】「」]+$/g, "")
    .trim();

  if (!norm) return true;

  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(norm));
}

export function isPlaceholderLyricText(
  rawText: string,
  metadata?: { title?: string; artist?: string },
): boolean {
  if (!rawText || typeof rawText !== "string") return true;

  const trimmed = rawText.trim();
  if (!trimmed) return true;

  if (isPlaceholderText(trimmed)) return true;

  // Remove LRC timestamp tags: [00:00.00], [00:00.000], [00:00], etc.
  // Remove LRC word timestamp tags: <00:00.00>, <00:00.000>, <00:00>
  // Remove QRC/YRC timestamp tags: [0,0], [0,0,0], [0, 4689]
  // Remove QRC/YRC word timestamp tags: (0,0), (0,0,0), (0, 1042), (0, 1042, 0)
  // Remove standard LRC metadata tags: [ti:...], [ar:...], [al:...], [by:...], [offset:...], etc.
  // Remove YRC JSON structures: {"t":0,"c":[{"tx":"..."}]}
  const withoutTags = trimmed
    .replace(/\[\d+:\d+(?:\.\d+)?\]/g, "")
    .replace(/<\d+:\d+(?:\.\d+)?>/g, "")
    .replace(/\[\d+,\s*\d+(?:,\s*\d+)?\]/g, "")
    .replace(/\(\d+,\s*\d+(?:,\s*\d+)?\)/g, "")
    .replace(/<\d+,\s*\d+(?:,\s*\d+)?>/g, "")
    .replace(/\[[a-zA-Z]+:[^\]]*\]/g, "")
    .replace(/\{"t":\d+,"c":\[\{"tx":"([^"]+)"\}\]\}/g, "$1")
    .replace(/[\r\n]+/g, "\n")
    .trim();

  if (!withoutTags) return true;

  const lines = withoutTags
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return true;

  return lines.every(
    (line) =>
      isPlaceholderText(line) ||
      isCreditOrInfoLine(line, metadata?.title, metadata?.artist),
  );
}

function getLineText(line: CompactLyricLine): string {
  if (!Array.isArray(line)) return "";
  return line
    .map((w) => w[3] || "")
    .join("")
    .trim();
}

function normalizeStringForMatch(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "")
    .trim();
}

export function isCreditOrInfoLine(
  text: string,
  title?: string,
  artist?: string,
  bodyPass = false,
): boolean {
  if (!text || text.trim().length === 0) return false;

  const str = text.replace(/：/g, ": ").trim();
  const lowerStr = str.toLowerCase();

  // Check placeholder texts (e.g. "暂无歌词", "纯音乐，请欣赏", "Instrumental")
  if (isPlaceholderText(str)) {
    return true;
  }

  // Check copyright / platform claiming sentences
  if (
    (lowerStr.includes("未经") || lowerStr.includes("未经许可")) &&
    (lowerStr.includes("不得") ||
      lowerStr.includes("请勿") ||
      lowerStr.includes("使用") ||
      lowerStr.includes("授权") ||
      lowerStr.includes("翻唱"))
  ) {
    return true;
  }

  if (
    (lowerStr.includes("腾讯") ||
      lowerStr.includes("tme") ||
      lowerStr.includes("qq音乐") ||
      lowerStr.includes("网易云") ||
      lowerStr.includes("网易音乐") ||
      lowerStr.includes("酷狗")) &&
    (lowerStr.includes("享有") ||
      lowerStr.includes("权") ||
      lowerStr.includes("独家") ||
      lowerStr.includes("出品") ||
      lowerStr.includes("提供") ||
      lowerStr.includes("制作"))
  ) {
    return true;
  }

  if (
    lowerStr.startsWith("lyrics by:") ||
    lowerStr.startsWith("written by:") ||
    lowerStr.startsWith("composed by:") ||
    lowerStr.startsWith("produced by:") ||
    lowerStr.startsWith("arranged by:") ||
    lowerStr.startsWith("performed by:") ||
    lowerStr.startsWith("artist:") ||
    lowerStr.startsWith("album:") ||
    lowerStr.startsWith("title:") ||
    lowerStr.startsWith("track:") ||
    lowerStr.startsWith("singer:") ||
    lowerStr.startsWith("by:")
  ) {
    return true;
  }

  const hasColon = str.includes(":");
  const hitKeyword = CREDIT_KEYWORDS.some((kw) => {
    const lkw = kw.toLowerCase();
    return lowerStr.includes(lkw);
  });

  if (hitKeyword && hasColon) {
    // Make sure it's not speaker label in duet lyrics (e.g. "Artist:")
    if (artist && lowerStr.startsWith(`${artist.toLowerCase()}:`)) {
      return false;
    }
    return true;
  }

  // Title / artist header checks.
  // In bodyPass mode (mid-body lines) we skip these entirely to avoid stripping
  // genuine lyric lines that happen to share words with the title or artist name.
  if (!bodyPass) {
    const normLine = normalizeStringForMatch(str);
    const normTitle = title ? normalizeStringForMatch(title) : "";
    const normArtist = artist ? normalizeStringForMatch(artist) : "";

    // Exact match: line IS the title or artist
    if (normTitle && normLine === normTitle) return true;
    if (normArtist && normLine === normArtist) return true;

    // Exact combined match: "Title - Artist" / "Artist - Title" style header lines
    // (all non-alphanumeric are stripped by normalizeStringForMatch, so they collapse to a concat)
    if (normTitle && normArtist) {
      const combined1 = normTitle + normArtist;
      const combined2 = normArtist + normTitle;
      if (normLine === combined1 || normLine === combined2) return true;
    }
  }

  return false;
}

export function stripInfoLines(
  payload: SyncedLyricsPayload,
  metadata?: { title?: string; artist?: string },
): SyncedLyricsPayload {
  if (!Array.isArray(payload) || payload.length === 0) return payload;

  const title = metadata?.title;
  const artist = metadata?.artist;

  let startIdx = 0;
  let endIdx = payload.length;

  // Trim heading credit lines (up to first 8 lines)
  for (let i = 0; i < Math.min(payload.length, 8); i++) {
    const text = getLineText(payload[i]!);
    if (isCreditOrInfoLine(text, title, artist)) {
      startIdx = i + 1;
    } else if (text.length > 0) {
      break;
    }
  }

  // Trim ending credit lines (up to last 5 lines)
  for (
    let i = payload.length - 1;
    i >= Math.max(startIdx, payload.length - 5);
    i--
  ) {
    const text = getLineText(payload[i]!);
    if (isCreditOrInfoLine(text, title, artist)) {
      endIdx = i;
    } else if (text.length > 0) {
      break;
    }
  }

  if (startIdx >= endIdx) {
    return [];
  }

  const sliced = payload.slice(startIdx, endIdx);

  // Filter out any standalone placeholder or credit lines in the remaining body.
  // bodyPass=true skips title/artist matching so genuine lyric lines containing
  // title words (e.g. "Sweet dreams are made of this") are never removed.
  const filtered = sliced.filter((line) => {
    const text = getLineText(line);
    return (
      !isPlaceholderText(text) && !isCreditOrInfoLine(text, title, artist, true)
    );
  });

  return filtered;
}
