import type { CheckCategory, CheckItem } from '../types.js';

export function checkContentQuality(
  pages: Array<{ url: string; text: string; title: string }>
): CheckCategory {
  const items: CheckItem[] = [];

  const MIN_WORDS = 300;

  for (const page of pages) {
    const wordCount = page.text.replace(/\s+/g, '').length;
    if (pages.indexOf(page) === 0) {
      if (wordCount >= MIN_WORDS) {
        items.push({
          name: '首页内容量',
          status: 'pass',
          message: `首页文字量充足 (${wordCount.toLocaleString()} 字)`,
        });
      } else {
        items.push({
          name: '首页内容量',
          status: 'fail',
          message: `首页文字量不足 (${wordCount} 字，建议 ${MIN_WORDS}+ 字)`,
        });
      }
    } else {
      if (wordCount < MIN_WORDS) {
        items.push({
          name: `内页内容量 - ${page.url}`,
          status: 'warn',
          message: `页面文字量不足 (${wordCount} 字)`,
        });
      }
    }
  }

  // Check for duplicate content
  if (pages.length > 1) {
    const texts = pages.map(p => p.text.slice(0, 500));
    const uniqueTexts = new Set(texts);
    if (uniqueTexts.size < texts.length * 0.7) {
      items.push({
        name: '内容重复度',
        status: 'warn',
        message: '多个页面内容相似度过高，可能有采集痕迹',
      });
    } else {
      items.push({
        name: '内容重复度',
        status: 'pass',
        message: '各页面内容差异正常',
      });
    }
  }

  return { name: 'Content Quality', items };
}
