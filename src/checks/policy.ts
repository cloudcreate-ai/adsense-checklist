import type { CheckCategory, CheckItem } from '../types.js';

// Basic keyword blacklist for quick screening
const BLACKLIST_PATTERNS: RegExp[] = [
  /\b(porn|xxx|nude|naked|sex\s*tube)\b/i,
  /\b(gamble|casino|betting|lottery)\b/i,
  /\b(hack|crack|pirate|torrent|warez)\b/i,
  /\b(drug|marijuana|cocaine|heroin)\b/i,
  /色情|赌博|毒品|暴力|盗版/,
];

export function checkPolicyCompliance(
  pages: Array<{ url: string; text: string }>
): CheckCategory {
  const items: CheckItem[] = [];
  const violations: Array<{ url: string; match: string }> = [];

  for (const page of pages) {
    for (const pattern of BLACKLIST_PATTERNS) {
      const match = page.text.match(pattern);
      if (match) {
        violations.push({ url: page.url, match: match[0] });
      }
    }
  }

  if (violations.length > 0) {
    const details = violations.map(v => `${v.url}: "${v.match}"`).join('; ');
    items.push({
      name: '违规关键词',
      status: 'fail',
      message: `检测到 ${violations.length} 个可疑关键词`,
      detail: details,
    });
  } else {
    items.push({
      name: '违规关键词',
      status: 'pass',
      message: '未检测到明显的违规关键词',
    });
  }

  // Check for excessive ads placeholders
  const hasAdKeywords = pages.some(p =>
    /ad[-_]?slot|google[-_]?ad|adsbygoogle|广告位/i.test(p.text)
  );
  if (hasAdKeywords) {
    items.push({
      name: '广告代码',
      status: 'warn',
      message: '页面已存在广告代码占位，确认不影响审核',
    });
  }

  return { name: 'Policy Compliance', items };
}
