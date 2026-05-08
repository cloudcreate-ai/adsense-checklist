import chalk from 'chalk';
import figures from 'figures';
import type { CheckReport, CheckStatus, PageDetail, Lang, SiteType } from './types.js';
import { t } from './i18n.js';

const ICONS: Record<CheckStatus, string> = {
  pass: chalk.green(figures.tick),
  warn: chalk.yellow(figures.warning),
  fail: chalk.red(figures.cross),
  skip: chalk.gray('-'),
};

const LABELS: Record<CheckStatus, string> = {
  pass: chalk.green('PASS'),
  warn: chalk.yellow('WARN'),
  fail: chalk.red('FAIL'),
  skip: chalk.gray('SKIP'),
};

function summary(report: CheckReport): string {
  const lang = report.lang;
  if (report.failed > 0) return chalk.red.bold(t('report.notready', lang, { count: report.failed }));
  if (report.warned > 0) return chalk.yellow.bold(t('report.mostly', lang, { count: report.warned }));
  return chalk.green.bold(t('report.ready', lang));
}

function renderBar(score: number, max: number, width: number = 20): string {
  const ratio = max > 0 ? score / max : 0;
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const color = ratio >= 0.8 ? chalk.green : ratio >= 0.5 ? chalk.yellow : chalk.red;
  return color('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
}

export function renderTerminalReport(report: CheckReport): string {
  const lang = report.lang;
  const typeKey = `detector.type.${report.siteType}` as string;
  const typeLabel = t(typeKey, lang);
  const confidenceLabel = report.siteTypeConfidence === 'high' ? '' : ` (${report.siteTypeConfidence})`;

  const lines: string[] = [
    '',
    chalk.bold.cyan(`  ${t('report.title', lang)}`),
    chalk.gray(`  URL: ${report.url}`),
    chalk.gray(`  Time: ${report.timestamp}`),
    chalk.gray(`  Site type: ${typeLabel}${confidenceLabel}`),
    '',
  ];

  // Composite score
  const scoreColor = report.compositeScore >= 80 ? chalk.green.bold : report.compositeScore >= 50 ? chalk.yellow.bold : chalk.red.bold;
  lines.push(chalk.bold(`  ${t('report.composite_score', lang)}: `) + scoreColor(`${report.compositeScore}/100`));
  lines.push('');

  // Category score breakdown
  if (report.categoryScores.length > 0) {
    for (const cs of report.categoryScores) {
      const bar = renderBar(cs.score, cs.maxScore);
      const pct = cs.maxScore > 0 ? Math.round((cs.score / cs.maxScore) * 100) : 0;
      lines.push(`    ${bar} ${pct}%  ${cs.name}`);
    }
    lines.push('');
  }

  // Detailed checks
  for (const cat of report.categories) {
    lines.push(chalk.bold(`  ${cat.name}`));
    for (const item of cat.items) {
      lines.push(`    ${ICONS[item.status]} [${LABELS[item.status]}] ${item.message}`);
      if (item.detail) lines.push(chalk.gray(`         ${item.detail}`));
    }
    lines.push('');
  }

  // Page details
  if (report.pages.length > 0) {
    lines.push(chalk.bold(`  ${t('report.page_details', lang)}`));
    lines.push(chalk.gray(`  (${t('report.pages', lang, { count: report.pages.length })})`));
    lines.push('');

    const problems = report.pages.filter(p => p.contentStatus !== 'pass' || p.issues.length > 0 || (p.ai && p.ai.status !== 'pass'));
    const ok = report.pages.filter(p => p.contentStatus === 'pass' && p.issues.length === 0 && (!p.ai || p.ai.status === 'pass'));

    for (const p of problems) renderPage(lines, p, lang);
    if (ok.length > 0) lines.push(chalk.gray(`    ${t('report.pages_ok', lang, { count: ok.length })}`));
    lines.push('');
  }

  lines.push(chalk.bold(`  ${t('report.score', lang)}: `) + `${report.score}/${report.totalChecks}`);
  lines.push(`  ${summary(report)}`);
  lines.push('');
  return lines.join('\n');
}

const PAGE_TYPE_ICONS: Record<string, string> = {
  homepage: chalk.cyan('*'),
  content: chalk.green('A'),
  game_detail: chalk.blue('G'),
  required: chalk.yellow('!'),
  listing: chalk.gray('L'),
  utility: chalk.gray('#'),
  unknown: chalk.gray('?'),
};

function renderPage(lines: string[], page: PageDetail, lang: Lang) {
  const path = (() => { try { return new URL(page.url).pathname; } catch { return page.url; } })();
  const ratioColor = page.contentRatio >= 50 ? chalk.green : page.contentRatio >= 30 ? chalk.yellow : chalk.red;
  const scoreColor = page.score >= 80 ? chalk.green : page.score >= 50 ? chalk.yellow : chalk.red;
  const typeIcon = PAGE_TYPE_ICONS[page.pageType] || chalk.gray('?');
  lines.push(`    ${ICONS[page.contentStatus]} ${typeIcon} ${chalk.bold(path)} ${scoreColor(page.score + '/100')}`);
  lines.push(chalk.gray(`       ${page.title}`));
  lines.push(`       ${t('report.content_label', lang)} ${ratioColor(page.contentRatio + '%')} (${page.contentChars}/${page.totalChars})`);
  for (const issue of page.issues) lines.push(chalk.yellow(`       ! ${issue}`));
  if (page.ai) {
    lines.push(`       ${ICONS[page.ai.status]} AI: ${truncate(page.ai.assessment, 80)}`);
    for (const s of page.ai.suggestions.slice(0, 2)) lines.push(chalk.gray(`         -> ${truncate(s, 70)}`));
  }
  lines.push('');
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '...' : s;
}

export function renderJsonReport(report: CheckReport): string {
  return JSON.stringify(report, null, 2);
}
