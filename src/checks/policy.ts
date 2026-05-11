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
  const violations: Array<{ url: string; match: string; hasSubstance: boolean }> = [];

  for (const page of pages) {
    for (const p of BLACKLIST) {
      const m = page.text.match(p);
      if (m) {
        const hasSubstance = page.text.replace(/\s+/g, '').length > 200;
        violations.push({ url: page.url, match: m[0], hasSubstance });
      }
    }
  }

  // If all matches are on pages with substantial content, downgrade to warn
  // (the AI compliance check understands context; keyword regex is blunt)
  const allHaveSubstance = violations.length > 0 && violations.every(v => v.hasSubstance);
  const status: 'fail' | 'warn' | 'pass' = violations.length === 0
    ? 'pass'
    : allHaveSubstance
      ? 'warn'
      : 'fail';

  items.push({
    name: t('item.policy.keywords', lang),
    status,
    message: violations.length > 0
      ? t('policy.keywords.fail', lang, { count: violations.length })
      : t('policy.keywords.pass', lang),
    detailList: violations.length > 0
      ? violations.map(v => `${new URL(v.url).pathname}: "${v.match}"`)
      : undefined,
  });

  return { name: t('cat.policy', lang), items };
}
