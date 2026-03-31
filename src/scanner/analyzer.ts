import type { CrawlResult, PageData } from './crawler.js';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface SeoIssue {
  severity: Severity;
  category: string;
  message: string;
  page: string;
  details?: string;
  fix?: string;
}

export interface AnalysisResult {
  score: number;
  issues: SeoIssue[];
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    total: number;
  };
  stats: {
    pagesScanned: number;
    imagesTotal: number;
    imagesWithoutAlt: number;
    pagesWithoutMeta: number;
    pagesWithDuplicateTitles: number;
    brokenLinks: number;
    pagesWithoutSchema: number;
    pagesWithoutOg: number;
    avgWordCount: number;
    avgLoadTime: number;
  };
}

function checkTitleTag(page: PageData): SeoIssue[] {
  const issues: SeoIssue[] = [];

  if (!page.title) {
    issues.push({
      severity: 'critical', category: 'Title Tag',
      message: 'Missing title tag', page: page.url,
      fix: 'Add a unique, keyword-rich title tag (50-60 characters)',
    });
  } else {
    if (page.title.length > 70) {
      issues.push({
        severity: 'medium', category: 'Title Tag',
        message: `Title too long (${page.title.length} chars)`, page: page.url,
        details: page.title,
        fix: 'Shorten title to under 70 characters',
      });
    }
    if (page.title.length < 30) {
      issues.push({
        severity: 'medium', category: 'Title Tag',
        message: `Title too short (${page.title.length} chars)`, page: page.url,
        details: page.title,
        fix: 'Expand title to at least 30 characters with target keywords',
      });
    }
    // Check for duplicate brand name
    const brandName = 'Virtual Customer Solution';
    const occurrences = (page.title.match(new RegExp(brandName, 'gi')) || []).length;
    if (occurrences > 1) {
      issues.push({
        severity: 'critical', category: 'Title Tag',
        message: `Brand name "${brandName}" appears ${occurrences} times in title`, page: page.url,
        details: page.title,
        fix: 'Fix the metadata template to include brand name only once',
      });
    }
  }

  return issues;
}

function checkMetaDescription(page: PageData): SeoIssue[] {
  const issues: SeoIssue[] = [];

  if (!page.metaDescription) {
    issues.push({
      severity: 'high', category: 'Meta Description',
      message: 'Missing meta description', page: page.url,
      fix: 'Add a compelling meta description (150-160 characters) with target keyword and CTA',
    });
  } else {
    if (page.metaDescription.length > 160) {
      issues.push({
        severity: 'low', category: 'Meta Description',
        message: `Meta description too long (${page.metaDescription.length} chars)`, page: page.url,
        details: page.metaDescription,
        fix: 'Shorten to under 160 characters',
      });
    }
    if (page.metaDescription.length < 70) {
      issues.push({
        severity: 'medium', category: 'Meta Description',
        message: `Meta description too short (${page.metaDescription.length} chars)`, page: page.url,
        details: page.metaDescription,
        fix: 'Expand to at least 120 characters for better CTR',
      });
    }
  }

  return issues;
}

function checkHeadings(page: PageData): SeoIssue[] {
  const issues: SeoIssue[] = [];

  if (page.h1s.length === 0) {
    issues.push({
      severity: 'high', category: 'Headings',
      message: 'Missing H1 tag', page: page.url,
      fix: 'Add exactly one H1 tag with the primary keyword',
    });
  } else if (page.h1s.length > 1) {
    issues.push({
      severity: 'medium', category: 'Headings',
      message: `Multiple H1 tags found (${page.h1s.length})`, page: page.url,
      details: page.h1s.join(' | '),
      fix: 'Use only one H1 per page. Convert extras to H2',
    });
  }

  if (page.h2s.length === 0 && page.wordCount > 300) {
    issues.push({
      severity: 'medium', category: 'Headings',
      message: 'No H2 tags found on content page', page: page.url,
      fix: 'Add H2 subheadings to break up content and improve readability',
    });
  }

  return issues;
}

