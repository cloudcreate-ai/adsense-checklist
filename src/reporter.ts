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
    lines.push(chalk.gray(`  ${t('reporter.topic', lang)}: ${report.siteTopic.topic} — ${report.siteTopic.description}`));
    if (report.siteTopic.metaIncomplete) {
      lines.push(chalk.yellow(`  ⚠ ${t('topic.meta_incomplete', lang)}`));
    }
    if (report.siteTopic.metaSuggestions && report.siteTopic.metaSuggestions.length > 0) {
      for (const s of report.siteTopic.metaSuggestions) {
        lines.push(chalk.yellow(`    → ${s}`));
      }
    }
  }

  // Pages analyzed
  if (report.samplingInfo) {
    const s = report.samplingInfo as Record<string, unknown>;
    const confColor = s.confidence === 'high' ? chalk.green : s.confidence === 'medium' ? chalk.yellow : chalk.red;
    if (typeof s.pagesAnalyzed === 'number') {
      const aiPart = typeof s.aiAnalyzed === 'number' && s.aiAnalyzed > 0 ? `, ${s.aiAnalyzed} AI-analyzed` : '';
      lines.push(chalk.gray(`  ${t('reporter.pages_label', lang)}: ${s.pagesAnalyzed} ${aiPart}, ${confColor(t('reporter.confidence', lang, { confidence: String(s.confidence) }))}`));
    } else {
      // Backward compat for old format
      const aiPart = typeof s.aiAnalyzed === 'number' && s.aiAnalyzed > 0 ? `, ${s.aiAnalyzed} AI` : '';
      lines.push(chalk.gray(`  ${t('reporter.pages_label', lang)}: ${(s.sampledCount as number) ?? (s.pagesAnalyzed as number) ?? '?'} analyzed${aiPart}, ${confColor(t('reporter.confidence', lang, { confidence: String(s.confidence) }))}`));
    }
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

  // Review verdict
  const hardWarnCount = report.hardCategories.flatMap(c => c.items).filter(i => i.status === 'warn').length;
  const hardFailCount = report.hardCategories.flatMap(c => c.items).filter(i => i.status === 'fail').length;

  // When AI assessment is available, use the lowest probability to inform verdict
  const aiProb = report.expertSummary?.probability ?? report.fastSummary?.probability ?? null;
  const aiLow = aiProb !== null && aiProb < 70;

  let verdict: string;
  if (report.hardStatus === 'fail') {
    verdict = chalk.red.bold(`  NOT READY — ${hardFailCount} ${t('report.verdict_fail_suffix', lang)}`);
  } else if (report.hardStatus === 'warn') {
    verdict = chalk.yellow.bold(`  NEEDS FIXES — ${hardWarnCount} ${t('report.verdict_warn_suffix', lang)}`);
  } else if (aiLow) {
    // Hard checks pass but AI flags content quality issues
    verdict = chalk.yellow.bold(`  NEEDS FIXES — ${t('report.verdict.ai_quality', lang)}`);
  } else if (report.warned > 0) {
    verdict = chalk.yellow.bold(`  MOSTLY READY — ${t('report.mostly', lang, { count: report.warned }).replace(/^MOSTLY READY — /, '')}`);
  } else {
    verdict = chalk.green.bold(`  ${t('report.ready', lang)}`);
  }
  lines.push(chalk.bold(`  ${t('report.verdict_title', lang)}`));
  lines.push(verdict);
  lines.push('');

  // ── Approval Probability ──
  const est = report.approvalEstimate;
  const fast = report.fastSummary;
  const exp = report.expertSummary;
  if (est || fast || exp) {
    const bestProb = exp?.probability ?? fast?.probability ?? est?.probability ?? 0;
    const probColor = bestProb >= 70 ? chalk.green : bestProb >= 40 ? chalk.yellow : chalk.red;
    lines.push(chalk.bold(`  ${t('report.approval_title', lang)}`));

    if (est) {
      const confLabel = t('report.approval_confidence', lang, { level: t(`conf.${est.confidence}`, lang) });
      lines.push(`  ${t('report.approval_mechanical', lang)}: ${probColor(t('report.approval_prob', lang, { prob: est.probability }))} (${chalk.gray(confLabel)})`);
      if (est.keyFactors.length > 0) {
        lines.push(`  ${est.keyFactors.slice(0, 3).map(f => chalk.gray(`    · ${f}`)).join('\n')}`);
      }
    }

    if (fast) {
      lines.push(`  ${t('report.approval_fast', lang)}: ${probColor(t('report.approval_prob', lang, { prob: fast.probability }))} (${chalk.gray(fast.modelName)}) — ${chalk.gray(fast.detailedSummary.length > 60 ? fast.detailedSummary.slice(0, 57) + '...' : fast.detailedSummary)}`);
    }

    if (exp) {
      lines.push(`  ${t('report.approval_expert', lang)}: ${probColor(t('report.approval_prob', lang, { prob: exp.probability }))} (${chalk.gray(exp.modelName)}) — ${chalk.gray(exp.detailedSummary.length > 60 ? exp.detailedSummary.slice(0, 57) + '...' : exp.detailedSummary)}`);
    }

    lines.push('');
  }

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
  const hardPassRate = report.hardStatus === 'ready' ? 100 : Math.round(report.hardCategories.flatMap(c => c.items).filter(i => i.status === 'pass').length / Math.max(1, report.hardCategories.flatMap(c => c.items).length) * 100);
  lines.push(chalk.gray(`  │  ${t('reporter.formula_label_geo', lang, { hardPct: hardPassRate, softPct: report.softScore, penalty: report.warningPenalty, total: report.compositeScore })}`));
  if (report.siteAiScore > 0) {
    lines.push(chalk.gray(`  │  ${t('reporter.ai_value_label', lang)}: ${report.siteAiScore}/100 (${t('reporter.ai_value_note', lang)})`));
  }
  if (report.aiDimensionAverages) {
    const d = report.aiDimensionAverages as Record<string, number>;
    const dimColor = (v: number) => v >= 8 ? chalk.green : v >= 5 ? chalk.yellow : chalk.red;
    const dimLabel = (key: string, v: number) => `${t(`reporter.dim_${key}`, lang)} ${v}/10`;
    const parts = Object.entries(d).map(([key, val]) => dimColor(val)(dimLabel(key, val)));
    lines.push(chalk.gray(`  │  ${t('reporter.ai_dimensions', lang)}: `) +
      parts.join(' ') +
      ` ${chalk.gray(`(${t('reporter.avg_per_10', lang)})`)}`
    );
  }
  if (report.aiDimensionStats) {
    const s = report.aiDimensionStats as Record<string, { avg: number; min: number; lowCount: number; lowPct: number }>;
    const totalPages = report.pages.length;
    lines.push(chalk.gray(`  │  ${t('reporter.dim_stats_label', lang)}:`));
    for (const [key, dim] of Object.entries(s)) {
      const c = dim.min < 4 ? chalk.red : dim.min < 6 ? chalk.yellow : chalk.green;
      const lowText = dim.lowCount > 0 ? chalk.red(`  ${dim.lowCount}/${totalPages}, ${dim.lowPct}%`) : '';
      lines.push(chalk.gray(`  │    ${c(`${t(`reporter.dim_${key}`, lang)} ${t('reporter.dim_avg_label', lang)}${dim.avg} ${t('reporter.dim_min_label', lang)}${dim.min}`)}`) + lowText);
    }
  }
  lines.push(chalk.gray(`  └─`));
  lines.push('');

  // Detailed checks — show landing page category first, then soft categories
  // Hard categories are already shown in the "硬性要求" box above
  const landingCat = report.categories.find(c => c.name.includes('落地页') || c.name.includes('Landing'));
  const softCats = report.categories.filter(c => c.group === 'soft' && !(c.name.includes('落地页') || c.name.includes('Landing')));
  const orderedCats = landingCat ? [landingCat, ...softCats] : softCats;
  for (const cat of orderedCats) {
    lines.push(chalk.bold(`  ${cat.name}`));
    for (const item of cat.items) {
      lines.push(`    ${ICONS[item.status]} [${LABELS[item.status]}] ${item.message}`);
      if (item.detail) lines.push(chalk.gray(`         ${item.detail}`));
      if (item.detailList) {
        for (const d of item.detailList) lines.push(chalk.gray(`       • ${d}`));
      }
    }
    lines.push('');
  }

  // Page details — group by page type
  if (report.pages.length > 0) {
    lines.push(chalk.bold(`  ${t('report.page_details', lang)}`));
    lines.push(chalk.gray(`  (${t('report.pages', lang, { count: report.pages.length })})`));
    lines.push('');

    const typeOrder = ['homepage', 'listing', 'reference_listing', 'content', 'game_detail', 'video_detail', 'reference_detail', 'required', 'utility', 'unknown'];
    const typeLabels: Record<string, string> = {
      homepage: '🏠 首页',
      listing: '📋 列表页',
      reference_listing: '📋 参考列表',
      content: '📝 内容页',
      game_detail: '🎮 游戏详情页',
      video_detail: '📺 视频详情页',
      reference_detail: '📚 参考详情页',
      required: '📄 必要页面',
      utility: '🔧 实用页面',
      unknown: '❓ 未知类型',
    };

    const grouped = new Map<string, PageDetail[]>();
    for (const p of report.pages) {
      const type = p.pageType || 'unknown';
      if (!grouped.has(type)) grouped.set(type, []);
      grouped.get(type)!.push(p);
    }

    for (const type of typeOrder) {
      const pages = grouped.get(type);
      if (!pages || pages.length === 0) continue;
      const label = typeLabels[type] || type;
      lines.push(chalk.bold(`  ${label} (${pages.length})`));
      for (const p of pages) renderPage(lines, p, lang);
      lines.push('');
    }
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
  const langTag = page.pageLanguage && page.pageLanguage !== 'en' ? chalk.dim(`[${page.pageLanguage.toUpperCase()}] `) : '';
  const aiComposite = (page.ai?.valueScore != null && page.ai?.originalityScore != null && page.ai?.relevanceScore != null && page.ai?.complianceScore != null && page.ai?.translationScore != null)
    ? Math.round(Math.pow(page.ai.valueScore * page.ai.originalityScore * page.ai.relevanceScore * page.ai.complianceScore * page.ai.translationScore, 0.2) * 10)
    : null;
  const aiColor = aiComposite != null ? (aiComposite >= 70 ? chalk.green : aiComposite >= 40 ? chalk.yellow : chalk.red) : null;
  const aiScoreText = aiColor ? aiColor(`AI ${aiComposite}/100`) : null;
  const scoreLabels = aiComposite != null
    ? `${t('reporter.mechanical_label', lang)}: ${scoreColor(page.score + '/100')} | ${t('reporter.advanced_label', lang)}: ${aiScoreText}`
    : `${t('reporter.mechanical_label', lang)}: ${scoreColor(page.score + '/100')}`;
  lines.push(`    ${ICONS[page.contentStatus]} ${typeIcon} ${langTag}${chalk.bold(path)} ${scoreLabels}`);
  lines.push(chalk.gray(`       ${page.title}`));
  lines.push(`       ${t('report.content_label', lang)} ${ratioColor(page.contentRatio + '%')} (${page.contentChars}/${page.totalChars})`);
  for (const issue of page.issues) lines.push(chalk.yellow(`       ! ${issue}`));
  if (page.ai) {
    const d = page.ai;
    const dimStr = (key: string, v: number) => {
      const c = v >= 8 ? chalk.green : v >= 5 ? chalk.yellow : chalk.red;
      return c(`${key}(${v})`);
    };
    const dims = [
      dimStr('V', d.valueScore ?? 5),
      dimStr('O', d.originalityScore ?? 5),
      dimStr('R', d.relevanceScore ?? 5),
      dimStr('C', d.complianceScore ?? 5),
      dimStr('T', d.translationScore ?? 5),
    ].join(' ');
    lines.push(`       ${ICONS[d.status]} AI: ${dims}`);
    lines.push(`       ${truncate(d.assessment, 120)}`);
    for (const s of d.suggestions.slice(0, 2)) lines.push(chalk.gray(`         -> ${truncate(s, 70)}`));
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

  lines.push(`# ${t('md.report_title', lang)}`);
  lines.push('');
  lines.push(`| ${t('md.table.project', lang)} | ${t('md.table.value', lang)} |`);
  lines.push(`|------|-----|`);
  lines.push(`| ${t('md.table.url', lang)} | ${report.url} |`);
  lines.push(`| ${t('md.table.time', lang)} | ${report.timestamp} |`);
  lines.push(`| ${t('md.table.site_type', lang)} | ${typeLabel} (${report.siteTypeConfidence}) |`);
  if (report.siteTopic) {
    lines.push(`| ${t('md.table.topic', lang)} | ${report.siteTopic.topic} |`);
    lines.push(`| ${t('md.table.description', lang)} | ${report.siteTopic.description} |`);
    if (report.siteTopic.metaIncomplete) {
      lines.push(`| ${t('md.table.meta_incomplete', lang)} | ⚠ ${t('topic.meta_incomplete', lang)} |`);
    }
    if (report.siteTopic.metaSuggestions && report.siteTopic.metaSuggestions.length > 0) {
      lines.push(`| ${t('md.table.meta_suggestions', lang)} | <ul>${report.siteTopic.metaSuggestions.map(s => `<li>${s}</li>`).join('')}</ul> |`);
    }
  }
  if (report.samplingInfo) {
    const s = report.samplingInfo as Record<string, unknown>;
    if (typeof s.pagesAnalyzed === 'number') {
      const aiPart = typeof s.aiAnalyzed === 'number' && s.aiAnalyzed > 0 ? `, ${s.aiAnalyzed} ${t('md.table.ai_analyzed', lang)}` : '';
      lines.push(`| ${t('md.table.pages', lang)} | ${s.pagesAnalyzed}${aiPart}, ${s.confidence} ${t('md.table.confidence', lang)} |`);
    } else {
      // Backward compat for old format
      lines.push(`| ${t('md.table.pages', lang)} | ${s.sampledCount ?? s.pagesAnalyzed ?? '?'} analyzed, ${s.confidence} ${t('md.table.confidence', lang)} |`);
    }
  }
  lines.push('');

  // Composite score
  lines.push(`## ${t('md.composite_score_title', lang)}: ${report.compositeScore}/100`);
  lines.push('');

  // Review verdict
  const hardFailCount = report.hardCategories.flatMap(c => c.items).filter(i => i.status === 'fail').length;
  const hardWarnCount = report.hardCategories.flatMap(c => c.items).filter(i => i.status === 'warn').length;
  lines.push(`## ${t('md.verdict_title', lang)}`);
  lines.push('');
  if (report.hardStatus === 'fail') {
    lines.push(t('md.summary.not_ready', lang, { count: hardFailCount }));
  } else if (report.hardStatus === 'warn') {
    lines.push(t('md.summary.needs_fixes', lang, { count: hardWarnCount }));
  } else if (report.warned > 0) {
    lines.push(t('md.summary.mostly_ready', lang, { count: report.warned }));
  } else {
    lines.push(t('md.summary.ready', lang));
  }
  lines.push('');

  // Approval probability
  const est = report.approvalEstimate;
  const fast = report.fastSummary;
  const exp = report.expertSummary;
  if (est || fast || exp) {
    lines.push(`## ${t('md.approval_title', lang)}`);
    lines.push('');

    if (est) {
      lines.push(`### ${t('md.approval_mechanical_title', lang)}`);
      lines.push('');
      lines.push(`- **${t('md.approval_probability', lang)}**: ${est.probability}%`);
      lines.push(`- **${t('md.approval_confidence', lang)}**: ${t(`conf.${est.confidence}`, lang)}`);
      if (est.keyFactors.length > 0) {
        lines.push(`- **${t('md.approval_factors', lang)}**:`);
        for (const f of est.keyFactors) lines.push(`  - ${f}`);
      }
      lines.push('');
    }

    if (fast) {
      lines.push(`### ${t('md.approval_fast_title', lang)} (${fast.modelName})`);
      lines.push('');
      lines.push(`- **${t('md.approval_probability', lang)}**: ${fast.probability}%`);
      lines.push(`- **${t('md.approval_verdict', lang)}**: ${fast.verdict}`);
      lines.push(`- **${t('md.approval_summary', lang)}**: ${fast.detailedSummary}`);
      if (fast.reasons.length > 0) {
        lines.push(`- **${t('md.approval_reasons', lang)}**:`);
        for (const r of fast.reasons) lines.push(`  - ${r}`);
      }
      if (fast.topActions.length > 0) {
        lines.push(`- **${t('md.approval_actions', lang)}**:`);
        for (const a of fast.topActions) lines.push(`  - ${a}`);
      }
      lines.push('');
    }

    if (exp) {
      lines.push(`### ${t('md.approval_expert_title', lang)} (${exp.modelName})`);
      lines.push('');
      lines.push(`- **${t('md.approval_probability', lang)}**: ${exp.probability}%`);
      lines.push(`- **${t('md.approval_verdict', lang)}**: ${exp.verdict}`);
      lines.push(`- **${t('md.approval_summary', lang)}**: ${exp.detailedSummary}`);
      if (exp.reasons.length > 0) {
        lines.push(`- **${t('md.approval_reasons', lang)}**:`);
        for (const r of exp.reasons) lines.push(`  - ${r}`);
      }
      if (exp.topActions.length > 0) {
        lines.push(`- **${t('md.approval_actions', lang)}**:`);
        for (const a of exp.topActions) lines.push(`  - ${a}`);
      }
      lines.push('');
    }
  }

  // Hard requirements
  const hardLabel = report.hardStatus === 'ready' ? '✅ PASS' : report.hardStatus === 'warn' ? '⚠️ WARN' : '❌ FAIL';
  lines.push(`### ${t('md.hard_requirements', lang)} ${hardLabel}`);
  lines.push('');
  for (const cat of report.hardCategories) {
    for (const item of cat.items) {
      lines.push(`- ${MD_ICONS[item.status]} **${item.name}**: ${item.message}`);
      if (item.detail) lines.push(`  - ${item.detail}`);
      if (item.detailList) {
        for (const d of item.detailList) lines.push(`  - ${d}`);
      }
    }
  }
  lines.push('');

  // Soft scoring
  lines.push(`### ${t('md.soft_scoring', lang)} ${report.softScore}/100`);
  lines.push('');
  for (const cat of report.softCategories) {
    const isAiCat = cat.name.includes('AI') || cat.name.includes('ai');
    const score = isAiCat && report.siteAiScore > 0 ? report.siteAiScore : categoryScore(cat);
    lines.push(`- **${cat.name}**: ${score}%`);
    for (const item of cat.items) {
      lines.push(`  - ${MD_ICONS[item.status]} ${item.name}: ${item.message}`);
      if (item.detail) lines.push(`  - ${item.detail}`);
      if (item.detailList) {
        for (const d of item.detailList) lines.push(`  - ${d}`);
      }
    }
  }
  lines.push('');

  // AI value breakdown
  if (report.aiDimensionStats) {
    const s = report.aiDimensionStats as Record<string, { avg: number; min: number; lowCount: number; lowPct: number }>;
    const totalPages = report.pages.length;
    const dimNames: Record<string, string> = {
      value: t('md.dim_value', lang),
      originality: t('md.dim_originality', lang),
      relevance: t('md.dim_relevance', lang),
      compliance: t('md.dim_compliance', lang),
      translation: t('md.dim_translation', lang),
    };
    lines.push(`### ${t('md.ai_value_title', lang)}`);
    lines.push('');
    lines.push(`| ${t('md.table.dimension', lang)} | ${t('md.table.avg_score', lang)} | ${t('md.table.min_score', lang)} | ${t('md.table.low_count', lang)} |`);
    lines.push(`|------|------|------|------|`);
    for (const [key, dim] of Object.entries(s)) {
      lines.push(`| ${dimNames[key] ?? key} | ${dim.avg}/10 | ${dim.min}/10 | ${dim.lowCount}/${totalPages}, ${dim.lowPct}% |`);
    }
    lines.push('');
    lines.push(`**${t('md.site_ai_score', lang)}**: ${report.siteAiScore}/100（${t('md.geometric_weighted', lang)}）`);
    lines.push('');
  } else if (report.aiDimensionAverages) {
    const d = report.aiDimensionAverages as Record<string, number>;
    const dimNames: Record<string, string> = {
      value: t('md.dim_value', lang),
      originality: t('md.dim_originality', lang),
      relevance: t('md.dim_relevance', lang),
      compliance: t('md.dim_compliance', lang),
      translation: t('md.dim_translation', lang),
    };
    lines.push(`### ${t('md.ai_value_title', lang)}`);
    lines.push('');
    lines.push(`| ${t('md.table.dimension', lang)} | ${t('md.table.avg_score', lang)} |`);
    lines.push(`|------|------|`);
    for (const [key, val] of Object.entries(d)) {
      lines.push(`| ${dimNames[key] ?? key} | ${val}/10 |`);
    }
    lines.push('');
    lines.push(`**${t('md.site_ai_score', lang)}**: ${report.siteAiScore}/100（${t('md.geometric_weighted', lang)}）`);
    lines.push('');
  }

  // Composite formula
  const hardPassRate = report.hardStatus === 'ready' ? 100 : Math.round(report.hardCategories.flatMap(c => c.items).filter(i => i.status === 'pass').length / Math.max(1, report.hardCategories.flatMap(c => c.items).length) * 100);
  lines.push(`> ${t('md.formula_geo', lang, { hardPct: hardPassRate, softPct: report.softScore, penalty: report.warningPenalty, total: report.compositeScore })}`);
  lines.push('');

  // Page details — group by page type
  if (report.pages.length > 0) {
    lines.push(`### ${t('md.page_details', lang)}`);
    lines.push('');

    const typeOrder = ['homepage', 'listing', 'reference_listing', 'content', 'game_detail', 'video_detail', 'reference_detail', 'required', 'utility', 'unknown'];
    const typeLabels: Record<string, string> = {
      homepage: '🏠 首页',
      listing: '📋 列表页',
      reference_listing: '📋 参考列表',
      content: '📝 内容页',
      game_detail: '🎮 游戏详情页',
      video_detail: '📺 视频详情页',
      reference_detail: '📚 参考详情页',
      required: '📄 必要页面',
      utility: '🔧 实用页面',
      unknown: '❓ 未知类型',
    };

    const grouped = new Map<string, PageDetail[]>();
    for (const p of report.pages) {
      const type = p.pageType || 'unknown';
      if (!grouped.has(type)) grouped.set(type, []);
      grouped.get(type)!.push(p);
    }

    for (const type of typeOrder) {
      const pages = grouped.get(type);
      if (!pages || pages.length === 0) continue;
      const label = typeLabels[type] || type;
      lines.push(`#### ${label} (${pages.length})`);
      lines.push('');

      // Filter problems within this group
      const problems = pages.filter(p =>
        (p.pageType !== 'required' && p.pageType !== 'utility')
        && (p.contentStatus !== 'pass' || p.issues.length > 0 || (p.ai && p.ai.status !== 'pass'))
      );
      const ok = pages.filter(p =>
        (p.pageType === 'required' || p.pageType === 'utility')
        || (p.contentStatus === 'pass' && p.issues.length === 0 && (!p.ai || p.ai.status === 'pass'))
      );

      // Table header
      lines.push(`| ${t('md.table.status', lang)} | ${t('md.table.path', lang)} | ${t('md.table.score', lang)} | ${t('md.table.content_ratio', lang)} | V | O | R | C | T | ${t('md.table.ai_composite', lang)} | ${t('md.table.title', lang)} |`);
      lines.push(`|------|------|------|--------|---|---|---|---|---|--------|------|`);

      for (const p of [...problems, ...ok]) {
        const path = (() => { try { const u = new URL(p.url); return u.pathname + u.search; } catch { return p.url; } })();
        const status = MD_ICONS[p.contentStatus];
        const ai = p.ai;
        const v = ai?.valueScore != null ? ai.valueScore : '-';
        const o = ai?.originalityScore != null ? ai.originalityScore : '-';
        const r = ai?.relevanceScore != null ? ai.relevanceScore : '-';
        const c = ai?.complianceScore != null ? ai.complianceScore : '-';
        const t_ = ai?.translationScore != null ? ai.translationScore : '-';
        const aiComposite = (ai?.valueScore != null && ai?.originalityScore != null && ai?.relevanceScore != null && ai?.complianceScore != null && ai?.translationScore != null)
          ? Math.round(Math.pow(ai.valueScore * ai.originalityScore * ai.relevanceScore * ai.complianceScore * ai.translationScore, 0.2) * 10)
          : ((ai?.valueScore != null && ai?.originalityScore != null && ai?.relevanceScore != null && ai?.complianceScore != null)
            ? Math.round(Math.pow(ai.valueScore * ai.originalityScore * ai.relevanceScore * ai.complianceScore, 0.25) * 10)
            : '-');
        lines.push(`| ${status} | [\`${path}\`](${p.url}) | ${p.score}/100 | ${p.contentRatio}% | ${v} | ${o} | ${r} | ${c} | ${t_} | ${aiComposite} | ${p.title} |`);
      }
      lines.push('');

      // Detailed issues for problem pages
      const detailPages = problems.filter(p => p.issues.length > 0 || (p.ai && p.ai.status !== 'pass'));
      if (detailPages.length > 0) {
        for (const p of detailPages) {
          const path = (() => { try { const u = new URL(p.url); return u.pathname + u.search; } catch { return p.url; } })();
          const hasTranslation = p.ai?.translationScore != null;
          const aiComposite = (p.ai?.valueScore != null && p.ai?.originalityScore != null && p.ai?.relevanceScore != null && p.ai?.complianceScore != null && p.ai?.translationScore != null)
            ? Math.round(Math.pow(p.ai.valueScore * p.ai.originalityScore * p.ai.relevanceScore * p.ai.complianceScore * p.ai.translationScore, 0.2) * 10)
            : ((p.ai?.valueScore != null && p.ai?.originalityScore != null && p.ai?.relevanceScore != null && p.ai?.complianceScore != null)
              ? Math.round(Math.pow(p.ai.valueScore * p.ai.originalityScore * p.ai.relevanceScore * p.ai.complianceScore, 0.25) * 10)
              : null);
          const scoreLabels = aiComposite != null
            ? `${t('reporter.mechanical_label', lang)}: ${p.score}/100 | ${t('reporter.advanced_label', lang)}: AI ${aiComposite}/100`
            : `${t('reporter.mechanical_label', lang)}: ${p.score}/100`;
          lines.push(`**[${path}](${p.url})** (${scoreLabels})`);
          lines.push('');
          for (const issue of p.issues) lines.push(`- ⚠️ ${issue}`);
          if (p.ai) {
            const ai = p.ai;
            lines.push(`- ${t('md.ai_status', lang)}: ${MD_ICONS[ai.status]} ${ai.status}`);
            if (ai.valueScore != null) {
              lines.push(`- ${t('md.five_dimensions', lang)}: **${t('md.dim_value', lang)} ${ai.valueScore}** | **${t('md.dim_originality', lang)} ${ai.originalityScore}** | **${t('md.dim_relevance', lang)} ${ai.relevanceScore}** | **${t('md.dim_compliance', lang)} ${ai.complianceScore}** | **${t('md.dim_translation', lang)} ${ai.translationScore ?? '-'}**`);
              const geoMean = hasTranslation && ai.translationScore != null
                ? Math.round(Math.pow((ai.valueScore ?? 5) * (ai.originalityScore ?? 5) * (ai.relevanceScore ?? 5) * (ai.complianceScore ?? 5) * (ai.translationScore ?? 5), 0.2) * 10)
                : Math.round(Math.pow((ai.valueScore ?? 5) * (ai.originalityScore ?? 5) * (ai.relevanceScore ?? 5) * (ai.complianceScore ?? 5), 0.25) * 10);
              lines.push(`- ${t('md.ai_composite_score', lang)}: ${geoMean}/100（${t('md.geometric_mean', lang)}）`);
            }
            lines.push(`- ${t('md.assessment', lang)}: ${ai.assessment}`);
            if (ai.suggestions.length > 0) {
              lines.push(`- ${t('md.suggestions', lang)}:`);
              for (const s of ai.suggestions.slice(0, 3)) lines.push(`  - ${s}`);
            }
          }
          lines.push('');
        }
      }
    }
  }

  return lines.join('\n');
}
