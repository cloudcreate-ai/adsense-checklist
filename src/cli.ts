#!/usr/bin/env node

import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from './checker.js';
import { renderTerminalReport, renderJsonReport } from './reporter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function formatTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
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
  .option('-j, --json', 'Output as JSON to stdout')
  .option('-d, --depth <number>', 'Number of internal pages to crawl', '10')
  .option('-s, --skip-ai', 'Skip AI content analysis', false)
  .option('-t, --timeout <ms>', 'Page load timeout in milliseconds', '30000')
  .option('--api-key <key>', 'AI API key (or set AI_API_KEY in .env)')
  .option('-o, --output <dir>', 'Report output directory', 'tmp')
  .option('--no-save', 'Skip auto-saving report files')
  .action(async (url: string, opts) => {
    // Validate URL
    try {
      new URL(url);
    } catch {
      console.error(chalk.red(`Error: Invalid URL "${url}"`));
      process.exit(1);
    }

    if (!url.startsWith('http')) {
      url = 'https://' + url;
    }

    const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let frame = 0;
    const interval = setInterval(() => {
      process.stderr.write(`\r${chalk.cyan(spinner[frame++ % spinner.length])} Checking ${url}...`);
    }, 80);

    try {
      const report = await check({
        url,
        depth: parseInt(opts.depth, 10),
        skipAi: opts.skipAi,
        timeout: parseInt(opts.timeout, 10),
        apiKey: opts.apiKey,
      });

      clearInterval(interval);
      process.stderr.write('\r' + ' '.repeat(60) + '\r');

      if (opts.json) {
        console.log(renderJsonReport(report));
      } else {
        console.log(renderTerminalReport(report));
      }

      // Auto-save report files
      if (opts.save !== false) {
        const ts = formatTimestamp();
        const domain = getDomain(url);
        const outDir = join(process.cwd(), opts.output);

        try {
          mkdirSync(outDir, { recursive: true });

          const jsonPath = join(outDir, `${domain}-${ts}.json`);
          writeFileSync(jsonPath, renderJsonReport(report), 'utf-8');

          console.log(chalk.gray(`  Report saved: ${jsonPath}`));
        } catch (saveErr) {
          console.error(chalk.yellow(`  Warning: Failed to save report: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}`));
        }
      }

      process.exit(report.failed > 0 ? 1 : 0);
    } catch (err) {
      clearInterval(interval);
      process.stderr.write('\r' + ' '.repeat(60) + '\r');
      console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(2);
    }
  });

program.parse();
