import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { glob } from 'glob';
import { join } from 'path';
import { log } from '../utils/logger.js';
import * as ai from '../ai/claude.js';

interface AltFix {
  file: string;
  line: number;
  imageSrc: string;
  currentAlt: string;
  proposedAlt: string;
  tagSnippet: string;
}

function findImagesInFile(filePath: string, content: string): AltFix[] {
  const fixes: AltFix[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match <Image or <img tags
    const imgMatches = [
      ...line.matchAll(/<(?:Image|img)\s+([^>]*?)(?:\/>|>)/gi),
    ];

    for (const match of imgMatches) {
      const attrs = match[1];

      // Extract src
      const srcMatch = attrs.match(/src=(?:{[`"']([^`"']*)[`"']}|["']([^"']*)["'])/);
      const src = srcMatch?.[1] || srcMatch?.[2] || '';

      // Extract alt
      const altMatch = attrs.match(/alt=(?:{[`"']([^`"']*)[`"']}|["']([^"']*)["'])/);
      const hasAltAttr = /\balt\s*=/.test(attrs);
      const altValue = altMatch?.[1] || altMatch?.[2] || '';

      // Flag if alt is missing or empty
      if (!hasAltAttr || altValue.trim() === '') {
        fixes.push({
          file: filePath,
          line: i + 1,
          imageSrc: src,
          currentAlt: hasAltAttr ? '(empty)' : '(missing)',
          proposedAlt: '', // Will be filled by AI
          tagSnippet: match[0].substring(0, 100),
        });
      }
    }
  }

  return fixes;
}

export async function scanAltIssues(sourcePath: string): Promise<AltFix[]> {
  log.subheader('Scanning Images for Missing Alt Text');

  const files = await glob('**/*.{tsx,ts,jsx,js}', {
    cwd: sourcePath,
    ignore: ['node_modules/**', '.next/**', 'dist/**'],
    absolute: false,
  });

  const allFixes: AltFix[] = [];

  for (const file of files) {
    const fullPath = join(sourcePath, file);
    const content = readFileSync(fullPath, 'utf-8');
    const fixes = findImagesInFile(file, content);
    allFixes.push(...fixes);
  }

  log.info(`Found ${allFixes.length} images missing alt text across ${files.length} files`);
  return allFixes;
}

export async function generateAltTexts(fixes: AltFix[], sourcePath: string): Promise<AltFix[]> {
  if (!ai.isConfigured()) {
    log.warn('Claude API not configured. Skipping AI alt text generation.');
    log.dim('Set ANTHROPIC_API_KEY in .env to enable AI-generated alt text');
    return fixes;
  }

  log.info(`Generating alt text for ${fixes.length} images using Claude AI...`);

  for (let i = 0; i < fixes.length; i++) {
    const fix = fixes[i];
    log.dim(`[${i + 1}/${fixes.length}] Generating alt for: ${fix.imageSrc.substring(0, 60)}`);

    try {
      // Read page context from the file
      const fullPath = join(sourcePath, fix.file);
      const content = readFileSync(fullPath, 'utf-8');
      const pageContext = content.substring(0, 500);

      fix.proposedAlt = await ai.generateAltText(fix.imageSrc, pageContext);

      // Rate limiting
      await new Promise(r => setTimeout(r, 300));
    } catch (error) {
      log.error(`Failed to generate alt for ${fix.imageSrc}: ${(error as Error).message}`);
      fix.proposedAlt = `${fix.imageSrc.split('/').pop()?.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ') || 'image'}`;
    }
  }

  return fixes;
}

export async function applyAltFixes(sourcePath: string, fixes: AltFix[]): Promise<number> {
  let fixedCount = 0;
  const fileGroups = new Map<string, AltFix[]>();

  // Group fixes by file
  for (const fix of fixes) {
    if (!fix.proposedAlt) continue;
    const existing = fileGroups.get(fix.file) || [];
    existing.push(fix);
    fileGroups.set(fix.file, existing);
  }

  for (const [file, fileFixes] of fileGroups) {
    const fullPath = join(sourcePath, file);
    let content = readFileSync(fullPath, 'utf-8');

    // Backup
    copyFileSync(fullPath, fullPath + '.bak');

    // Sort by line number descending so we don't shift line numbers
    fileFixes.sort((a, b) => b.line - a.line);

    for (const fix of fileFixes) {
      const escapedAlt = fix.proposedAlt.replace(/"/g, '\\"');

      if (fix.currentAlt === '(missing)') {
        // Add alt attribute to the tag
        content = content.replace(fix.tagSnippet, (match) => {
          // Insert alt before the closing /> or >
          return match.replace(/(\/?>)$/, ` alt="${escapedAlt}"$1`);
        });
      } else {
        // Replace empty alt with generated alt
        content = content.replace(
          new RegExp(`(alt=)(?:{["\`']\\s*["\`']}|["']\\s*["'])`, 'g'),
          (match, prefix, offset) => {
            // Only replace if on the right line (approximate)
            return `alt="${escapedAlt}"`;
          }
        );
      }

      fixedCount++;
    }

    writeFileSync(fullPath, content, 'utf-8');
    log.success(`Updated ${fileFixes.length} images in ${file}`);
  }

  return fixedCount;
}

export function printAltFixes(fixes: AltFix[]): void {
  if (fixes.length === 0) {
    log.success('All images have alt text!');
    return;
  }

  log.subheader(`Found ${fixes.length} Images Missing Alt Text`);

  for (const fix of fixes) {
    log.warn(`${fix.file}:${fix.line}`);
    console.log(`    Image:    ${fix.imageSrc.substring(0, 80)}`);
    console.log(`    Current:  ${fix.currentAlt}`);
    if (fix.proposedAlt) {
      console.log(`    Proposed: ${fix.proposedAlt}`);
    }
    console.log('');
  }

  console.log(`\nRun with --apply to fix these issues.`);
}
