#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { check } from './checker.js';
import { renderTerminalReport, renderJsonReport } from './reporter.js';

const program = new Command();

program
  .name('adsense-check')
  .description('Check if a website meets Google AdSense review requirements')
  .version('1.0.0')
  .argument('<url>', 'Website URL to check')
  .option('-j, --json', 'Output as JSON')
  .option('-d, --depth <number>', 'Number of internal pages to crawl', '5')
  .option('-s, --skip-ai', 'Skip AI content analysis', false)
  .option('-t, --timeout <ms>', 'Page load timeout in milliseconds', '30000')
  .option('--api-key <key>', 'Anthropic API key (or set ANTHROPIC_API_KEY env var)')
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

      process.exit(report.failed > 0 ? 1 : 0);
    } catch (err) {
      clearInterval(interval);
      process.stderr.write('\r' + ' '.repeat(60) + '\r');
      console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(2);
    }
  });

program.parse();
