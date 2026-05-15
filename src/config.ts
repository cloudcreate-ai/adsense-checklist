import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import yaml from 'js-yaml';
import type { SiteType, Lang } from './types.js';

export interface ModelConfig {
  apiKey?: string;
  apiBase?: string;
  model?: string;
}

export interface AdsenseConfig {
  // Crawl settings
  maxCrawl: number;
  maxPages: number;
  maxContent: number;
  sampleMin: number;
  sampleRatio: number;
  concurrency: number;
  timeout: number;

  // Output
  lang: Lang;
  output: string;

  // AI
  ai: boolean;
  expert: boolean;

  // Fast model
  fastModel: ModelConfig;

  // Expert model
  expertModel: ModelConfig;

  // Compatibility aliases
  siteType?: SiteType;
  apiKey?: string;      // alias for fastModel.apiKey
  apiBase?: string;     // alias for fastModel.apiBase
  apiModel?: string;    // alias for fastModel.model
}

const CONFIG_FILE = '.adsense-check.yaml';
const GLOBAL_DIR = '.adsense-check';
const GLOBAL_CONFIG_FILE = 'config.yaml';
const GLOBAL_REPORTS_DIR = join(homedir(), GLOBAL_DIR, 'reports');

export function getDefaultOutputDir(): string {
  return GLOBAL_REPORTS_DIR;
}

export const DEFAULTS: AdsenseConfig = {
  maxCrawl: 50,
  maxPages: 50,
  maxContent: 20,
  sampleMin: 20,
  sampleRatio: 0.2,
  concurrency: 5,
  timeout: 30000,
  lang: 'en',
  output: getDefaultOutputDir(),
  ai: true,
  expert: false,
  fastModel: {},
  expertModel: {},
};

function resolveYamlPath(cwd: string): string | null {
  const path = join(cwd, CONFIG_FILE);
  return existsSync(path) ? path : null;
}

function mergeConfig(base: AdsenseConfig, override: Partial<AdsenseConfig>): AdsenseConfig {
  const result = { ...base };
  if (override.maxCrawl != null) result.maxCrawl = override.maxCrawl;
  if (override.maxPages != null) result.maxPages = override.maxPages;
  if (override.maxContent != null) result.maxContent = override.maxContent;
  if (override.sampleMin != null) result.sampleMin = override.sampleMin;
  if (override.sampleRatio != null) result.sampleRatio = override.sampleRatio;
  if (override.concurrency != null) result.concurrency = override.concurrency;
  if (override.timeout != null) result.timeout = override.timeout;
  if (override.lang != null) result.lang = override.lang;
  if (override.output != null) result.output = override.output;
  if (override.ai != null) result.ai = override.ai;
  if (override.expert != null) result.expert = override.expert;
  if (override.fastModel != null) result.fastModel = { ...result.fastModel, ...override.fastModel };
  if (override.expertModel != null) result.expertModel = { ...result.expertModel, ...override.expertModel };
  if (override.siteType != null) result.siteType = override.siteType;
  if (override.apiKey != null) result.apiKey = override.apiKey;
  if (override.apiBase != null) result.apiBase = override.apiBase;
  if (override.apiModel != null) result.apiModel = override.apiModel;
  return result;
}

/**
 * Load config from project directory (cwd). Returns merged config with defaults.
 */
export function loadConfig(cwd: string = process.cwd()): AdsenseConfig {
  let config = { ...DEFAULTS };

  // Load global config first
  const globalPath = join(homedir(), GLOBAL_DIR, GLOBAL_CONFIG_FILE);
  if (existsSync(globalPath)) {
    try {
      const raw = readFileSync(globalPath, 'utf-8');
      const parsed = yaml.load(raw) as Partial<AdsenseConfig>;
      config = mergeConfig(config, parsed);
    } catch { /* ignore */ }
  }

  // Load project config (overrides global)
  const projectPath = resolveYamlPath(cwd);
  if (projectPath) {
    try {
      const raw = readFileSync(projectPath, 'utf-8');
      const parsed = yaml.load(raw) as Partial<AdsenseConfig>;
      config = mergeConfig(config, parsed);
    } catch { /* ignore */ }
  }

  return config;
}

/**
 * Write config to a YAML file with comments.
 */
export function saveConfig(config: Partial<AdsenseConfig>, path: string): void {
  // Ensure parent directory exists
  const dir = join(path, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const lines = [
    '# Crawl settings',
    `maxCrawl: ${config.maxCrawl ?? DEFAULTS.maxCrawl}`,
    `maxPages: ${config.maxPages ?? DEFAULTS.maxPages}`,
    `maxContent: ${config.maxContent ?? DEFAULTS.maxContent}`,
    `sampleMin: ${config.sampleMin ?? DEFAULTS.sampleMin}`,
    `sampleRatio: ${config.sampleRatio ?? DEFAULTS.sampleRatio}`,
    `concurrency: ${config.concurrency ?? DEFAULTS.concurrency}`,
    `timeout: ${config.timeout ?? DEFAULTS.timeout}`,
    '',
    '# Output',
    `lang: "${config.lang ?? DEFAULTS.lang}"`,
    `output: ${config.output ?? DEFAULTS.output}`,
    '',
    '# AI (set to false to disable by default)',
    `ai: ${config.ai !== undefined ? config.ai : DEFAULTS.ai}`,
    `expert: ${config.expert !== undefined ? config.expert : DEFAULTS.expert}`,
    '',
    '# Fast model (AI topic detection and page scoring)',
    'fastModel:',
    `  apiKey: "${config.fastModel?.apiKey ?? ''}"`,
    `  apiBase: "${config.fastModel?.apiBase ?? ''}"`,
    `  model: "${config.fastModel?.model ?? ''}"`,
    '',
    '# Expert model (final approval assessment, --expert)',
    'expertModel:',
    `  apiKey: "${config.expertModel?.apiKey ?? ''}"`,
    `  apiBase: "${config.expertModel?.apiBase ?? ''}"`,
    `  model: "${config.expertModel?.model ?? ''}"`,
    '',
  ];
  writeFileSync(path, lines.join('\n'), 'utf-8');
}

/**
 * Get the config file path for the current working directory.
 */
export function getConfigPath(cwd: string = process.cwd()): string {
  return join(cwd, CONFIG_FILE);
}

/**
 * Get the global config file path (~/.adsense-check/config.yaml).
 */
export function getGlobalConfigPath(): string {
  return join(homedir(), GLOBAL_DIR, GLOBAL_CONFIG_FILE);
}
