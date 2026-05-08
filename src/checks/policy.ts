import type { CheckCategory, CheckItem, Lang } from '../types.js';
import { t } from '../i18n.js';

const BLACKLIST = [
  /\b(porn|xxx|nude|naked|sex\s*tube)\b/i,
  /\b(gamble|casino|betting|lottery)\b/i,
  /\b(hack|crack|pirate|torrent|warez)\b/i,
  /\b(drug|marijuana|cocaine|heroin)\b/i,
  /色情|赌博|毒品|暴力|盗版/,
];

export function checkPolicyCompliance(pages: Array<{ url: string; text: string }>, lang: Lang): CheckCategory {
  const items: CheckItem[] = [];
  const violations: Array<{ url: string; match: string }> = [];

  for (const page of pages) {
    for (const p of BLACKLIST) {
      const m = page.text.match(p);
      if (m) violations.push({ url: page.url, match: m[0] });
    }
  }

  items.push(violations.length > 0
    ? { name: t('item.policy.keywords', lang), status: 'fail', message: t('policy.keywords.fail', lang, { count: violations.length }), detail: violations.map(v => `${v.url}: "${v.match}"`).join('; ') }
    : { name: t('item.policy.keywords', lang), status: 'pass', message: t('policy.keywords.pass', lang) }
  );

  return { name: t('cat.policy', lang), items };
}
