export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface CheckItem {
  name: string;
  status: CheckStatus;
  message: string;
  detail?: string;
}

export interface CheckCategory {
  name: string;
  items: CheckItem[];
}

export interface CheckReport {
  url: string;
  timestamp: string;
  categories: CheckCategory[];
  score: number;
  totalChecks: number;
  passed: number;
  warned: number;
  failed: number;
  skipped: number;
}

export interface CheckOptions {
  url: string;
  depth?: number;
  skipAi?: boolean;
  timeout?: number;
  apiKey?: string;
}
