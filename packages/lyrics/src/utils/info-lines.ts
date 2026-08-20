import type { CompactLyricLine, SyncedLyricsPayload } from '@repo/types';

// Dictionary of keywords commonly found in credit / metadata lines at the start/end of lyrics
const CREDIT_KEYWORDS = [
  '作词',
  '作曲',
  '编曲',
  '吉他',
  '贝斯',
  '鼓',
  '缩混',
  '录音',
  '弦乐',
  '键盘',
  '钢琴',
  '出品',
  '和声',
  '和音',
  '混音',
  '封面',
  '发行',
  '制作',
  '监制',
  '策划',
  '企划',
  '推广',
  '母带',
  '文案',
  '编辑',
  '统筹',
  '总监',
  '鸣谢',
  '感谢',
  '设计',
  '视觉',
  '工程',
  '原唱',
  '配唱',
  '伴唱',
  '演唱',
  '乐队',
  '调校',
  '伴奏',
  '主唱',
  '校对',
  '商务',
  '合作',
  '合唱',
  '指挥',
  '经纪',
  '团队',
  '顾问',
  '翻译',
  '厂牌',
  '分轨',
  'ISRC',
  'Bass',
  'Drum',
  'Pads',
  'Brass',
  'Cello',
  'Choir',
  'Horns',
  'Mixed',
  'Mixer',
  'Piano',
  'Synth',
  'Viola',
  'Vocal',
  'Violin',
  'Mixing',
  'String',
  'Guitar',
  'Master',
  'Chorus',
  'Record',
  'Arrange',
  'Conduct',
  'Editing',
  'Produce',
  'Strings',
  'Engineer',
  'Keyboard',
  'Mastering',
  'Recording',
  'Percussion',
  'Production',
  'Programming',
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
  if (!str || typeof str !== 'string') return true;
  const trimmed = str.trim();
  if (!trimmed) return true;

  const norm = trimmed
    .replace(/^[\s[\]()（）"'【】「」]+|[\s[\]()（）"'【】「」]+$/g, '')
    .trim();

  if (!norm) return true;

  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(norm));
}

export function isPlaceholderLyricText(rawText: string): boolean {
  if (!rawText || typeof rawText !== 'string') return true;

  const trimmed = rawText.trim();
  if (!trimmed) return true;

  if (isPlaceholderText(trimmed)) return true;

  // Remove LRC timestamp tags: [00:00.00], [00:00.000], [00:00], etc.
  // Remove YRC timestamp tags: [0,0], (0,0,0), [0,0,0]
  // Remove standard LRC metadata tags: [ti:...], [ar:...], [al:...], [by:...], [offset:...], etc.
  // Remove YRC JSON structures: {"t":0,"c":[{"tx":"..."}]}
  const withoutTags = trimmed
    .replace(/\[\d+:\d+(?:\.\d+)?\]/g, '')
    .replace(/\[\d+,\d+(?:,\d+)?\]/g, '')
    .replace(/\(\d+,\d+,\d+\)/g, '')
    .replace(/\[[a-zA-Z]+:[^\]]*\]/g, '')
    .replace(/\{"t":\d+,"c":\[\{"tx":"([^"]+)"\}\]\}/g, '$1')
    .replace(/[\r\n]+/g, '\n')
    .trim();

  if (!withoutTags) return true;

  const lines = withoutTags
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return true;

  return lines.every((line) => isPlaceholderText(line) || isCreditOrInfoLine(line));
}

function getLineText(line: CompactLyricLine): string {
  if (!Array.isArray(line)) return '';
  return line.map((w) => w[3] || '').join('').trim();
}

export function isCreditOrInfoLine(text: string, title?: string, artist?: string): boolean {
  if (!text || text.trim().length === 0) return false;

  const str = text.replace(/：/g, ': ').trim();
  const lowerStr = str.toLowerCase();

  // Check placeholder texts (e.g. "暂无歌词", "纯音乐，请欣赏", "Instrumental")
  if (isPlaceholderText(str)) {
    return true;
  }

  // Check copyright claiming sentences
  if (
    (lowerStr.includes('未经') || lowerStr.includes('未经许可')) &&
    (lowerStr.includes('不得') || lowerStr.includes('请勿') || lowerStr.includes('使用') || lowerStr.includes('授权'))
  ) {
    return true;
  }

  if (
    (lowerStr.includes('腾讯') || lowerStr.includes('tme')) &&
    lowerStr.includes('享有') &&
    lowerStr.includes('权')
  ) {
    return true;
  }

  if (
    lowerStr.startsWith('lyrics by:') ||
    lowerStr.startsWith('written by:') ||
    lowerStr.startsWith('composed by:') ||
    lowerStr.startsWith('produced by:')
  ) {
    return true;
  }

  const hasColon = str.includes(':');
  const hitKeyword = CREDIT_KEYWORDS.some((kw) => str.includes(kw));

  if (hitKeyword && hasColon) {
    // Make sure it's not speaker label (e.g. "Artist:")
    if (artist && lowerStr.startsWith(`${artist.toLowerCase()}:`)) {
      return false;
    }
    return true;
  }

  // Exact Title + Artist line check (e.g. "Title - Artist" at line 1)
  if (title && artist) {
    const cleanTitle = title.toLowerCase().trim();
    const cleanArtist = artist.toLowerCase().trim();
    if (lowerStr.includes(cleanTitle) && lowerStr.includes(cleanArtist)) {
      return true;
    }
  }

  return false;
}

export function stripInfoLines(
  payload: SyncedLyricsPayload,
  metadata?: { title?: string; artist?: string }
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
  for (let i = payload.length - 1; i >= Math.max(startIdx, payload.length - 5); i--) {
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

  // Filter out any standalone placeholder lines in the remaining body
  const filtered = sliced.filter((line) => {
    const text = getLineText(line);
    return !isPlaceholderText(text);
  });

  return filtered;
}
