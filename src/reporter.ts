import chalk from 'chalk';
import figures from 'figures';
import type { CheckReport, CheckStatus, CheckCategory, PageDetail, Lang, SiteType } from './types.js';
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

function renderBar(score: number, max: number, width: number = 20): string {
  const ratio = max > 0 ? score / max : 0;
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const color = ratio >= 0.8 ? chalk.green : ratio >= 0.5 ? chalk.yellow : chalk.red;
  return color('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
}

function categoryScore(cat: CheckCategory): number {
  if (cat.items.length === 0) return 100;
  const earned = cat.items.reduce((s, i) => {
    if (i.status === 'pass') return s + 100;
    if (i.status === 'warn') return s + 40;
    return s;
  }, 0);
  return Math.round(earned / cat.items.length);
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
  ];

  // Topic info
  if (report.siteTopic) {
    lines.push(chalk.gray(`  Topic: ${report.siteTopic.topic} — ${report.siteTopic.description}`));
  }

  // Sampling info
  if (report.samplingInfo) {
    const s = report.samplingInfo;
    const confColor = s.confidence === 'high' ? chalk.green : s.confidence === 'medium' ? chalk.yellow : chalk.red;
    lines.push(chalk.gray(`  Pages: ${s.totalDiscovered} total, ${s.recentCount} recent (6mo), ${s.sampledCount} sampled (${s.samplePct}%) ${confColor(s.confidence + ' confidence')}`));
  }

  // Unsupported warning
  if (report.siteType === 'unsupported') {
    lines.push('');
    lines.push(chalk.red.bold(`  ${t('topic.unsupported_warning', lang, { type: report.siteTopic?.topic ?? 'unknown' })}`));
  }

  lines.push('');

  // Composite score
  const scoreColor = report.compositeScore >= 80 ? chalk.green.bold : report.compositeScore >= 50 ? chalk.yellow.bold : chalk.red.bold;
  lines.push(chalk.bold(`  ${t('report.composite_score', lang)}: `) + scoreColor(`${report.compositeScore}/100`));
  lines.push('');

  // ── Hard Requirements ──
  const hardColor = report.hardStatus === 'ready' ? chalk.green : report.hardStatus === 'warn' ? chalk.yellow : chalk.red;
  const hardLabel = report.hardStatus === 'ready' ? 'PASS' : report.hardStatus === 'warn' ? 'WARN' : 'FAIL';
  lines.push(chalk.bold(`  ┌─ ${t('report.hard_requirements', lang)} `) + chalk.gray('─'.repeat(Math.max(0, 40 - t('report.hard_requirements', lang).length))) + ` ${hardColor.bold(hardLabel)}`);
  for (const cat of report.hardCategories) {
    const catScore = categoryScore(cat);
    const catIcon = cat.items.every(i => i.status === 'pass') ? ICONS.pass : cat.items.some(i => i.status === 'fail') ? ICONS.fail : ICONS.warn;
    for (const item of cat.items) {
      lines.push(`  │  ${ICONS[item.status]} ${chalk.bold(item.name.padEnd(16))} ${item.message}`);
    }
  }
  const hardStatusKey = `report.hard.${report.hardStatus}` as string;
  const hardWarnCount = report.hardCategories.flatMap(c => c.items).filter(i => i.status === 'warn').length;
  const hardFailCount = report.hardCategories.flatMap(c => c.items).filter(i => i.status === 'fail').length;
  const hardStatusMsg = report.hardStatus === 'ready'
    ? t(hardStatusKey, lang)
    : t(hardStatusKey, lang, { count: report.hardStatus === 'fail' ? hardFailCount : hardWarnCount });
  lines.push(chalk.gray(`  │`));
  lines.push(`  └─ ${t('report.score', lang)}: ${hardStatusMsg}`);
  lines.push('');

  // ── Soft Scoring ──
  lines.push(chalk.bold(`  ┌─ ${t('report.soft_scoring', lang)} `) + chalk.gray('─'.repeat(Math.max(0, 40 - t('report.soft_scoring', lang).length))) + ` ${scoreColor(report.softScore + '/100')}`);
  for (const cat of report.softCategories) {
    const score = categoryScore(cat);
    const bar = renderBar(score, 100);
    const pct = `${score}%`;
    lines.push(`  │  ${bar} ${pct.padStart(4)}  ${cat.name}`);
  }
  if (report.warningPenalty > 0) {
    lines.push(chalk.gray(`  │`));
    lines.push(chalk.yellow(`  │  ⚠ ${t('report.warning_ratio', lang, { count: report.warned, total: report.totalChecks, pct: Math.round(report.warningRatio * 100) })} → ${t('report.warning_penalty', lang, { points: report.warningPenalty })}`));
  }
  lines.push(chalk.gray(`  │`));

  // Composite breakdown
  const hardContrib = Math.round(report.hardStatus === 'ready' ? 100 * 0.4 : (report.hardCategories.flatMap(c => c.items).filter(i => i.status === 'pass').length / Math.max(1, report.hardCategories.flatMap(c => c.items).length)) * 100 * 0.4);
  const softContrib = Math.round(report.softScore * 0.6);
  lines.push(chalk.gray(`  │  Hard ${Math.round(hardContrib)}% × 0.4 + Soft ${report.softScore}% × 0.6 - Penalty ${report.warningPenalty} = ${report.compositeScore}`));
  lines.push(chalk.gray(`  └─`));
  lines.push('');

  // Category score breakdown (bars)
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

  // Summary line
  if (report.hardStatus === 'fail') {
    lines.push(chalk.red.bold(`  ${t('report.notready', lang, { count: hardFailCount })}`));
  } else if (report.hardStatus === 'warn') {
    lines.push(chalk.yellow.bold(`  ${t('report.hard.warn', lang, { count: hardWarnCount })}`));
  } else if (report.warned > 0) {
    lines.push(chalk.yellow.bold(`  ${t('report.mostly', lang, { count: report.warned })}`));
  } else {
    lines.push(chalk.green.bold(`  ${t('report.ready', lang)}`));
  }

  // AI suggestion when AI is not enabled
  const hasAi = report.categories.some(c => c.group === 'soft' && c.name.includes('AI'));
  if (!hasAi) {
    lines.push('');
    lines.push(chalk.cyan(`  💡 ${t('ai.suggest_enable', lang)}`));
  }

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
