#!/usr/bin/env node

import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { check } from './checker.js';
import { renderTerminalReport, renderJsonReport, renderMarkdownReport } from './reporter.js';
import { t, isValidLang, getSupportedLangs } from './i18n.js';
import { BrowserManager, fetchPage } from './browser.js';
import { detectSiteType } from './detector.js';
import { analyzeSiteTopic } from './ai/topic.js';
import { analyzeWithAI } from './ai/analyzer.js';
import { computePageAiScore } from './scorer.js';
import { estimateByRules, summarizeFinal } from './ai/approval.js';
import { getFastModel, getExpertModel } from './ai/analyzer.js';
import type { Lang, SiteType } from './types.js';

function formatTimestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function getDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return 'unknown'; }
}

const program = new Command();

program
  .name('adsense-check')
  .description('Check if a website meets Google AdSense review requirements')
  .version('1.0.0')
  .argument('<url>', 'Website URL to check')
  .option('-j, --json', 'Output JSON to stdout')
  .option('-n, --max-crawl <number>', 'Total page crawl limit', '50')
  .option('-m, --page-limit <number>', 'Max structural pages to crawl', '50')
  .option('-c, --content-limit <number>', 'Max content pages to crawl', '20')
  .option('--sample-min <number>', 'Min content pages to sample', '20')
  .option('--sample-ratio <ratio>', 'Content page sampling ratio (0-1)', '0.2')
  .option('--ai', 'Enable AI content quality analysis', false)
  .option('--expert', 'Enable expert AI summary and approval probability (requires --ai)', false)
  .option('-b, --concurrency <number>', 'AI batch concurrency (pages per batch)', '5')
  .option('-t, --timeout <ms>', 'Page load timeout', '30000')
  .option('--api-key <key>', 'AI API key')
  .option('-o, --output <dir>', 'Report output directory', 'tmp')
  .option('--no-save', 'Skip auto-saving report')
  .option('-l, --lang <lang>', `Output language (${getSupportedLangs().join('|')})`, 'en')
  .option('--type <type>', 'Force site type (content|tool|game|video|reference), skip auto-detection')
  .option('--detect-only', 'Only detect site type/topic, skip full check')
  .option('--page <url>', 'Analyze a single page value (AI four-dimension scoring)')
  .action(async (url: string, opts) => {
    try { new URL(url); } catch { console.error(chalk.red(`Error: Invalid URL "${url}"`)); process.exit(1); }
    if (!url.startsWith('http')) url = 'https://' + url;

    const lang: Lang = isValidLang(opts.lang) ? opts.lang : 'en';
    const validTypes: SiteType[] = ['content', 'tool', 'game'];
    const siteType: SiteType | undefined = validTypes.includes(opts.type as SiteType) ? opts.type as SiteType : undefined;

    // Detect-only mode: just fetch homepage and determine type
    if (opts.detectOnly) {
      const browser = new BrowserManager();
      try {
        process.stderr.write(chalk.cyan(`● Detecting site type for ${url}...\n`));
        const page = await browser.newPage();
        const data = await fetchPage(page, url, parseInt(opts.timeout, 10));
        await page.close();

        // DOM-based detection
        const domResult = detectSiteType([data.signals], data.navText + ' ' + data.footerText, siteType);
        process.stderr.write(chalk.gray(`  DOM detection: ${domResult.type} (${domResult.confidence})\n`));

        // AI-based detection (if enabled)
        const apiKey = opts.apiKey || process.env.AI_API_KEY;
        if (opts.ai && apiKey) {
          process.stderr.write(chalk.gray('  AI: analyzing topic...\n'));
          const topic = await analyzeSiteTopic(
            { title: data.title, text: data.text, navText: data.navText + ' ' + data.footerText },
            lang, apiKey
          );
          console.log(JSON.stringify({
            domType: domResult.type,
            domConfidence: domResult.confidence,
            aiType: topic.type,
            topic: topic.topic,
            description: topic.description,
            confidence: topic.confidence,
            reasoning: topic.reasoning,
          }, null, 2));
        } else {
          console.log(JSON.stringify({
            type: domResult.type,
            confidence: domResult.confidence,
            signals: domResult.signals,
          }, null, 2));
        }
        await browser.close();
        process.exit(0);
      } catch (err) {
        await browser.close();
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(2);
      }
    }

    // Single-page value analysis
    if (opts.page) {
      const pageUrl = opts.page.startsWith('http') ? opts.page : 'https://' + opts.page;
      const apiKey = opts.apiKey || process.env.AI_API_KEY;
      if (!apiKey) {
        console.error(chalk.red('Error: --page requires AI (--ai --api-key or AI_API_KEY env)'));
        process.exit(1);
      }
      const browser = new BrowserManager();
      try {
        process.stderr.write(chalk.cyan(`● Analyzing page value: ${pageUrl}\n`));
        const pg = await browser.newPage();
        const data = await fetchPage(pg, pageUrl, parseInt(opts.timeout, 10));
        await pg.close();

        // Auto-detect topic from this page
        process.stderr.write(chalk.gray('  Detecting topic...\n'));
        let siteTopic;
        try {
          siteTopic = await analyzeSiteTopic(
            { title: data.title, text: data.text, navText: data.navText + ' ' + data.footerText },
            lang, apiKey
          );
          process.stderr.write(chalk.gray(`  Topic: ${siteTopic.topic} (${siteTopic.type})\n`));
        } catch {}

        // AI four-dimension analysis
        process.stderr.write(chalk.gray('  AI: analyzing page value...\n'));
        const result = await analyzeWithAI(
          [{ url: pageUrl, text: data.text }],
          lang, apiKey, undefined, siteTopic
        );
        const analysis = result.pageAnalyses[0];

        if (!analysis) {
          console.error(chalk.red('  AI analysis returned no results'));
          process.exit(2);
        }

        const score = computePageAiScore(analysis);
        const v = analysis.valueScore ?? 5;
        const o = analysis.originalityScore ?? 5;
        const r = analysis.relevanceScore ?? 5;
        const c = analysis.complianceScore ?? 5;
        const t = analysis.translationScore ?? 5;

        const dimColor = (s: number) => s >= 8 ? chalk.green : s >= 5 ? chalk.yellow : chalk.red;
        const scoreColor = score >= 70 ? chalk.green : score >= 40 ? chalk.yellow : chalk.red;

        const lines: string[] = [
          '',
          chalk.bold.cyan('  Page Value Analysis'),
          chalk.gray(`  URL: ${pageUrl}`),
          chalk.gray(`  Title: ${data.title}`),
        ];
        if (siteTopic) {
          lines.push(chalk.gray(`  Site topic: ${siteTopic.topic} (${siteTopic.type})`));
        }
        lines.push('');
        lines.push(`  ${dimColor(v)('Value')}        ${v}/10`);
        lines.push(`  ${dimColor(o)('Originality')}  ${o}/10`);
        lines.push(`  ${dimColor(r)('Relevance')}    ${r}/10`);
        lines.push(`  ${dimColor(c)('Compliance')}   ${c}/10`);
        lines.push(`  ${dimColor(t)('Translation')}  ${t}/10`);
        lines.push('');
        lines.push(chalk.bold(`  Overall: ${scoreColor(score + '/100')}`) + chalk.gray(' (geometric mean)'));
        lines.push('');
        if (analysis.assessment) {
          lines.push(chalk.gray(`  ${analysis.assessment}`));
          lines.push('');
        }
        for (const s of analysis.suggestions) {
          lines.push(chalk.yellow(`  -> ${s}`));
        }
        lines.push('');

        if (opts.json) {
          console.log(JSON.stringify({
            url: pageUrl,
            title: data.title,
            topic: siteTopic,
            scores: { value: v, originality: o, relevance: r, compliance: c, translation: t },
            overall: score,
            relevanceLabel: analysis.relevance,
            assessment: analysis.assessment,
            suggestions: analysis.suggestions,
          }, null, 2));
        } else {
          console.log(lines.join('\n'));
        }

        await browser.close();
        process.exit(c <= 2 ? 1 : 0); // exit 1 if serious compliance violation
      } catch (err) {
        await browser.close();
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(2);
      }
    }

    process.stderr.write(chalk.cyan(`● Checking ${url}...\n`));

    try {
      let lastProgress = '';
      const report = await check({
        url,
        maxCrawl: parseInt(opts.maxCrawl, 10),
        maxPages: parseInt(opts.pageLimit, 10),
        maxContent: parseInt(opts.contentLimit, 10),
        sampleMin: parseInt(opts.sampleMin, 10),
        sampleRatio: parseFloat(opts.sampleRatio),
        siteType,
        skipAi: !opts.ai,
        expert: opts.expert,
        concurrency: parseInt(opts.concurrency, 10),
        timeout: parseInt(opts.timeout, 10),
        apiKey: opts.apiKey,
        lang,
        onProgress: (msg: string) => {
          lastProgress = msg;
          const line = `\r${chalk.cyan('●')} ${chalk.gray(msg)}`;
          process.stderr.write(line + ' '.repeat(Math.max(0, 60 - msg.length)));
        },
      });

      process.stderr.write('\r' + ' '.repeat(80) + '\r');

      if (opts.json) console.log(renderJsonReport(report));
      else console.log(renderTerminalReport(report));

      // Auto-save
      if (opts.save !== false) {
        const ts = formatTimestamp();
        const domain = getDomain(url);
        const outDir = join(process.cwd(), opts.output);
        try {
          mkdirSync(outDir, { recursive: true });
          const jsonPath = join(outDir, `${domain}-${ts}.json`);
          writeFileSync(jsonPath, renderJsonReport(report), 'utf-8');
          const mdPath = join(outDir, `${domain}-${ts}.md`);
          writeFileSync(mdPath, renderMarkdownReport(report), 'utf-8');
          console.log(chalk.gray(`  ${t('report.saved', lang)}: ${jsonPath}`));
          console.log(chalk.gray(`  ${t('report.saved', lang)}: ${mdPath}`));
        } catch {}
      }

      process.exit(report.failed > 0 ? 1 : 0);
    } catch (err) {
      process.stderr.write('\r' + ' '.repeat(80) + '\r');
      console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(2);
    }
  });

