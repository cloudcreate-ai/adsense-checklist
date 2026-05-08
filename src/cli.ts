#!/usr/bin/env node

import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { check } from './checker.js';
import { renderTerminalReport, renderJsonReport } from './reporter.js';
import { t, isValidLang, getSupportedLangs } from './i18n.js';
import { BrowserManager, fetchPage } from './browser.js';
import { detectSiteType } from './detector.js';
import { analyzeSiteTopic } from './ai/topic.js';
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
  .option('-n, --max-crawl <number>', 'Total page crawl limit (Phase 1 + 2)', '50')
  .option('-m, --page-limit <number>', 'Max structural pages to crawl (Phase 1)', '50')
  .option('-c, --content-limit <number>', 'Max content pages to crawl (Phase 2)', '20')
  .option('--sample-min <number>', 'Min content pages to sample', '20')
  .option('--sample-ratio <ratio>', 'Content page sampling ratio (0-1)', '0.2')
  .option('--ai', 'Enable AI content quality analysis', false)
  .option('-t, --timeout <ms>', 'Page load timeout', '30000')
  .option('--api-key <key>', 'AI API key')
  .option('-o, --output <dir>', 'Report output directory', 'tmp')
  .option('--no-save', 'Skip auto-saving report')
  .option('-l, --lang <lang>', `Output language (${getSupportedLangs().join('|')})`, 'en')
  .option('--type <type>', 'Force site type (content|tool|game), skip auto-detection')
  .option('--detect-only', 'Only detect site type/topic, skip full check')
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
          const path = join(outDir, `${domain}-${ts}.json`);
          writeFileSync(path, renderJsonReport(report), 'utf-8');
          console.log(chalk.gray(`  ${t('report.saved', lang)}: ${path}`));
        } catch {}
      }

      process.exit(report.failed > 0 ? 1 : 0);
    } catch (err) {
      process.stderr.write('\r' + ' '.repeat(80) + '\r');
      console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(2);
    }
  });

program.parse();
