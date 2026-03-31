import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { log } from './utils/logger.js';
import { getConfig } from './utils/config.js';
import { crawlSite } from './scanner/crawler.js';
import { analyzeCrawlResults } from './scanner/analyzer.js';
import { saveReport, compareReports } from './scanner/reporter.js';
import { scanBacklinkOpportunities } from './scanner/backlink-scanner.js';

export interface SchedulerConfig {
  target: string;
  competitors: string[];
  outputDir: string;
  maxPages: number;
  maxDepth: number;
  maxBacklinkResults: number;
}

// ─── Helpers ─────────────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function getLatestReport(outputDir: string, prefix: string): string | null {
  if (!existsSync(outputDir)) return null;
  const files = readdirSync(outputDir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
    .sort()
    .reverse();
  return files.length > 0 ? join(outputDir, files[0]) : null;
}

// ─── Weekly SEO Scan ─────────────────────────────────────────

async function runWeeklySeoScan(cfg: SchedulerConfig): Promise<void> {
  log.header('[Scheduler] Weekly SEO Scan');
  try {
    const seoConfig = getConfig({
      siteUrl: cfg.target,
      maxDepth: cfg.maxDepth,
      maxPages: cfg.maxPages,
    });

    const crawlResult = await crawlSite(seoConfig);
    const analysis = analyzeCrawlResults(crawlResult);
    const savedPath = saveReport(analysis, crawlResult, cfg.outputDir);

    // Compare with previous report
    const allFiles = readdirSync(cfg.outputDir)
      .filter(f => f.startsWith('seo-report-') && f.endsWith('.json'))
      .sort()
      .reverse();

    if (allFiles.length >= 2) {
      const previousPath = join(cfg.outputDir, allFiles[1]); // second-newest
      const previousRaw = readFileSync(previousPath, 'utf-8');
      const previousReport = JSON.parse(previousRaw);
      compareReports(previousReport, analysis);
    } else {
      log.info('No previous report to compare against — this is the baseline.');
    }

    log.success(`Weekly SEO scan complete. Report: ${savedPath}`);
  } catch (err) {
    log.error(`Weekly SEO scan failed: ${(err as Error).message}`);
  }
}

// ─── Weekly Backlink Scan ─────────────────────────────────────

async function runWeeklyBacklinkScan(cfg: SchedulerConfig): Promise<void> {
  log.header('[Scheduler] Weekly Backlink Scan');
  try {
    ensureDir(cfg.outputDir);

    const opportunities = await scanBacklinkOpportunities({
      target: cfg.target,
      competitors: cfg.competitors,
      maxResults: cfg.maxBacklinkResults,
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const filename = `backlinks-${timestamp}.json`;
    const filepath = join(cfg.outputDir, filename);

    const report = {
      generatedAt: new Date().toISOString(),
      target: cfg.target,
      totalOpportunities: opportunities.length,
      opportunities,
    };

    writeFileSync(filepath, JSON.stringify(report, null, 2));
    log.success(`Backlink report saved to: ${filepath}`);
    log.info(`Found ${opportunities.length} opportunities`);
  } catch (err) {
    log.error(`Weekly backlink scan failed: ${(err as Error).message}`);
  }
}

// ─── Scheduler Entry Point ────────────────────────────────────

export async function startScheduler(config: SchedulerConfig): Promise<void> {
  ensureDir(config.outputDir);

  // Try to load node-cron; fall back to setInterval-based approach
  let cronAvailable = false;
  try {
    const { default: cron } = await import('node-cron');
    cronAvailable = true;

    // Weekly SEO scan — every Monday at 09:00
    cron.schedule('0 9 * * 1', () => {
      runWeeklySeoScan(config).catch(err =>
        log.error(`Scheduled SEO scan error: ${(err as Error).message}`)
      );
    });

    // Weekly backlink scan — every Monday at 10:00
    cron.schedule('0 10 * * 1', () => {
      runWeeklyBacklinkScan(config).catch(err =>
        log.error(`Scheduled backlink scan error: ${(err as Error).message}`)
      );
    });

    log.success('Scheduler started with node-cron.');
    log.info('  SEO scan:      every Monday at 09:00');
    log.info('  Backlink scan: every Monday at 10:00');
  } catch {
    log.warn('node-cron unavailable — falling back to setInterval (checks every minute).');
    cronAvailable = false;
  }

  if (!cronAvailable) {
    // Fallback: poll every minute, fire on Mondays at the right hour
    const MINUTE = 60_000;
    setInterval(() => {
      const now = new Date();
      const day = now.getDay();   // 0=Sun, 1=Mon
      const hour = now.getHours();
      const min = now.getMinutes();

      if (day === 1 && hour === 9 && min === 0) {
        runWeeklySeoScan(config).catch(err =>
          log.error(`Scheduled SEO scan error: ${(err as Error).message}`)
        );
      }
      if (day === 1 && hour === 10 && min === 0) {
        runWeeklyBacklinkScan(config).catch(err =>
          log.error(`Scheduled backlink scan error: ${(err as Error).message}`)
        );
      }
    }, MINUTE);

    log.success('Fallback scheduler started (setInterval polling every minute).');
    log.info('  SEO scan:      every Monday at 09:00');
    log.info('  Backlink scan: every Monday at 10:00');
  }

  log.info('Press Ctrl+C to stop the scheduler.');
  // Keep the process alive
  await new Promise(() => {});
}

// ─── One-shot helpers (used by CLI) ──────────────────────────

export { runWeeklySeoScan, runWeeklyBacklinkScan };