program.enablePositionalOptions();

// Evaluate approval probability from an existing JSON report
program
  .command('eval')
  .description('Evaluate approval probability from an existing JSON report')
  .argument('<report>', 'Path to a JSON report file')
  .option('-l, --lang <lang>', `Output language (${getSupportedLangs().join('|')})`, 'en')
  .option('--expert', 'Run expert model assessment in addition to fast model', false)
  .option('--json', 'Output JSON comparison to stdout')
  .action(async (reportPath: string, opts) => {
    const { readFile } = await import('node:fs/promises');
    let reportJson: string;
    try {
      reportJson = await readFile(reportPath, 'utf8');
    } catch {
      console.error(chalk.red(`Error: Cannot read report file "${reportPath}"`));
      process.exit(1);
    }

    const report = JSON.parse(reportJson);
    const lang: Lang = isValidLang(opts.lang) ? opts.lang : 'en';

    // Mechanical estimate
    const mech = estimateByRules(report, lang);

    if (opts.json) {
      const result: Record<string, unknown> = {
        url: report.url,
        compositeScore: report.compositeScore,
        hardStatus: report.hardStatus,
        siteAiScore: report.siteAiScore,
        mechanical: mech,
      };

      const fast = await summarizeFinal(report, lang, new Date().toISOString().slice(0, 10), false);
      if (fast) result.fast = fast;

      const fastM = getFastModel();
      const expertM = getExpertModel();
      if (opts.expert && expertM !== fastM) {
        const expert = await summarizeFinal(report, lang, new Date().toISOString().slice(0, 10), true);
        if (expert) result.expert = expert;
      }

      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    }

    // Terminal output
    const hasAi = (report.pages || []).some((p: { ai?: unknown }) => !!p.ai);
    console.log(chalk.cyan(`\n=== Report: ${report.url} ===`));
    console.log(chalk.gray(`Composite: ${report.compositeScore}/100, Hard: ${report.hardStatus}, AI Site: ${report.siteAiScore}/100`));
    console.log(chalk.gray(`Pages: ${report.pages.length}, AI pages: ${(report.pages as Array<{ ai?: unknown }>).filter(p => p.ai).length}\n`));

    // 1. Mechanical
    console.log(chalk.bold('─── 1. ' + t('report.approval_mechanical', lang) + ' (rule-based, zero cost) ───'));
    const probColor = (p: number) => p >= 70 ? chalk.green : p >= 40 ? chalk.yellow : chalk.red;
    console.log(`  ${t('md.approval_probability', lang)}: ${probColor(mech.probability)(`~${mech.probability}%`)}`);
    console.log(`  ${t('md.approval_confidence', lang)}: ${mech.confidence}`);
    for (const f of mech.keyFactors) console.log(`    · ${f}`);
    console.log('');

    // 2. Fast model
    console.log(chalk.bold('─── 2. Fast model assessment ───'));
    const fast = await summarizeFinal(report, lang, new Date().toISOString().slice(0, 10), false);
    if (fast) {
      console.log(`  ${t('md.approval_probability', lang)}: ${probColor(fast.probability)(`~${fast.probability}%`)} (${chalk.gray(fast.modelName)})`);
      console.log(`  ${t('report.approval_verdict', lang)}: ${fast.verdict}`);
      console.log(`  ${t('md.approval_summary', lang)}: ${fast.detailedSummary}`);
      if (fast.reasons.length > 0) {
        console.log(`  ${t('md.approval_reasons', lang)}:`);
        for (const r of fast.reasons) console.log(`    · ${r}`);
      }
      if (fast.topActions.length > 0) {
        console.log(`  ${t('md.approval_actions', lang)}:`);
        for (const a of fast.topActions) console.log(`    · ${a}`);
      }
    } else {
      console.log(chalk.gray('  Fast assessment returned null'));
    }
    console.log('');

    // 3. Expert model (only if different from fast)
    const fastM = getFastModel();
    const expertM = getExpertModel();
    const shouldRunExpert = opts.expert && expertM !== fastM;
    let expert: Awaited<ReturnType<typeof summarizeFinal>> = null;
    if (shouldRunExpert) {
      console.log(chalk.bold('─── 3. Expert model assessment ───'));
      expert = await summarizeFinal(report, lang, new Date().toISOString().slice(0, 10), true);
      if (expert) {
        console.log(`  ${t('md.approval_probability', lang)}: ${probColor(expert.probability)(`~${expert.probability}%`)} (${chalk.gray(expert.modelName)})`);
        console.log(`  ${t('report.approval_verdict', lang)}: ${expert.verdict}`);
        console.log(`  ${t('md.approval_summary', lang)}: ${expert.detailedSummary}`);
        if (expert.reasons.length > 0) {
          console.log(`  ${t('md.approval_reasons', lang)}:`);
          for (const r of expert.reasons) console.log(`    · ${r}`);
        }
        if (expert.topActions.length > 0) {
          console.log(`  ${t('md.approval_actions', lang)}:`);
          for (const a of expert.topActions) console.log(`    · ${a}`);
        }
      } else {
        console.log(chalk.gray('  Expert assessment returned null'));
      }
      console.log('');
    } else if (opts.expert) {
      console.log(chalk.gray(`  Expert model same as fast model (${fastM}), skipping\n`));
    }

    // Comparison
    console.log(chalk.bold('─── ' + t('md.approval_title', lang) + ' ───'));
    console.log(`  ${t('report.approval_mechanical', lang)}: ~${mech.probability}%`);
    if (fast) console.log(`  Fast (${fastM}): ~${fast.probability}%`);
    if (expert) console.log(`  Expert (${expertM}): ~${expert.probability}%`);
    console.log('');
  });

program.parse();
