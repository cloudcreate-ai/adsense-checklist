import type { CheckCategory, CheckItem } from '../types.js';

interface PageMatch {
  name: string;
  required: boolean;
  // Match against URL path
  urlPatterns: RegExp[];
  // Match against visible link text
  textPatterns: RegExp[];
  // Match against page title (from sitemap or visited page)
  titlePatterns: RegExp[];
  // Content keywords to verify page content (visited page)
  contentPatterns: RegExp[];
}

const REQUIRED_PAGES: PageMatch[] = [
  {
    name: 'About',
    required: true,
    urlPatterns: [/\/about/i, /about[- _]?(us)?/i, /关于我们/, /公司介绍/, /关于/],
    textPatterns: [/about/i, /关于我们/, /公司介绍/, /关于/],
    titlePatterns: [/about/i, /关于/],
    contentPatterns: [/about/i, /关于我们/, /公司简介/, /团队/, /our (story|team|mission)/i],
  },
  {
    name: 'Privacy Policy',
    required: true,
    urlPatterns: [/\/privacy/i, /privacy[- _]?policy/i, /隐私政策/, /隐私声明/, /隐私条款/],
    textPatterns: [/privacy/i, /隐私/, /cookie policy/i],
    titlePatterns: [/privacy/i, /隐私/],
    contentPatterns: [/privacy/i, /隐私/, /personal data/i, /个人信息/, /data (collection|use|protect)/i],
  },
  {
    name: 'Contact',
    required: true,
    urlPatterns: [/\/contact/i, /contact/i, /联系我们/, /联系方式/, /联系/],
    textPatterns: [/contact/i, /联系我们/, /联系方式/, /联系/, /support/i, /help/i],
    titlePatterns: [/contact/i, /联系/, /support/],
    contentPatterns: [/contact/i, /联系/, /email/i, /邮箱/, /电话/, /address/i],
  },
  {
    name: 'Terms of Service',
    required: false,
    urlPatterns: [/\/terms/i, /terms[- _]?(of[- _]?)?service/i, /terms[- _]?and[- _]?conditions/i, /服务条款/, /使用条款/],
    textPatterns: [/terms/i, /服务条款/, /使用条款/, /legal/i],
    titlePatterns: [/terms/i, /条款/, /service agreement/i],
    contentPatterns: [/terms/i, /条款/, /agreement/i, /条款/, /governing law/i, /适用法律/],
  },
];

interface LinkInfo {
  href: string;
  text: string;
}

interface PageDetectInput {
  allLinks: LinkInfo[];
  navText: string;
  footerText: string;
  sitemapUrls: string[];
}

export async function checkRequiredPages(
  input: PageDetectInput
): Promise<CheckCategory> {
  const items: CheckItem[] = [];
  const { allLinks, navText, footerText, sitemapUrls } = input;

  // Build searchable text from all link texts and hrefs
  const linkTexts = allLinks.map(l => l.text).join('\n');
  const linkHrefs = allLinks.map(l => l.href).join('\n');
  const allText = [linkTexts, linkHrefs, navText, footerText, sitemapUrls.join('\n')].join('\n');

  for (const page of REQUIRED_PAGES) {
    let found = false;
    let foundUrl = '';

    // 1. Check URL patterns against all links and sitemap
    for (const pattern of page.urlPatterns) {
      const linkMatch = allLinks.find(l => pattern.test(l.href));
      if (linkMatch) {
        found = true;
        foundUrl = linkMatch.href;
        break;
      }
      const sitemapMatch = sitemapUrls.find(u => pattern.test(u));
      if (sitemapMatch) {
        found = true;
        foundUrl = sitemapMatch;
        break;
      }
    }

    // 2. Check visible text patterns against link text
    if (!found) {
      for (const pattern of page.textPatterns) {
        const linkMatch = allLinks.find(l => pattern.test(l.text));
        if (linkMatch) {
          found = true;
          foundUrl = linkMatch.href;
          break;
        }
      }
    }

    // 3. Check title patterns against sitemap URLs (path segments)
    if (!found) {
      for (const pattern of page.titlePatterns) {
        const sitemapMatch = sitemapUrls.find(u => {
          const path = new URL(u).pathname;
          return pattern.test(path);
        });
        if (sitemapMatch) {
          found = true;
          foundUrl = sitemapMatch;
          break;
        }
      }
    }

    if (found) {
      items.push({
        name: `${page.name} 页面`,
        status: 'pass',
        message: `找到 ${page.name} 页面${foundUrl ? ` (${new URL(foundUrl).pathname})` : ''}`,
      });
    } else if (page.required) {
      items.push({
        name: `${page.name} 页面`,
        status: 'fail',
        message: `未找到 ${page.name} 页面（必需）`,
      });
    } else {
      items.push({
        name: `${page.name} 页面`,
        status: 'warn',
        message: `未找到 ${page.name} 页面（建议添加）`,
      });
    }
  }

  return { name: 'Required Pages', items };
}
