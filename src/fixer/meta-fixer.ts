import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { glob } from 'glob';
import { join, relative } from 'path';
import { log } from '../utils/logger.js';
import * as ai from '../ai/claude.js';

interface MetaFix {
  file: string;
  type: 'title-template' | 'title' | 'meta-description';
  current: string;
  proposed: string;
  line: number;
}

function findMetadataInFile(filePath: string, content: string): { title?: string; description?: string; titleLine?: number; descLine?: number; templateLine?: number; template?: string } {
  const lines = content.split('\n');
  let title: string | undefined;
  let description: string | undefined;
  let template: string | undefined;
  let titleLine: number | undefined;
  let descLine: number | undefined;
  let templateLine: number | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match title in metadata export
    const titleMatch = line.match(/title:\s*['"](.*?)['"]/);
    if (titleMatch) {
      title = titleMatch[1];
      titleLine = i + 1;
    }

    // Match description in metadata export
    const descMatch = line.match(/description:\s*['"](.*?)['"]/);
    if (descMatch) {
      description = descMatch[1];
      descLine = i + 1;
    }

    // Match title template (the duplicate brand name issue)
    const templateMatch = line.match(/template:\s*['"](.*?)['"]/);
    if (templateMatch) {
      template = templateMatch[1];
      templateLine = i + 1;
    }

    // Match default in title object
    const defaultMatch = line.match(/default:\s*['"](.*?)['"]/);
    if (defaultMatch && !title) {
      title = defaultMatch[1];
      titleLine = i + 1;
    }
  }

  return { title, description, titleLine, descLine, templateLine, template };
}

export async function scanMetaIssues(sourcePath: string): Promise<MetaFix[]> {
  log.subheader('Scanning Meta Tags in Source Code');

  const fixes: MetaFix[] = [];

  // Find all layout.tsx, page.tsx files
  const files = await glob('**/{layout,page}.{tsx,ts,jsx,js}', {
    cwd: sourcePath,
    ignore: ['node_modules/**', '.next/**', 'dist/**'],
    absolute: false,
  });

  log.info(`Found ${files.length} page/layout files`);

  for (const file of files) {
    const fullPath = join(sourcePath, file);
    const content = readFileSync(fullPath, 'utf-8');

    // Skip files without metadata
    if (!content.includes('metadata') && !content.includes('Metadata')) continue;

    const meta = findMetadataInFile(file, content);

    // Check title template for duplicate brand name
    if (meta.template && meta.templateLine) {
      const brandName = 'Virtual Customer Solution';
      const occurrences = (meta.template.match(new RegExp(brandName, 'gi')) || []).length;

      if (occurrences > 1 || (meta.template.includes('%s') && meta.template.split('|').length > 2)) {
        const fixedTemplate = `%s | ${brandName}`;
        fixes.push({
          file,
          type: 'title-template',
          current: meta.template,
          proposed: fixedTemplate,
          line: meta.templateLine,
        });
      }
    }

    // Check for missing or weak meta descriptions
    if (!meta.description && meta.title) {
      fixes.push({
        file,
        type: 'meta-description',
        current: '(missing)',
        proposed: '(will be AI-generated)',
        line: meta.titleLine || 0,
      });
    }
  }

  log.info(`Found ${fixes.length} meta issues to fix`);
  return fixes;
}

export async function applyMetaFixes(sourcePath: string, fixes: MetaFix[], useAi: boolean = false): Promise<number> {
  let fixedCount = 0;

  for (const fix of fixes) {
    const fullPath = join(sourcePath, fix.file);
    const content = readFileSync(fullPath, 'utf-8');

    // Backup
    copyFileSync(fullPath, fullPath + '.bak');

    let newContent = content;

    if (fix.type === 'title-template') {
      // Fix the template string
      newContent = content.replace(fix.current, fix.proposed);
      log.success(`Fixed title template in ${fix.file}`);
      fixedCount++;
    }

    if (fix.type === 'meta-description' && useAi && ai.isConfigured()) {
      // Generate meta description using AI
      const pageContent = content.substring(0, 2000);
      const proposed = await ai.generateMetaDescription(fix.file, '', pageContent);
      if (proposed) {
        fix.proposed = proposed;
        // Find where to insert the description
        const metadataMatch = content.match(/(export\s+const\s+metadata[^{]*\{)/);
        if (metadataMatch) {
          const insertPoint = content.indexOf(metadataMatch[0]) + metadataMatch[0].length;
          newContent = content.slice(0, insertPoint) + `\n  description: '${proposed.replace(/'/g, "\\'")}',` + content.slice(insertPoint);
          log.success(`Added AI-generated meta description to ${fix.file}`);
          fixedCount++;
        }
      }
    }

    if (newContent !== content) {
      writeFileSync(fullPath, newContent, 'utf-8');
    }
  }

  return fixedCount;
}

export function printMetaFixes(fixes: MetaFix[]): void {
  if (fixes.length === 0) {
    log.success('No meta tag issues found!');
    return;
  }

  log.subheader(`Found ${fixes.length} Meta Tag Issues`);

  for (const fix of fixes) {
    log.warn(`${fix.file} (line ${fix.line})`);
    console.log(`    Type:     ${fix.type}`);
    console.log(`    Current:  ${fix.current}`);
    console.log(`    Proposed: ${fix.proposed}`);
    console.log('');
  }

  console.log(`\nRun with --apply to fix these issues.`);
}
