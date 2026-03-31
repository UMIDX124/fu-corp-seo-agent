import * as cheerio from 'cheerio';
import { log } from '../utils/logger.js';

export interface BacklinkOpportunity {
  url: string;
  domain: string;
  type: 'resource-page' | 'guest-post' | 'directory' | 'competitor-reference';
  relevanceScore: number; // 0-100
  notes: string;
}

export interface BacklinkScanOptions {
  target: string;
  competitors: string[];
  maxResults: number;
}

// ─── Helpers ────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function isLikelySpam(url: string, text: string): boolean {
  const spamPatterns = [
    /\.(tk|ml|ga|cf|gq)$/i,
    /casino|poker|viagra|cialis|porn|xxx|adult|gambling/i,
    /free-download|crack|keygen|torrent/i,
  ];
  return spamPatterns.some(p => p.test(url) || p.test(text));
}

function scoreRelevance(url: string, text: string, type: BacklinkOpportunity['type']): number {
  let score = 40; // base

  const digitalMarketingKeywords = [
    'digital marketing', 'seo', 'ppc', 'social media', 'content marketing',
    'lead generation', 'marketing agency', 'online marketing', 'inbound',
  ];
  const remoteWorkKeywords = [
    'remote team', 'virtual assistant', 'remote work', 'distributed team',
    'work from home', 'remote workforce', 'outsourcing', 'virtual staff',
  ];

  const combined = (url + ' ' + text).toLowerCase();

  let kwHits = 0;
  for (const kw of digitalMarketingKeywords) {
    if (combined.includes(kw)) kwHits++;
  }
  for (const kw of remoteWorkKeywords) {
    if (combined.includes(kw)) kwHits++;
  }

  score += Math.min(kwHits * 8, 40);

  if (type === 'resource-page') score += 10;
  if (type === 'guest-post') score += 5;

  // Prefer .org / .edu
  if (/\.edu\//.test(url)) score += 10;
  if (/\.org\//.test(url)) score += 5;

  return Math.min(100, Math.max(0, score));
}

// ─── DuckDuckGo Search ──────────────────────────────────────

const DDG_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; SEO-Agent/1.0; +https://virtualcustomersolution.com)',
  'Accept': 'text/html',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function duckDuckGoSearch(query: string, maxResults: number = 10): Promise<Array<{ url: string; title: string; snippet: string }>> {
  const encoded = encodeURIComponent(query);
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encoded}`;

  try {
    const res = await fetch(searchUrl, { headers: DDG_HEADERS });
    if (!res.ok) {
      log.warn(`DDG search returned ${res.status} for query: ${query}`);
      return [];
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const results: Array<{ url: string; title: string; snippet: string }> = [];

    $('.result__body').each((_, el) => {
      if (results.length >= maxResults) return false;

      const titleEl = $(el).find('.result__a');
      const title = titleEl.text().trim();
      const rawHref = titleEl.attr('href') || '';
      const snippetEl = $(el).find('.result__snippet');
      const snippet = snippetEl.text().trim();

      // DDG wraps links through a redirect — extract the actual URL
      let url = rawHref;
      try {
        const parsed = new URL(rawHref, 'https://html.duckduckgo.com');
        const uddg = parsed.searchParams.get('uddg');
        if (uddg) url = decodeURIComponent(uddg);
      } catch { /* keep rawHref */ }

      if (url && url.startsWith('http') && title) {
        results.push({ url, title, snippet });
      }
    });

    return results;
  } catch (err) {
    log.warn(`DDG search failed: ${(err as Error).message}`);
    return [];
  }
}

// ─── URL Accessibility Check ────────────────────────────────

async function isAccessible(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: DDG_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

// ─── Resource Page Scanner ──────────────────────────────────

async function findResourcePages(maxResults: number): Promise<BacklinkOpportunity[]> {
  const queries = [
    '"digital marketing" "resources" OR "useful links" OR "recommended resources"',
    '"remote team" OR "virtual assistant" "recommended tools" OR "resources" OR "useful links"',
    '"marketing agency" "resource page" OR "resources for"',
  ];

  const opportunities: BacklinkOpportunity[] = [];
  const seen = new Set<string>();

  for (const query of queries) {
    if (opportunities.length >= maxResults) break;
    log.dim(`Resource search: ${query.substring(0, 60)}...`);

    const results = await duckDuckGoSearch(query, 8);
    await sleep(1100); // rate limit: 1 req/sec + buffer

    for (const r of results) {
      if (opportunities.length >= maxResults) break;
      const domain = extractDomain(r.url);
      if (seen.has(domain)) continue;
      if (isLikelySpam(r.url, r.snippet)) continue;
      if (domain === 'virtualcustomersolution.com') continue;

      const accessible = await isAccessible(r.url);
      await sleep(1100);

      if (!accessible) continue;

      seen.add(domain);
      const score = scoreRelevance(r.url, r.title + ' ' + r.snippet, 'resource-page');
      opportunities.push({
        url: r.url,
        domain,
        type: 'resource-page',
        relevanceScore: score,
        notes: r.snippet.substring(0, 120) || r.title,
      });
    }
  }

  return opportunities;
}

// ─── Guest Post Scanner ─────────────────────────────────────

async function findGuestPostOpportunities(maxResults: number): Promise<BacklinkOpportunity[]> {
  const queries = [
    '"write for us" "digital marketing"',
    '"guest post" "remote work" OR "virtual assistant"',
    '"contribute" "digital marketing blog" "write for us"',
    '"guest article" "marketing" "submit"',
  ];

  const opportunities: BacklinkOpportunity[] = [];
  const seen = new Set<string>();

  for (const query of queries) {
    if (opportunities.length >= maxResults) break;
    log.dim(`Guest post search: ${query.substring(0, 60)}...`);

    const results = await duckDuckGoSearch(query, 8);
    await sleep(1100);

    for (const r of results) {
      if (opportunities.length >= maxResults) break;
      const domain = extractDomain(r.url);
      if (seen.has(domain)) continue;
      if (isLikelySpam(r.url, r.snippet)) continue;
      if (domain === 'virtualcustomersolution.com') continue;

      const accessible = await isAccessible(r.url);
      await sleep(1100);

      if (!accessible) continue;

      seen.add(domain);
      const score = scoreRelevance(r.url, r.title + ' ' + r.snippet, 'guest-post');
      opportunities.push({
        url: r.url,
        domain,
        type: 'guest-post',
        relevanceScore: score,
        notes: `Guest post opportunity. ${r.snippet.substring(0, 100)}`,
      });
    }
  }

  return opportunities;
}

// ─── Competitor Reference Scanner ───────────────────────────

async function findCompetitorReferences(competitors: string[], maxResults: number): Promise<BacklinkOpportunity[]> {
  const opportunities: BacklinkOpportunity[] = [];
  const seen = new Set<string>();

  for (const competitor of competitors) {
    if (opportunities.length >= maxResults) break;
    const cleanComp = competitor.replace(/^https?:\/\//, '').replace(/^www\./, '');
    const query = `"${cleanComp}" digital marketing OR remote team resources`;

    log.dim(`Competitor reference search: ${cleanComp}`);

    const results = await duckDuckGoSearch(query, 6);
    await sleep(1100);

    for (const r of results) {
      if (opportunities.length >= maxResults) break;
      const domain = extractDomain(r.url);
      if (seen.has(domain)) continue;
      if (isLikelySpam(r.url, r.snippet)) continue;
      if (domain === 'virtualcustomersolution.com') continue;
      if (domain === cleanComp) continue; // skip the competitor itself

      const accessible = await isAccessible(r.url);
      await sleep(1100);

      if (!accessible) continue;

      seen.add(domain);
      const score = scoreRelevance(r.url, r.title + ' ' + r.snippet, 'competitor-reference');
      opportunities.push({
        url: r.url,
        domain,
        type: 'competitor-reference',
        relevanceScore: score,
        notes: `References competitor ${cleanComp}. ${r.snippet.substring(0, 100)}`,
      });
    }
  }

  return opportunities;
}

// ─── Main Export ─────────────────────────────────────────────

export async function scanBacklinkOpportunities(options: BacklinkScanOptions): Promise<BacklinkOpportunity[]> {
  const { target, competitors, maxResults } = options;
  log.header('BACKLINK OPPORTUNITY SCANNER');
  log.info(`Target: ${target}`);
  log.info(`Competitors: ${competitors.length > 0 ? competitors.join(', ') : 'none'}`);
  log.info(`Max results: ${maxResults}`);
  log.divider();

  const allOpportunities: BacklinkOpportunity[] = [];

  // 1. Resource pages
  const perCategory = Math.ceil(maxResults / 3);
  log.subheader('1/3 — Resource Page Opportunities');
  const resourcePages = await findResourcePages(perCategory);
  log.success(`Found ${resourcePages.length} resource page opportunities`);
  allOpportunities.push(...resourcePages);

  // 2. Guest post opportunities
  log.subheader('2/3 — Guest Post Opportunities');
  const guestPosts = await findGuestPostOpportunities(perCategory);
  log.success(`Found ${guestPosts.length} guest post opportunities`);
  allOpportunities.push(...guestPosts);

  // 3. Competitor references (only if competitors provided)
  if (competitors.length > 0) {
    log.subheader('3/3 — Competitor Reference Opportunities');
    const remaining = maxResults - allOpportunities.length;
    const compRefs = await findCompetitorReferences(competitors, remaining);
    log.success(`Found ${compRefs.length} competitor reference opportunities`);
    allOpportunities.push(...compRefs);
  }

  // Sort by relevance score descending
  allOpportunities.sort((a, b) => b.relevanceScore - a.relevanceScore);

  const trimmed = allOpportunities.slice(0, maxResults);

  log.divider();
  log.success(`Total backlink opportunities found: ${trimmed.length}`);
  return trimmed;
}
