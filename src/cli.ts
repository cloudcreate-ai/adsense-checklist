#!/usr/bin/env node

import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { check } from './checker.js';
import { renderTerminalReport, renderJsonReport } from './reporter.js';
import { t, isValidLang, getSupportedLangs } from './i18n.js';
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
  .option('-m, --max-pages <number>', 'Max subpages to crawl', '10')
  .option('-s, --skip-ai', 'Skip AI analysis', false)
  .option('-t, --timeout <ms>', 'Page load timeout', '30000')
  .option('--api-key <key>', 'AI API key')
  .option('-o, --output <dir>', 'Report output directory', 'tmp')
  .option('--no-save', 'Skip auto-saving report')
  .option('-l, --lang <lang>', `Output language (${getSupportedLangs().join('|')})`, 'en')
  .option('--type <type>', 'Force site type (content|game), skip auto-detection')
  .action(async (url: string, opts) => {
    try { new URL(url); } catch { console.error(chalk.red(`Error: Invalid URL "${url}"`)); process.exit(1); }
    if (!url.startsWith('http')) url = 'https://' + url;

    const lang: Lang = isValidLang(opts.lang) ? opts.lang : 'en';
    const siteType: SiteType | undefined = opts.type === 'game' || opts.type === 'content' ? opts.type : undefined;

    process.stderr.write(chalk.cyan(`● Checking ${url}...\n`));

    try {
      let lastProgress = '';
      const report = await check({
        url,
        maxPages: parseInt(opts.maxPages, 10),
        siteType,
        skipAi: opts.skipAi,
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
