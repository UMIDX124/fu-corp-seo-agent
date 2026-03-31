import { readFileSync } from 'fs';
import { glob } from 'glob';
import { join } from 'path';
import { log } from '../utils/logger.js';
import type { CrawlResult } from '../scanner/crawler.js';

interface LinkIssue {
  file: string;
  line: number;
  href: string;
  issue: 'broken' | 'redirect-needed' | 'missing-internal-link';
  suggestion?: string;
}

export async function scanLinkIssues(sourcePath: string, crawlResult?: CrawlResult): Promise<LinkIssue[]> {
  log.subheader('Scanning for Link Issues');

  const issues: LinkIssue[] = [];

  const files = await glob('**/*.{tsx,ts,jsx,js,mdx,md}', {
    cwd: sourcePath,
    ignore: ['node_modules/**', '.next/**', 'dist/**'],
  });

  const brokenUrls = new Set(crawlResult?.brokenLinks.map(b => b.url) || []);

  for (const file of files) {
    const fullPath = join(sourcePath, file);
    const content = readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Find href values
      const hrefMatches = line.matchAll(/href=["']([^"']+)["']/g);
      for (const match of hrefMatches) {
        const href = match[1];

        // Check if this URL is in the broken links list
        if (brokenUrls.size > 0) {
          for (const broken of brokenUrls) {
            if (broken.endsWith(href) || href === broken) {
              issues.push({
                file,
                line: i + 1,
                href,
                issue: 'broken',
                suggestion: 'Fix or redirect this URL',
              });
            }
          }
        }

        // Check for old /service/ URLs that should be /services
        if (href.startsWith('/service/') && !href.startsWith('/services')) {
          issues.push({
            file,
            line: i + 1,
            href,
            issue: 'redirect-needed',
            suggestion: `Redirect ${href} to /services`,
          });
        }
      }
    }
  }

  log.info(`Found ${issues.length} link issues`);
  return issues;
}

export function printLinkIssues(issues: LinkIssue[]): void {
  if (issues.length === 0) {
    log.success('No link issues found!');
    return;
  }

  log.subheader(`Found ${issues.length} Link Issues`);

  for (const issue of issues) {
    const label = issue.issue === 'broken' ? 'BROKEN' : issue.issue === 'redirect-needed' ? 'REDIRECT' : 'SUGGESTION';
    log.warn(`[${label}] ${issue.file}:${issue.line}`);
    console.log(`    Link: ${issue.href}`);
    if (issue.suggestion) console.log(`    Fix:  ${issue.suggestion}`);
    console.log('');
  }
}
