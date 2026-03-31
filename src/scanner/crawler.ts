import * as cheerio from 'cheerio';
import { log } from '../utils/logger.js';
import type { SeoConfig } from '../utils/config.js';

export interface PageData {
  url: string;
  statusCode: number;
  title: string;
  metaDescription: string;
  canonical: string;
  h1s: string[];
  h2s: string[];
  h3s: string[];
  images: { src: string; alt: string; hasAlt: boolean }[];
  internalLinks: string[];
  externalLinks: string[];
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  ogType: string;
  twitterCard: string;
  schemas: string[];
  robotsMeta: string;
  wordCount: number;
  loadTimeMs: number;
  redirectChain: string[];
}

export interface CrawlResult {
  pages: PageData[];
  brokenLinks: { url: string; statusCode: number; foundOn: string }[];
  robotsTxt: string;
  sitemapUrls: string[];
  crawlDate: string;
  totalPages: number;
  totalImages: number;
  totalLinks: number;
}

function normalizeUrl(url: string, baseUrl: string): string | null {
  try {
    const parsed = new URL(url, baseUrl);
    // Remove hash fragments and trailing slashes
    parsed.hash = '';
    let normalized = parsed.href.replace(/\/$/, '');
    return normalized;
  } catch {
    return null;
  }
}

function isInternalUrl(url: string, siteUrl: string): boolean {
  try {
    const parsed = new URL(url);
    const site = new URL(siteUrl);
    return parsed.hostname === site.hostname || parsed.hostname === `www.${site.hostname}` || `www.${parsed.hostname}` === site.hostname;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchPage(url: string, config: SeoConfig): Promise<{ html: string; statusCode: number; redirectChain: string[]; loadTimeMs: number } | null> {
  const start = Date.now();
  const redirectChain: string[] = [];

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': config.userAgent },
      redirect: 'follow',
    });

    const loadTimeMs = Date.now() - start;
    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('text/html')) {
      return null;
    }

    const html = await response.text();
    return { html, statusCode: response.status, redirectChain, loadTimeMs };
  } catch (error) {
    log.error(`Failed to fetch ${url}: ${(error as Error).message}`);
    return null;
  }
}

function extractPageData(url: string, html: string, statusCode: number, loadTimeMs: number, redirectChain: string[]): PageData {
  const $ = cheerio.load(html);

  // Title
  const title = $('title').first().text().trim();

  // Meta description
  const metaDescription = $('meta[name="description"]').attr('content')?.trim() || '';

  // Canonical
  const canonical = $('link[rel="canonical"]').attr('href')?.trim() || '';

  // Headings
  const h1s = $('h1').map((_, el) => $(el).text().trim()).get();
  const h2s = $('h2').map((_, el) => $(el).text().trim()).get();
  const h3s = $('h3').map((_, el) => $(el).text().trim()).get();

  // Images
  const images = $('img').map((_, el) => {
    const src = $(el).attr('src') || '';
    const alt = $(el).attr('alt') || '';
    return { src, alt, hasAlt: $(el).attr('alt') !== undefined && alt.length > 0 };
  }).get();

  // Links
  const allLinks = $('a[href]').map((_, el) => $(el).attr('href') || '').get();
  const baseUrl = new URL(url).origin;

  const internalLinks: string[] = [];
  const externalLinks: string[] = [];

  for (const href of allLinks) {
    const normalized = normalizeUrl(href, url);
    if (!normalized) continue;
    if (normalized.startsWith('mailto:') || normalized.startsWith('tel:') || normalized.startsWith('javascript:')) continue;

    if (isInternalUrl(normalized, baseUrl)) {
      internalLinks.push(normalized);
    } else {
      externalLinks.push(normalized);
    }
  }

  // OG tags
  const ogTitle = $('meta[property="og:title"]').attr('content')?.trim() || '';
  const ogDescription = $('meta[property="og:description"]').attr('content')?.trim() || '';
  const ogImage = $('meta[property="og:image"]').attr('content')?.trim() || '';
  const ogType = $('meta[property="og:type"]').attr('content')?.trim() || '';
  const twitterCard = $('meta[name="twitter:card"]').attr('content')?.trim() || '';

  // Schemas
  const schemas = $('script[type="application/ld+json"]').map((_, el) => $(el).html()?.trim() || '').get();

  // Robots meta
  const robotsMeta = $('meta[name="robots"]').attr('content')?.trim() || '';

  // Word count (visible text)
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const wordCount = bodyText.split(' ').filter(w => w.length > 0).length;

  return {
    url, statusCode, title, metaDescription, canonical,
    h1s, h2s, h3s, images, internalLinks: [...new Set(internalLinks)],
    externalLinks: [...new Set(externalLinks)],
    ogTitle, ogDescription, ogImage, ogType, twitterCard,
    schemas, robotsMeta, wordCount, loadTimeMs, redirectChain,
  };
}

