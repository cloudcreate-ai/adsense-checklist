import type { CheckCategory, CheckItem } from '../types.js';
import { checkRobotsTxt, checkSitemap } from '../browser.js';

export async function checkSiteStructure(
  origin: string,
  links: string[],
  h1Count: number,
  deadLinks: string[] = []
): Promise<CheckCategory> {
  const items: CheckItem[] = [];

  // H1 uniqueness
  if (h1Count === 1) {
    items.push({
      name: 'H1 标签',
      status: 'pass',
      message: '页面有且仅有一个 H1 标签',
    });
  } else if (h1Count === 0) {
    items.push({
      name: 'H1 标签',
      status: 'warn',
      message: '页面缺少 H1 标签',
    });
  } else {
    items.push({
      name: 'H1 标签',
      status: 'warn',
      message: `页面有 ${h1Count} 个 H1 标签（建议保留 1 个）`,
    });
  }

  // robots.txt
  const hasRobots = await checkRobotsTxt(origin);
  items.push({
    name: 'robots.txt',
    status: hasRobots ? 'pass' : 'warn',
    message: hasRobots ? 'robots.txt 存在' : '未找到 robots.txt（建议添加）',
  });

  // sitemap
  const hasSitemap = await checkSitemap(origin);
  items.push({
    name: 'sitemap.xml',
    status: hasSitemap ? 'pass' : 'warn',
    message: hasSitemap ? 'sitemap.xml 存在' : '未找到 sitemap.xml（建议添加）',
  });

  // Internal link structure
  const internalLinks = links.filter(l => {
    try {
      return new URL(l).origin === origin;
    } catch {
      return false;
    }
  });
  if (internalLinks.length >= 5) {
    items.push({
      name: '内部链接',
      status: 'pass',
      message: `首页有 ${internalLinks.length} 个内部链接`,
    });
  } else {
    items.push({
      name: '内部链接',
      status: 'warn',
      message: `首页仅 ${internalLinks.length} 个内部链接（建议增加导航链接）`,
    });
  }

  // Dead links
  if (deadLinks.length > 0) {
    items.push({
      name: '死链检测',
      status: 'fail',
      message: `检测到 ${deadLinks.length} 个死链`,
      detail: deadLinks.join(', '),
    });
  } else {
    items.push({
      name: '死链检测',
      status: 'pass',
      message: '未检测到死链',
    });
  }

  return { name: 'Site Structure', items };
}