function checkImages(page: PageData): SeoIssue[] {
  const issues: SeoIssue[] = [];

  const missingAlt = page.images.filter(img => !img.hasAlt);
  if (missingAlt.length > 0) {
    issues.push({
      severity: 'critical', category: 'Images',
      message: `${missingAlt.length} image(s) missing alt text`, page: page.url,
      details: missingAlt.map(img => img.src.substring(0, 80)).join(', '),
      fix: 'Add descriptive alt text to all images for accessibility and image SEO',
    });
  }

  return issues;
}

function checkOgTags(page: PageData): SeoIssue[] {
  const issues: SeoIssue[] = [];

  if (!page.ogTitle) {
    issues.push({
      severity: 'medium', category: 'Open Graph',
      message: 'Missing og:title', page: page.url,
      fix: 'Add og:title meta tag for better social media sharing',
    });
  }
  if (!page.ogDescription) {
    issues.push({
      severity: 'medium', category: 'Open Graph',
      message: 'Missing og:description', page: page.url,
      fix: 'Add og:description meta tag',
    });
  }
  if (!page.ogImage) {
    issues.push({
      severity: 'medium', category: 'Open Graph',
      message: 'Missing og:image', page: page.url,
      fix: 'Add og:image (1200x630px) for social media previews',
    });
  }
  if (!page.twitterCard) {
    issues.push({
      severity: 'low', category: 'Open Graph',
      message: 'Missing twitter:card', page: page.url,
      fix: 'Add twitter:card="summary_large_image" for Twitter previews',
    });
  }

  return issues;
}

function checkSchema(page: PageData): SeoIssue[] {
  const issues: SeoIssue[] = [];

  if (page.schemas.length === 0) {
    issues.push({
      severity: 'high', category: 'Structured Data',
      message: 'No JSON-LD schema markup found', page: page.url,
      fix: 'Add relevant schema (Organization, LocalBusiness, FAQPage, Article, Service, BreadcrumbList)',
    });
  } else {
    // Check for specific missing schemas
    const schemaText = page.schemas.join(' ');
    if (!schemaText.includes('BreadcrumbList')) {
      issues.push({
        severity: 'low', category: 'Structured Data',
        message: 'Missing BreadcrumbList schema', page: page.url,
        fix: 'Add BreadcrumbList schema for better SERP appearance',
      });
    }
  }

  return issues;
}

function checkCanonical(page: PageData): SeoIssue[] {
  const issues: SeoIssue[] = [];

  if (!page.canonical) {
    issues.push({
      severity: 'high', category: 'Canonical',
      message: 'Missing canonical URL', page: page.url,
      fix: 'Add <link rel="canonical"> pointing to the preferred URL',
    });
  }

  return issues;
}

function checkContent(page: PageData): SeoIssue[] {
  const issues: SeoIssue[] = [];

  if (page.wordCount < 300 && !page.url.includes('/contact') && !page.url.includes('/pricing') && !page.url.includes('/careers')) {
    issues.push({
      severity: 'medium', category: 'Content',
      message: `Thin content (${page.wordCount} words)`, page: page.url,
      fix: 'Add more substantive content (aim for 500+ words for informational pages)',
    });
  }

  return issues;
}

function checkPerformance(page: PageData): SeoIssue[] {
  const issues: SeoIssue[] = [];

  if (page.loadTimeMs > 3000) {
    issues.push({
      severity: 'high', category: 'Performance',
      message: `Slow page load (${(page.loadTimeMs / 1000).toFixed(1)}s)`, page: page.url,
      fix: 'Optimize images, minimize JS/CSS, enable caching',
    });
  } else if (page.loadTimeMs > 2000) {
    issues.push({
      severity: 'medium', category: 'Performance',
      message: `Page load could be faster (${(page.loadTimeMs / 1000).toFixed(1)}s)`, page: page.url,
      fix: 'Consider lazy loading images and deferring non-critical JS',
    });
  }

  return issues;
}

