import chalk from 'chalk';
import figures from 'figures';
import type { CheckReport, CheckStatus } from './types.js';

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

  // Score
  lines.push(chalk.bold('  Score: ') + `${report.score}/${report.totalChecks}`);
  lines.push(`  Status: ${getStatusSummary(report)}`);
  lines.push('');

  return lines.join('\n');
}

export function renderJsonReport(report: CheckReport): string {
  return JSON.stringify(report, null, 2);
}
