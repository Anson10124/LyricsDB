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

function getLineText(line: CompactLyricLine): string {
  if (!Array.isArray(line)) return '';
  return line.map((w) => w[3] || '').join('').trim();
}

export function isCreditOrInfoLine(text: string, title?: string, artist?: string): boolean {
  if (!text || text.trim().length === 0) return false;

  const str = text.replace(/：/g, ': ').trim();
  const lowerStr = str.toLowerCase();

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
    return payload; // Fallback: don't wipe out entire song if wrongly flagged
  }

  return payload.slice(startIdx, endIdx);
}
