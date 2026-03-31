import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { log } from '../utils/logger.js';
import type { AnalysisResult, SeoIssue } from './analyzer.js';
import type { CrawlResult } from './crawler.js';

// ─── Saved-report shape (minimal fields we read back) ────────

interface SavedReport {
  score: number;
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    total: number;
  };
  issues: SeoIssue[];
  generatedAt: string;
}

function groupIssuesByCategory(issues: SeoIssue[]): Map<string, SeoIssue[]> {
  const grouped = new Map<string, SeoIssue[]>();
  for (const issue of issues) {
    const existing = grouped.get(issue.category) || [];
    existing.push(issue);
    grouped.set(issue.category, existing);
  }
  return grouped;
}

export function printReport(analysis: AnalysisResult, verbose: boolean = false): void {
  log.header('SEO AUDIT REPORT');

  // Score
  log.score(analysis.score);

  // Summary
  log.subheader('Issue Summary');
  if (analysis.summary.critical > 0) log.critical(`${analysis.summary.critical} critical issues`);
  if (analysis.summary.high > 0) log.high(`${analysis.summary.high} high-priority issues`);
  if (analysis.summary.medium > 0) log.medium(`${analysis.summary.medium} medium-priority issues`);
  if (analysis.summary.low > 0) log.low(`${analysis.summary.low} low-priority issues`);
  console.log(`\n  Total issues: ${analysis.summary.total}`);

  // Stats
  log.subheader('Site Statistics');
  console.log(`  Pages scanned:        ${analysis.stats.pagesScanned}`);
  console.log(`  Total images:         ${analysis.stats.imagesTotal}`);
  console.log(`  Images without alt:   ${analysis.stats.imagesWithoutAlt}`);
  console.log(`  Pages without meta:   ${analysis.stats.pagesWithoutMeta}`);
  console.log(`  Duplicate titles:     ${analysis.stats.pagesWithDuplicateTitles}`);
  console.log(`  Broken links:         ${analysis.stats.brokenLinks}`);
  console.log(`  No schema markup:     ${analysis.stats.pagesWithoutSchema}`);
  console.log(`  No OG tags:           ${analysis.stats.pagesWithoutOg}`);
  console.log(`  Avg word count:       ${analysis.stats.avgWordCount}`);
  console.log(`  Avg load time:        ${analysis.stats.avgLoadTime}ms`);

  // Issues by category
  log.subheader('Issues by Category');
  const grouped = groupIssuesByCategory(analysis.issues);

  const severityOrder = ['critical', 'high', 'medium', 'low'] as const;

  for (const severity of severityOrder) {
    const severityIssues = analysis.issues.filter(i => i.severity === severity);
    if (severityIssues.length === 0) continue;

    const label = severity.toUpperCase();
    const logFn = severity === 'critical' ? log.critical
      : severity === 'high' ? log.high
      : severity === 'medium' ? log.medium
      : log.low;

    console.log('');
    logFn(`── ${label} (${severityIssues.length} issues) ──`);
    console.log('');

    for (const issue of severityIssues) {
      console.log(`  [${issue.category}] ${issue.message}`);
      console.log(`    Page: ${issue.page}`);
      if (verbose && issue.details) {
        console.log(`    Details: ${issue.details.substring(0, 120)}`);
      }
      if (verbose && issue.fix) {
        console.log(`    Fix: ${issue.fix}`);
      }
    }
  }

  // Quick wins
  log.subheader('Top 5 Quick Wins');
  const quickWins = analysis.issues
    .filter(i => i.severity === 'critical' || i.severity === 'high')
    .slice(0, 5);

  quickWins.forEach((issue, i) => {
    console.log(`  ${i + 1}. [${issue.severity.toUpperCase()}] ${issue.message}`);
    if (issue.fix) console.log(`     → ${issue.fix}`);
  });

  log.divider();
}

