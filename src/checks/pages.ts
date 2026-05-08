import type { CheckCategory, CheckItem } from '../types.js';

interface PageMatch {
  name: string;
  required: boolean;
  patterns: RegExp[];
}

const REQUIRED_PAGES: PageMatch[] = [
  {
    name: 'About',
    required: true,
    patterns: [/about[- _]?(us)?/i, /关于我们/, /公司介绍/, /关于/],
  },
  {
    name: 'Privacy Policy',
    required: true,
    patterns: [/privacy[- _]?policy/i, /隐私政策/, /隐私声明/, /隐私条款/],
  },
  {
    name: 'Contact',
    required: true,
    patterns: [/contact/i, /联系我们/, /联系方式/, /联系/],
  },
  {
    name: 'Terms of Service',
    required: false,
    patterns: [/terms[- _]?(of[- _]?)?service/i, /terms[- _]?and[- _]?conditions/i, /服务条款/, /使用条款/],
  },
];

export function checkRequiredPages(
  links: string[],
  navText: string
): CheckCategory {
  const items: CheckItem[] = [];
  const allText = links.join('\n') + '\n' + navText;

  for (const page of REQUIRED_PAGES) {
    const found = page.patterns.some(p => p.test(allText));
    if (found) {
      items.push({
        name: `${page.name} 页面`,
        status: 'pass',
        message: `找到 ${page.name} 页面`,
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
