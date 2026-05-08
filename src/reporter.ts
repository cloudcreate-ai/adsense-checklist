import chalk from 'chalk';
import figures from 'figures';
import type { CheckReport, CheckStatus, PageDetail } from './types.js';

const STATUS_ICONS: Record<CheckStatus, string> = {
  pass: chalk.green(figures.tick),
  warn: chalk.yellow(figures.warning),
  fail: chalk.red(figures.cross),
  skip: chalk.gray('-'),
};

const STATUS_LABELS: Record<CheckStatus, string> = {
  pass: chalk.green('PASS'),
  warn: chalk.yellow('WARN'),
  fail: chalk.red('FAIL'),
  skip: chalk.gray('SKIP'),
};

function getStatusSummary(report: CheckReport): string {
  if (report.failed > 0) {
    return chalk.red.bold(`NOT READY — ${report.failed} 项失败需要修复`);
  }
  if (report.warned > 0) {
    return chalk.yellow.bold(`MOSTLY READY — 修复 ${report.warned} 项警告后可提交审核`);
  }
  return chalk.green.bold('READY — 可以提交 AdSense 审核');
}

export function renderTerminalReport(report: CheckReport): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(chalk.bold.cyan('  AdSense Checklist Report'));
  lines.push(chalk.gray(`  Website: ${report.url}`));
  lines.push(chalk.gray(`  Checked: ${report.timestamp}`));
  lines.push('');

  for (const category of report.categories) {
    lines.push(chalk.bold(`  ${category.name}`));
    for (const item of category.items) {
      const icon = STATUS_ICONS[item.status];
      const label = STATUS_LABELS[item.status];
      lines.push(`    ${icon} [${label}] ${item.message}`);
      if (item.detail) {
        lines.push(chalk.gray(`         ${item.detail}`));
      }
    }
    lines.push('');
  }

  // Per-page details
  if (report.pages.length > 0) {
    lines.push(chalk.bold('  Page Details'));
    lines.push(chalk.gray(`  (${report.pages.length} pages analyzed)`));
    lines.push('');

    // Show problematic pages first
    const problemPages = report.pages.filter(p =>
      p.contentStatus !== 'pass' || p.issues.length > 0 ||
      (p.ai && p.ai.status !== 'pass')
    );
    const okPages = report.pages.filter(p =>
      p.contentStatus === 'pass' && p.issues.length === 0 &&
      (!p.ai || p.ai.status === 'pass')
    );

    for (const page of problemPages) {
      renderPageDetail(lines, page, true);
    }

    if (okPages.length > 0) {
      lines.push(chalk.gray(`    + ${okPages.length} 个页面无问题`));
      lines.push('');
    }
  }

  // Score
  lines.push(chalk.bold('  Score: ') + `${report.score}/${report.totalChecks}`);
  lines.push(`  Status: ${getStatusSummary(report)}`);
  lines.push('');

  return lines.join('\n');
}

function renderPageDetail(lines: string[], page: PageDetail, verbose: boolean) {
  const path = safePath(page.url);
  const statusIcon = STATUS_ICONS[page.contentStatus];
  const ratioColor = page.contentRatio >= 50 ? chalk.green :
    page.contentRatio >= 30 ? chalk.yellow : chalk.red;

  lines.push(`    ${statusIcon} ${chalk.bold(path)}`);
  lines.push(chalk.gray(`       ${page.title}`));
  lines.push(`       正文 ${ratioColor(page.contentRatio + '%')} (${page.contentChars}/${page.totalChars} 字)`);

  for (const issue of page.issues) {
    lines.push(chalk.yellow(`       ! ${issue}`));
  }

  if (page.ai) {
    const aiIcon = STATUS_ICONS[page.ai.status];
    lines.push(`       ${aiIcon} AI: ${truncate(page.ai.assessment, 80)}`);
    for (const s of page.ai.suggestions.slice(0, 2)) {
      lines.push(chalk.gray(`         → ${truncate(s, 70)}`));
    }
  }

  lines.push('');
}

function safePath(url: string): string {
  try { return new URL(url).pathname; } catch { return url; }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '...' : s;
}

export function renderJsonReport(report: CheckReport): string {
  return JSON.stringify(report, null, 2);
}
