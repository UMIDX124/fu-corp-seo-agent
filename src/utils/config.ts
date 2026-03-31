import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });

export interface SeoConfig {
  siteUrl: string;
  sourcePath?: string;
  maxDepth: number;
  maxPages: number;
  requestDelay: number; // ms between requests
  userAgent: string;
  anthropicApiKey?: string;
}

export function getConfig(overrides: Partial<SeoConfig> = {}): SeoConfig {
  return {
    siteUrl: overrides.siteUrl || 'https://www.virtualcustomersolution.com',
    sourcePath: overrides.sourcePath,
    maxDepth: overrides.maxDepth ?? 3,
    maxPages: overrides.maxPages ?? 200,
    requestDelay: overrides.requestDelay ?? 500,
    userAgent: 'SEO-Agent/1.0 (Website Audit Bot)',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  };
}

export function validateApiKey(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key === 'your-api-key-here') {
    return false;
  }
  return true;
}