function checkDuplicates(pages: PageData[]): SeoIssue[] {
  const issues: SeoIssue[] = [];

  // Check duplicate titles
  const titleMap = new Map<string, string[]>();
  for (const page of pages) {
    if (page.title) {
      const existing = titleMap.get(page.title) || [];
      existing.push(page.url);
      titleMap.set(page.title, existing);
    }
  }

  for (const [title, urls] of titleMap) {
    if (urls.length > 1) {
      issues.push({
        severity: 'high', category: 'Duplicate Content',
        message: `Duplicate title tag found on ${urls.length} pages`, page: urls.join(', '),
        details: title,
        fix: 'Each page must have a unique title tag',
      });
    }
  }

  // Check duplicate meta descriptions
  const metaMap = new Map<string, string[]>();
  for (const page of pages) {
    if (page.metaDescription) {
      const existing = metaMap.get(page.metaDescription) || [];
      existing.push(page.url);
      metaMap.set(page.metaDescription, existing);
    }
  }

  for (const [meta, urls] of metaMap) {
    if (urls.length > 1) {
      issues.push({
        severity: 'medium', category: 'Duplicate Content',
        message: `Duplicate meta description on ${urls.length} pages`, page: urls.join(', '),
        details: meta.substring(0, 80) + '...',
        fix: 'Each page must have a unique meta description',
      });
    }
  }

  return issues;
}

function checkRobotsTxt(crawlResult: CrawlResult): SeoIssue[] {
  const issues: SeoIssue[] = [];

  if (!crawlResult.robotsTxt) {
    issues.push({
      severity: 'high', category: 'robots.txt',
      message: 'No robots.txt found', page: 'site-wide',
      fix: 'Create a robots.txt file with sitemap reference',
    });
  } else {
    // Check if important pages are blocked
    if (crawlResult.robotsTxt.includes('Disallow: /free-audit')) {
      issues.push({
        severity: 'high', category: 'robots.txt',
        message: '/free-audit is blocked in robots.txt', page: 'robots.txt',
        details: 'This is likely a high-value landing page that should be indexed',
        fix: 'Remove "Disallow: /free-audit" from robots.txt',
      });
    }
  }

  if (crawlResult.sitemapUrls.length === 0) {
    issues.push({
      severity: 'high', category: 'Sitemap',
      message: 'No XML sitemap found or sitemap is empty', page: 'site-wide',
      fix: 'Create and submit an XML sitemap to Google Search Console',
    });
  }

  return issues;
}

