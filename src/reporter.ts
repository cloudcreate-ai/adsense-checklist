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
    const isAiCat = cat.name.includes('AI') || cat.name.includes('ai');
    const score = isAiCat && report.siteAiScore > 0 ? report.siteAiScore : categoryScore(cat);
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
  if (report.siteAiScore > 0) {
    lines.push(chalk.gray(`  │  AI Value Score: ${report.siteAiScore}/100 (geometric mean × page-type weights)`));
  }
  if (report.aiDimensionAverages) {
    const d = report.aiDimensionAverages;
    const dimColor = (v: number) => v >= 8 ? chalk.green : v >= 5 ? chalk.yellow : chalk.red;
    lines.push(chalk.gray(`  │  AI Dimensions: `) +
      `${dimColor(d.value)('Value ' + d.value)} ` +
      `${dimColor(d.originality)('Originality ' + d.originality)} ` +
      `${dimColor(d.relevance)('Relevance ' + d.relevance)} ` +
      `${dimColor(d.compliance)('Compliance ' + d.compliance)} ` +
      chalk.gray('(avg /10)')
    );
  }
  lines.push(chalk.gray(`  └─`));
  lines.push('');

  // Category score breakdown (bars)
  if (report.categoryScores.length > 0) {
    for (const cs of report.categoryScores) {
      const isAiCat = cs.name.includes('AI') || cs.name.includes('ai');
      const pct = isAiCat && report.siteAiScore > 0
        ? report.siteAiScore
        : (cs.maxScore > 0 ? Math.round((cs.score / cs.maxScore) * 100) : 0);
      const bar = renderBar(pct, 100);
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
  const hasAi = report.categories.some(c => c.group === 'soft' && (c.name.includes('AI') || c.name.includes('ai')));
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
  video_detail: chalk.cyan('V'),
  reference_detail: chalk.magenta('R'),
  reference_listing: chalk.magenta('r'),
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

// ─── Markdown report ───────────────────────────────────────────────

const MD_ICONS: Record<CheckStatus, string> = {
  pass: '✅',
  warn: '⚠️',
  fail: '❌',
  skip: '⏭️',
};

export function renderMarkdownReport(report: CheckReport): string {
  const lines: string[] = [];
  const lang = report.lang;
  const typeKey = `detector.type.${report.siteType}`;
  const typeLabel = t(typeKey, lang);

  lines.push(`# AdSense 审核报告`);
  lines.push('');
  lines.push(`| 项目 | 值 |`);
  lines.push(`|------|-----|`);
  lines.push(`| URL | ${report.url} |`);
  lines.push(`| 时间 | ${report.timestamp} |`);
  lines.push(`| 站点类型 | ${typeLabel} (${report.siteTypeConfidence}) |`);
  if (report.siteTopic) {
    lines.push(`| 主题 | ${report.siteTopic.topic} |`);
    lines.push(`| 描述 | ${report.siteTopic.description} |`);
  }
  if (report.samplingInfo) {
    const s = report.samplingInfo;
    lines.push(`| 抽样 | ${s.totalDiscovered} total, ${s.recentCount} recent (6mo), ${s.sampledCount} sampled (${s.samplePct}%, ${s.confidence}) |`);
  }
  lines.push('');

  // Composite score
  lines.push(`## 综合评分: ${report.compositeScore}/100`);
  lines.push('');

  // Hard requirements
  const hardFailCount = report.hardCategories.flatMap(c => c.items).filter(i => i.status === 'fail').length;
  const hardWarnCount = report.hardCategories.flatMap(c => c.items).filter(i => i.status === 'warn').length;
  const hardLabel = report.hardStatus === 'ready' ? '✅ PASS' : report.hardStatus === 'warn' ? '⚠️ WARN' : '❌ FAIL';
  lines.push(`### 硬性要求 ${hardLabel}`);
  lines.push('');
  for (const cat of report.hardCategories) {
    for (const item of cat.items) {
      lines.push(`- ${MD_ICONS[item.status]} **${item.name}**: ${item.message}`);
      if (item.detail) lines.push(`  - ${item.detail}`);
    }
  }
  lines.push('');

  // Soft scoring
  lines.push(`### 柔性评分 ${report.softScore}/100`);
  lines.push('');
  for (const cat of report.softCategories) {
    const isAiCat = cat.name.includes('AI') || cat.name.includes('ai');
    const score = isAiCat && report.siteAiScore > 0 ? report.siteAiScore : categoryScore(cat);
    lines.push(`- **${cat.name}**: ${score}%`);
    for (const item of cat.items) {
      lines.push(`  - ${MD_ICONS[item.status]} ${item.name}: ${item.message}`);
      if (item.detail) lines.push(`    - ${item.detail}`);
    }
  }
  lines.push('');

  // AI value breakdown
  if (report.aiDimensionAverages) {
    const d = report.aiDimensionAverages;
    lines.push(`### AI 价值分析`);
    lines.push('');
    lines.push(`| 维度 | 均分 |`);
    lines.push(`|------|------|`);
    lines.push(`| Value（价值） | ${d.value}/10 |`);
    lines.push(`| Originality（原创） | ${d.originality}/10 |`);
    lines.push(`| Relevance（相关） | ${d.relevance}/10 |`);
    lines.push(`| Compliance（合规） | ${d.compliance}/10 |`);
    lines.push('');
    lines.push(`**站点 AI 评分**: ${report.siteAiScore}/100（几何均值 × 页面类型加权）`);
    lines.push('');
  }

  // Composite formula
  const hardContrib = Math.round(report.hardStatus === 'ready' ? 100 * 0.4 : (report.hardCategories.flatMap(c => c.items).filter(i => i.status === 'pass').length / Math.max(1, report.hardCategories.flatMap(c => c.items).length)) * 100 * 0.4);
  lines.push(`> Hard ${Math.round(hardContrib)}% × 0.4 + Soft ${report.softScore}% × 0.6 - Penalty ${report.warningPenalty} = ${report.compositeScore}`);
  lines.push('');

  // Page details
  if (report.pages.length > 0) {
    lines.push(`### 逐页详情 (${report.pages.length} pages)`);
    lines.push('');

    const problems = report.pages.filter(p => p.contentStatus !== 'pass' || p.issues.length > 0 || (p.ai && p.ai.status !== 'pass'));
    const ok = report.pages.filter(p => p.contentStatus === 'pass' && p.issues.length === 0 && (!p.ai || p.ai.status === 'pass'));

    // Table header
    lines.push(`| 状态 | 类型 | 路径 | 评分 | 正文比 | V | O | R | C | AI综合 | 标题 |`);
    lines.push(`|------|------|------|------|--------|---|---|---|---|--------|------|`);

    for (const p of [...problems, ...ok]) {
      const path = (() => { try { const u = new URL(p.url); return u.pathname + u.search; } catch { return p.url; } })();
      const status = MD_ICONS[p.contentStatus];
      const ai = p.ai;
      const v = ai?.valueScore != null ? ai.valueScore : '-';
      const o = ai?.originalityScore != null ? ai.originalityScore : '-';
      const r = ai?.relevanceScore != null ? ai.relevanceScore : '-';
      const c = ai?.complianceScore != null ? ai.complianceScore : '-';
      const aiComposite = (ai?.valueScore != null && ai?.originalityScore != null && ai?.relevanceScore != null && ai?.complianceScore != null)
        ? Math.round(Math.pow(ai.valueScore * ai.originalityScore * ai.relevanceScore * ai.complianceScore, 0.25) * 10)
        : '-';
      lines.push(`| ${status} | ${p.pageType} | [\`${path}\`](${p.url}) | ${p.score}/100 | ${p.contentRatio}% | ${v} | ${o} | ${r} | ${c} | ${aiComposite} | ${p.title} |`);
    }
    lines.push('');

    // Detailed issues for problem pages
    const detailPages = problems.filter(p => p.issues.length > 0 || (p.ai && p.ai.status !== 'pass'));
    if (detailPages.length > 0) {
      lines.push(`#### 问题页面详情`);
      lines.push('');
      for (const p of detailPages) {
        const path = (() => { try { const u = new URL(p.url); return u.pathname + u.search; } catch { return p.url; } })();
        lines.push(`**[${path}](${p.url})** (mechanical: ${p.score}/100)`);
        lines.push('');
        for (const issue of p.issues) lines.push(`- ⚠️ ${issue}`);
        if (p.ai) {
          const ai = p.ai;
          lines.push(`- AI 状态: ${MD_ICONS[ai.status]} ${ai.status}`);
          if (ai.valueScore != null) {
            lines.push(`- 四维评分: **Value ${ai.valueScore}** | **Originality ${ai.originalityScore}** | **Relevance ${ai.relevanceScore}** | **Compliance ${ai.complianceScore}**`);
            const geoMean = Math.round(Math.pow((ai.valueScore ?? 5) * (ai.originalityScore ?? 5) * (ai.relevanceScore ?? 5) * (ai.complianceScore ?? 5), 0.25) * 10);
            lines.push(`- AI 综合分: ${geoMean}/100（几何均值）`);
          }
          lines.push(`- 评估: ${ai.assessment}`);
          if (ai.suggestions.length > 0) {
            lines.push(`- 改进建议:`);
            for (const s of ai.suggestions.slice(0, 3)) lines.push(`  - ${s}`);
          }
        }
        lines.push('');
      }
    }
  }

  // Summary
  if (report.hardStatus === 'fail') {
    lines.push(`**❌ NOT READY** — ${hardFailCount} 项失败需要修复`);
  } else if (report.hardStatus === 'warn') {
    lines.push(`**⚠️ NEEDS FIXES** — ${hardWarnCount} 项警告待修复`);
  } else if (report.warned > 0) {
    lines.push(`**⚠️ MOSTLY READY** — 修复 ${report.warned} 项警告后可提交`);
  } else {
    lines.push(`**✅ READY** — 可以提交 AdSense 审核`);
  }
  lines.push('');

  return lines.join('\n');
}