export function saveReport(analysis: AnalysisResult, crawlResult: CrawlResult, outputDir: string): string {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const filename = `seo-report-${timestamp}.json`;
  const filepath = join(outputDir, filename);

  const report = {
    generatedAt: new Date().toISOString(),
    siteUrl: crawlResult.pages[0]?.url || 'unknown',
    score: analysis.score,
    summary: analysis.summary,
    stats: analysis.stats,
    issues: analysis.issues,
    pages: crawlResult.pages.map(p => ({
      url: p.url,
      title: p.title,
      metaDescription: p.metaDescription,
      h1s: p.h1s,
      imagesWithoutAlt: p.images.filter(img => !img.hasAlt).length,
      wordCount: p.wordCount,
      loadTimeMs: p.loadTimeMs,
      hasSchema: p.schemas.length > 0,
      hasOgTags: !!p.ogTitle,
      hasCanonical: !!p.canonical,
    })),
    brokenLinks: crawlResult.brokenLinks,
    sitemapUrlCount: crawlResult.sitemapUrls.length,
  };

  writeFileSync(filepath, JSON.stringify(report, null, 2));
  log.success(`Report saved to: ${filepath}`);
  return filepath;
}

// ─── Report Comparison ───────────────────────────────────────

export function compareReports(previous: SavedReport, current: AnalysisResult): void {
  log.subheader('Score Comparison');

  const scoreDelta = current.score - previous.score;
  const arrow = scoreDelta > 0 ? '+' : '';
  const deltaLabel = scoreDelta === 0 ? '(no change)' : `(${arrow}${scoreDelta})`;
  console.log(`  Previous score: ${previous.score}    →    Current score: ${current.score}  ${deltaLabel}`);

  // Work out which issue messages are new vs fixed
  const prevMessages = new Set(previous.issues.map(i => `${i.category}|${i.message}|${i.page}`));
  const currMessages = new Set(current.issues.map(i => `${i.category}|${i.message}|${i.page}`));

  const fixed: SeoIssue[] = previous.issues.filter(i => !currMessages.has(`${i.category}|${i.message}|${i.page}`));
  const newIssues: SeoIssue[] = current.issues.filter(i => !prevMessages.has(`${i.category}|${i.message}|${i.page}`));

  console.log('');
  if (fixed.length > 0) {
    console.log(`  Issues fixed: ${fixed.length} \u2713`);
    for (const issue of fixed.slice(0, 5)) {
      console.log(`    - [${issue.severity.toUpperCase()}] ${issue.message} (${issue.page})`);
    }
    if (fixed.length > 5) console.log(`    ... and ${fixed.length - 5} more`);
  } else {
    console.log('  Issues fixed: 0');
  }

  console.log('');
  if (newIssues.length > 0) {
    console.log(`  New issues found: ${newIssues.length} \u26a0`);
    for (const issue of newIssues.slice(0, 5)) {
      console.log(`    - [${issue.severity.toUpperCase()}] ${issue.message} (${issue.page})`);
    }
    if (newIssues.length > 5) console.log(`    ... and ${newIssues.length - 5} more`);
  } else {
    console.log('  New issues found: 0');
  }

  console.log('');
  console.log(`  Total issues: ${previous.summary.total} → ${current.summary.total}`);
  console.log(`  Critical:     ${previous.summary.critical} → ${current.summary.critical}`);
  console.log(`  High:         ${previous.summary.high} → ${current.summary.high}`);
  console.log(`  Medium:       ${previous.summary.medium} → ${current.summary.medium}`);
  console.log(`  Low:          ${previous.summary.low} → ${current.summary.low}`);
  log.divider();
}

// ─── Load Latest Saved Report ────────────────────────────────

export function loadLatestReport(outputDir: string): SavedReport | null {
  if (!existsSync(outputDir)) return null;
  const files = readdirSync(outputDir)
    .filter(f => f.startsWith('seo-report-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) return null;
  try {
    const raw = readFileSync(join(outputDir, files[0]), 'utf-8');
    return JSON.parse(raw) as SavedReport;
  } catch {
    return null;
  }
}