export function analyzeCrawlResults(crawlResult: CrawlResult): AnalysisResult {
  const issues: SeoIssue[] = [];

  // Per-page checks
  for (const page of crawlResult.pages) {
    issues.push(
      ...checkTitleTag(page),
      ...checkMetaDescription(page),
      ...checkHeadings(page),
      ...checkImages(page),
      ...checkOgTags(page),
      ...checkSchema(page),
      ...checkCanonical(page),
      ...checkContent(page),
      ...checkPerformance(page),
    );
  }

  // Site-wide checks
  issues.push(...checkDuplicates(crawlResult.pages));
  issues.push(...checkRobotsTxt(crawlResult));

  // Broken links
  for (const broken of crawlResult.brokenLinks) {
    issues.push({
      severity: 'critical', category: 'Broken Links',
      message: `Broken link (${broken.statusCode || 'no response'})`, page: broken.url,
      details: `Found on: ${broken.foundOn}`,
      fix: 'Fix or redirect this URL',
    });
  }

  // Calculate summary
  const summary = {
    critical: issues.filter(i => i.severity === 'critical').length,
    high: issues.filter(i => i.severity === 'high').length,
    medium: issues.filter(i => i.severity === 'medium').length,
    low: issues.filter(i => i.severity === 'low').length,
    total: issues.length,
  };

  // Calculate score using weighted category-based approach
  // Each category starts at 100%, issues reduce that category's score
  // Final score is weighted average across all categories
  const pages = crawlResult.pages.length || 1;

  // Category scores (percentage of pages passing each check)
  const pagesWithTitle = crawlResult.pages.filter(p => p.title).length;
  const pagesWithGoodTitle = crawlResult.pages.filter(p => p.title && p.title.length <= 70).length;
  const pagesWithMeta = crawlResult.pages.filter(p => p.metaDescription).length;
  const pagesWithH1 = crawlResult.pages.filter(p => p.h1s.length === 1).length;
  // Count pages with OG tags - check both crawl data and issue-based detection
  let pagesWithOg = crawlResult.pages.filter(p => p.ogTags?.title || p.ogTags?.description || p.ogTags?.image).length;
  // If no OG issues were detected but crawl data shows 0, trust the issue detector
  const ogIssueCount = issues.filter(i => i.category === 'Open Graph').length;
  if (ogIssueCount === 0 && pagesWithOg === 0) pagesWithOg = pages;
  const pagesWithSchema = crawlResult.pages.filter(p => p.schemas && p.schemas.length > 0).length;
  const totalImages = crawlResult.pages.reduce((s, p) => s + p.images.length, 0) || 1;
  const imagesWithAlt = crawlResult.pages.reduce((s, p) => s + p.images.filter(i => i.hasAlt).length, 0);

  const titleScore = (pagesWithTitle / pages) * 100;              // Have title at all
  const titleLenScore = (pagesWithGoodTitle / pages) * 100;       // Title under 60 chars
  const metaScore = (pagesWithMeta / pages) * 100;                // Have meta description
  const h1Score = (pagesWithH1 / pages) * 100;                    // Exactly one H1
  const ogScore = (pagesWithOg / pages) * 100;                    // Have OG tags
  const schemaScore = (pagesWithSchema / pages) * 100;            // Have schema
  const altScore = (imagesWithAlt / totalImages) * 100;           // Images have alt
  const brokenLinkScore = summary.critical === 0 ? 100 : Math.max(0, 100 - summary.critical * 15);

  // Debug category scores
  console.log(`  [scoring] title: ${titleScore.toFixed(0)}%, titleLen: ${titleLenScore.toFixed(0)}%, meta: ${metaScore.toFixed(0)}%, h1: ${h1Score.toFixed(0)}%, og: ${ogScore.toFixed(0)}%, schema: ${schemaScore.toFixed(0)}%, alt: ${altScore.toFixed(0)}%, broken: ${brokenLinkScore}, bonus: ${summary.high === 0 ? 5 : 0}`);

  // Weighted average (weights reflect SEO importance)
  const score = Math.round(
    titleScore * 0.15 +        // 15% — having titles
    titleLenScore * 0.05 +     // 5%  — title length optimization
    metaScore * 0.15 +         // 15% — meta descriptions
    h1Score * 0.10 +           // 10% — heading structure
    ogScore * 0.10 +           // 10% — social/OG tags
    schemaScore * 0.10 +       // 10% — structured data
    altScore * 0.10 +          // 10% — image accessibility
    brokenLinkScore * 0.20 +   // 20% — no broken links (most critical)
    (summary.high === 0 ? 5 : 0)  // 5% bonus for zero high issues
  );


  // Calculate stats
  const imagesWithoutAlt = crawlResult.pages.reduce(
    (sum, p) => sum + p.images.filter(img => !img.hasAlt).length, 0
  );
  const pagesWithoutMeta = crawlResult.pages.filter(p => !p.metaDescription).length;
  const avgWordCount = crawlResult.pages.length > 0
    ? Math.round(crawlResult.pages.reduce((sum, p) => sum + p.wordCount, 0) / crawlResult.pages.length)
    : 0;
  const avgLoadTime = crawlResult.pages.length > 0
    ? Math.round(crawlResult.pages.reduce((sum, p) => sum + p.loadTimeMs, 0) / crawlResult.pages.length)
    : 0;

  // Duplicate title count
  const titleCounts = new Map<string, number>();
  for (const page of crawlResult.pages) {
    if (page.title) titleCounts.set(page.title, (titleCounts.get(page.title) || 0) + 1);
  }
  const pagesWithDuplicateTitles = Array.from(titleCounts.values()).filter(c => c > 1).reduce((sum, c) => sum + c, 0);

  return {
    score,
    issues,
    summary,
    stats: {
      pagesScanned: crawlResult.totalPages,
      imagesTotal: crawlResult.totalImages,
      imagesWithoutAlt,
      pagesWithoutMeta,
      pagesWithDuplicateTitles,
      brokenLinks: crawlResult.brokenLinks.length,
      pagesWithoutSchema: crawlResult.pages.filter(p => p.schemas.length === 0).length,
      pagesWithoutOg: crawlResult.pages.filter(p => !p.ogTitle).length,
      avgWordCount,
      avgLoadTime,
    },
  };
}