export async function crawlSite(config: SeoConfig): Promise<CrawlResult> {
  log.header('SEO CRAWLER - Scanning Website');
  log.info(`Target: ${config.siteUrl}`);
  log.info(`Max depth: ${config.maxDepth} | Max pages: ${config.maxPages}`);
  log.divider();

  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: config.siteUrl, depth: 0 }];
  const pages: PageData[] = [];
  const brokenLinks: { url: string; statusCode: number; foundOn: string }[] = [];

  // Fetch robots.txt
  let robotsTxt = '';
  try {
    const robotsRes = await fetch(`${config.siteUrl}/robots.txt`, {
      headers: { 'User-Agent': config.userAgent },
    });
    if (robotsRes.ok) robotsTxt = await robotsRes.text();
  } catch { /* ignore */ }

  // Fetch sitemap
  let sitemapUrls: string[] = [];
  try {
    const sitemapUrl = robotsTxt.match(/Sitemap:\s*(.+)/i)?.[1]?.trim() || `${config.siteUrl}/sitemap.xml`;
    const sitemapRes = await fetch(sitemapUrl, {
      headers: { 'User-Agent': config.userAgent },
    });
    if (sitemapRes.ok) {
      const sitemapXml = await sitemapRes.text();
      const $ = cheerio.load(sitemapXml, { xml: true });
      sitemapUrls = $('loc').map((_, el) => $(el).text().trim()).get();
      log.info(`Sitemap found: ${sitemapUrls.length} URLs`);
    }
  } catch { /* ignore */ }

  while (queue.length > 0 && pages.length < config.maxPages) {
    const item = queue.shift()!;
    const normalized = normalizeUrl(item.url, config.siteUrl);
    if (!normalized || visited.has(normalized)) continue;
    if (!isInternalUrl(normalized, config.siteUrl)) continue;

    // Skip non-HTML resources
    if (/\.(jpg|jpeg|png|gif|svg|webp|pdf|css|js|ico|woff|woff2|ttf|mp4|mp3)(\?|$)/i.test(normalized)) continue;

    visited.add(normalized);
    log.dim(`[${pages.length + 1}/${config.maxPages}] Crawling: ${normalized}`);

    const result = await fetchPage(normalized, config);
    if (!result) {
      brokenLinks.push({ url: normalized, statusCode: 0, foundOn: 'crawler' });
      continue;
    }

    if (result.statusCode >= 400) {
      brokenLinks.push({ url: normalized, statusCode: result.statusCode, foundOn: 'crawler' });
      continue;
    }

    const pageData = extractPageData(normalized, result.html, result.statusCode, result.loadTimeMs, result.redirectChain);
    pages.push(pageData);

    // Add internal links to queue
    if (item.depth < config.maxDepth) {
      for (const link of pageData.internalLinks) {
        const normalizedLink = normalizeUrl(link, config.siteUrl);
        if (normalizedLink && !visited.has(normalizedLink)) {
          queue.push({ url: normalizedLink, depth: item.depth + 1 });
        }
      }
    }

    await sleep(config.requestDelay);
  }

  const totalImages = pages.reduce((sum, p) => sum + p.images.length, 0);
  const totalLinks = pages.reduce((sum, p) => sum + p.internalLinks.length + p.externalLinks.length, 0);

  log.divider();
  log.success(`Crawl complete: ${pages.length} pages, ${totalImages} images, ${totalLinks} links`);
  if (brokenLinks.length > 0) {
    log.warn(`Found ${brokenLinks.length} broken links`);
  }

  return {
    pages,
    brokenLinks,
    robotsTxt,
    sitemapUrls,
    crawlDate: new Date().toISOString(),
    totalPages: pages.length,
    totalImages,
    totalLinks,
  };
}
