#!/usr/bin/env node

import { Command } from 'commander';
import { resolve } from 'path';
import { config } from 'dotenv';
import { log } from './utils/logger.js';
import { getConfig } from './utils/config.js';
import { crawlSite } from './scanner/crawler.js';
import { analyzeCrawlResults } from './scanner/analyzer.js';
import { printReport, saveReport } from './scanner/reporter.js';
import { scanMetaIssues, applyMetaFixes, printMetaFixes } from './fixer/meta-fixer.js';
import { scanAltIssues, generateAltTexts, applyAltFixes, printAltFixes } from './fixer/alt-fixer.js';
import { scanSchemaIssues, applySchemaFixes, printSchemaFixes } from './fixer/schema-fixer.js';
import { scanLinkIssues, printLinkIssues } from './fixer/link-fixer.js';
import { scanBacklinkOpportunities } from './scanner/backlink-scanner.js';
import { startScheduler } from './scheduler.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// Load .env from project root
config({ path: resolve(process.cwd(), '.env') });

const program = new Command();

program
  .name('seo-agent')
  .description('AI-powered SEO scanner, analyzer, and fixer for Next.js websites')
  .version('1.0.0');

// ─── SCAN COMMAND ───────────────────────────────────────────
program
  .command('scan')
  .description('Crawl a website and analyze SEO issues')
  .option('-u, --url <url>', 'Website URL to scan', 'https://www.virtualcustomersolution.com')
  .option('-d, --depth <number>', 'Max crawl depth', '3')
  .option('-m, --max-pages <number>', 'Max pages to crawl', '50')
  .option('-v, --verbose', 'Show detailed issue information', false)
  .option('-o, --output <dir>', 'Save report to directory', './reports')
  .action(async (opts) => {
    try {
      const seoConfig = getConfig({
        siteUrl: opts.url,
        maxDepth: parseInt(opts.depth),
        maxPages: parseInt(opts.maxPages),
      });

      const crawlResult = await crawlSite(seoConfig);
      const analysis = analyzeCrawlResults(crawlResult);

      printReport(analysis, opts.verbose);

      if (opts.output) {
        saveReport(analysis, crawlResult, opts.output);
      }
    } catch (error) {
      log.error(`Scan failed: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// ─── FIX COMMAND ────────────────────────────────────────────
const fix = program
  .command('fix')
  .description('Fix SEO issues in source code');

// Fix meta tags
fix
  .command('meta')
  .description('Fix title tags and meta descriptions')
  .requiredOption('-s, --source <path>', 'Path to Next.js project source code')
  .option('--apply', 'Actually apply fixes (default: dry-run)', false)
  .option('--ai', 'Use Claude AI to generate meta descriptions', false)
  .action(async (opts) => {
    try {
      const sourcePath = resolve(opts.source);
      log.header('META TAG FIXER');
      log.info(`Source: ${sourcePath}`);

      const fixes = await scanMetaIssues(sourcePath);
      printMetaFixes(fixes);

      if (opts.apply && fixes.length > 0) {
        log.subheader('Applying Fixes...');
        const count = await applyMetaFixes(sourcePath, fixes, opts.ai);
        log.success(`Applied ${count} fixes. Backup files created (.bak)`);
      }
    } catch (error) {
      log.error(`Meta fix failed: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// Fix alt text
fix
  .command('alt')
  .description('Find and fix missing image alt text')
  .requiredOption('-s, --source <path>', 'Path to Next.js project source code')
  .option('--apply', 'Actually apply fixes (default: dry-run)', false)
  .option('--ai', 'Use Claude AI to generate alt text', true)
  .action(async (opts) => {
    try {
      const sourcePath = resolve(opts.source);
      log.header('ALT TEXT FIXER');
      log.info(`Source: ${sourcePath}`);

      let fixes = await scanAltIssues(sourcePath);

      if (opts.ai && fixes.length > 0) {
        fixes = await generateAltTexts(fixes, sourcePath);
      }

      printAltFixes(fixes);

      if (opts.apply && fixes.length > 0) {
        log.subheader('Applying Fixes...');
        const count = await applyAltFixes(sourcePath, fixes);
        log.success(`Applied ${count} alt text fixes. Backup files created (.bak)`);
      }
    } catch (error) {
      log.error(`Alt fix failed: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// Fix schemas
fix
  .command('schema')
  .description('Generate and inject JSON-LD schema markup')
  .requiredOption('-s, --source <path>', 'Path to Next.js project source code')
  .option('--apply', 'Actually apply fixes (default: dry-run)', false)
  .action(async (opts) => {
    try {
      const sourcePath = resolve(opts.source);
      log.header('SCHEMA MARKUP FIXER');
      log.info(`Source: ${sourcePath}`);

      const fixes = await scanSchemaIssues(sourcePath);
      printSchemaFixes(fixes);

      if (opts.apply && fixes.length > 0) {
        log.subheader('Applying Fixes...');
        const count = await applySchemaFixes(sourcePath, fixes);
        log.success(`Applied ${count} schema fixes`);
      }
    } catch (error) {
      log.error(`Schema fix failed: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// Fix links
fix
  .command('links')
  .description('Find broken and problematic links')
  .requiredOption('-s, --source <path>', 'Path to Next.js project source code')
  .option('-u, --url <url>', 'Website URL (for cross-referencing with crawl data)')
  .action(async (opts) => {
    try {
      const sourcePath = resolve(opts.source);
      log.header('LINK CHECKER');
      log.info(`Source: ${sourcePath}`);

      let crawlResult;
      if (opts.url) {
        const seoConfig = getConfig({ siteUrl: opts.url, maxPages: 30, maxDepth: 2 });
        crawlResult = await crawlSite(seoConfig);
      }

      const issues = await scanLinkIssues(sourcePath, crawlResult);
      printLinkIssues(issues);
    } catch (error) {
      log.error(`Link check failed: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// Fix all
fix
  .command('all')
  .description('Run all fixers')
  .requiredOption('-s, --source <path>', 'Path to Next.js project source code')
  .option('--apply', 'Actually apply fixes (default: dry-run)', false)
  .option('--ai', 'Use Claude AI for content generation', true)
  .action(async (opts) => {
    try {
      const sourcePath = resolve(opts.source);
      log.header('FULL SEO FIX - ALL ISSUES');
      log.info(`Source: ${sourcePath}`);
      log.info(`Mode: ${opts.apply ? 'APPLY (will modify files)' : 'DRY RUN (preview only)'}`);
      log.info(`AI: ${opts.ai ? 'Enabled' : 'Disabled'}`);
      log.divider();

      // 1. Meta tags
      log.subheader('1/4 — Meta Tags');
      const metaFixes = await scanMetaIssues(sourcePath);
      printMetaFixes(metaFixes);
      if (opts.apply && metaFixes.length > 0) {
        await applyMetaFixes(sourcePath, metaFixes, opts.ai);
      }

      // 2. Alt text
      log.subheader('2/4 — Image Alt Text');
      let altFixes = await scanAltIssues(sourcePath);
      if (opts.ai && altFixes.length > 0) {
        altFixes = await generateAltTexts(altFixes, sourcePath);
      }
      printAltFixes(altFixes);
      if (opts.apply && altFixes.length > 0) {
        await applyAltFixes(sourcePath, altFixes);
      }

      // 3. Schemas
      log.subheader('3/4 — Schema Markup');
      const schemaFixes = await scanSchemaIssues(sourcePath);
      printSchemaFixes(schemaFixes);
      if (opts.apply && schemaFixes.length > 0) {
        await applySchemaFixes(sourcePath, schemaFixes);
      }

      // 4. Links
      log.subheader('4/4 — Link Issues');
      const linkIssues = await scanLinkIssues(sourcePath);
      printLinkIssues(linkIssues);

      // Summary
      log.header('FIX SUMMARY');
      const totalIssues = metaFixes.length + altFixes.length + schemaFixes.length + linkIssues.length;
      console.log(`  Meta tag issues:    ${metaFixes.length}`);
      console.log(`  Alt text issues:    ${altFixes.length}`);
      console.log(`  Schema issues:      ${schemaFixes.length}`);
      console.log(`  Link issues:        ${linkIssues.length}`);
      console.log(`  ────────────────────`);
      console.log(`  Total:              ${totalIssues}`);

      if (!opts.apply) {
        console.log(`\n  Run with --apply to fix all issues.`);
      }
    } catch (error) {
      log.error(`Fix failed: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// ─── REPORT COMMAND ─────────────────────────────────────────
program
  .command('report')
  .description('Generate a full SEO report')
  .option('-u, --url <url>', 'Website URL', 'https://www.virtualcustomersolution.com')
  .option('-o, --output <dir>', 'Output directory', './reports')
  .option('-d, --depth <number>', 'Max crawl depth', '3')
  .option('-m, --max-pages <number>', 'Max pages to crawl', '100')
  .action(async (opts) => {
    try {
      const seoConfig = getConfig({
        siteUrl: opts.url,
        maxDepth: parseInt(opts.depth),
        maxPages: parseInt(opts.maxPages),
      });

      log.header('GENERATING FULL SEO REPORT');
      const crawlResult = await crawlSite(seoConfig);
      const analysis = analyzeCrawlResults(crawlResult);
      printReport(analysis, true);
      saveReport(analysis, crawlResult, opts.output);
    } catch (error) {
      log.error(`Report failed: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// ─── BACKLINKS COMMAND ───────────────────────────────────────
program
  .command('backlinks')
  .description('Find backlink opportunities for your site')
  .option('-t, --target <url>', 'Your site URL', 'https://virtualcustomersolution.com')
  .option('-c, --competitors <domains>', 'Comma-separated competitor domains', '')
  .option('-o, --output <dir>', 'Save JSON report to directory', './reports')
  .option('-m, --max-results <number>', 'Max opportunities to find', '50')
  .action(async (opts) => {
    try {
      const competitors = opts.competitors
        ? opts.competitors.split(',').map((d: string) => d.trim()).filter(Boolean)
        : [];

      const maxResults = parseInt(opts.maxResults, 10);

      const opportunities = await scanBacklinkOpportunities({
        target: opts.target,
        competitors,
        maxResults,
      });

      // Print summary table
      log.subheader('Backlink Opportunities Found');
      for (const opp of opportunities) {
        const typeLabel = opp.type.padEnd(22);
        const scoreLabel = `[score: ${opp.relevanceScore}]`;
        console.log(`  ${typeLabel} ${scoreLabel}  ${opp.domain}`);
        console.log(`    ${opp.url}`);
        console.log(`    ${opp.notes.substring(0, 100)}`);
        console.log('');
      }

      // Save report
      if (opts.output) {
        if (!existsSync(opts.output)) mkdirSync(opts.output, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        const filename = `backlinks-${timestamp}.json`;
        const filepath = join(opts.output, filename);
        const report = {
          generatedAt: new Date().toISOString(),
          target: opts.target,
          totalOpportunities: opportunities.length,
          opportunities,
        };
        writeFileSync(filepath, JSON.stringify(report, null, 2));
        log.success(`Backlink report saved to: ${filepath}`);
      }
    } catch (error) {
      log.error(`Backlink scan failed: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// ─── SCHEDULE COMMAND ────────────────────────────────────────
const schedule = program
  .command('schedule')
  .description('Manage the weekly scheduler');

schedule
  .command('start')
  .description('Start the weekly SEO + backlink scheduler (runs continuously)')
  .option('-t, --target <url>', 'Target site URL', 'https://virtualcustomersolution.com')
  .option('-c, --competitors <domains>', 'Comma-separated competitor domains', '')
  .option('-o, --output <dir>', 'Reports output directory', './reports')
  .option('-m, --max-pages <number>', 'Max pages to crawl per scan', '50')
  .option('-d, --depth <number>', 'Crawl depth', '3')
  .option('--max-backlinks <number>', 'Max backlink results per scan', '30')
  .action(async (opts) => {
    try {
      const competitors = opts.competitors
        ? opts.competitors.split(',').map((d: string) => d.trim()).filter(Boolean)
        : [];

      log.header('SEO AGENT SCHEDULER');
      log.info(`Target: ${opts.target}`);
      log.info(`Output: ${opts.output}`);

      await startScheduler({
        target: opts.target,
        competitors,
        outputDir: opts.output,
        maxPages: parseInt(opts.maxPages, 10),
        maxDepth: parseInt(opts.depth, 10),
        maxBacklinkResults: parseInt(opts.maxBacklinks, 10),
      });
    } catch (error) {
      log.error(`Scheduler failed: ${(error as Error).message}`);
      process.exit(1);
    }
  });

program.parse();
