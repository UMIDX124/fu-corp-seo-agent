import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';
import { glob } from 'glob';
import { log } from '../utils/logger.js';
import * as ai from '../ai/claude.js';

interface SchemaFix {
  file: string;
  schemaType: string;
  proposed: string;
  action: 'create' | 'update';
}

const ORGANIZATION_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'ProfessionalService',
  name: 'Virtual Customer Solution',
  url: 'https://www.virtualcustomersolution.com',
  logo: 'https://www.virtualcustomersolution.com/Virtual.png',
  description: 'AI-powered digital marketing, remote workforce, and web development solutions',
  address: {
    '@type': 'PostalAddress',
    streetAddress: '114 McLeod Rd',
    addressLocality: 'Lahore',
    addressCountry: 'PK',
  },
  telephone: '+92-315-1407896',
  email: 'adminatvcs@gmail.com',
  openingHours: 'Mo-Sa 10:00-19:00',
  priceRange: '$399-$2499/mo',
  sameAs: [
    'https://www.facebook.com/virtualcustomersolution',
    'https://www.instagram.com/virtualcustomersolution',
    'https://www.linkedin.com/company/virtualcustomersolution',
  ],
};

const BREADCRUMB_SCHEMA = (items: { name: string; url: string }[]) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((item, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: item.name,
    item: item.url,
  })),
});

export async function scanSchemaIssues(sourcePath: string): Promise<SchemaFix[]> {
  log.subheader('Scanning for Missing Schema Markup');

  const fixes: SchemaFix[] = [];

  // Check for schema component
  const schemaFiles = await glob('**/schema*.{tsx,ts,jsx,js}', {
    cwd: sourcePath,
    ignore: ['node_modules/**', '.next/**', 'dist/**'],
  });

  // Check layout files for existing schemas
  const layoutFiles = await glob('**/layout.{tsx,ts,jsx,js}', {
    cwd: sourcePath,
    ignore: ['node_modules/**', '.next/**', 'dist/**'],
  });

  let hasOrgSchema = false;

  for (const file of [...layoutFiles, ...schemaFiles]) {
    const content = readFileSync(join(sourcePath, file), 'utf-8');
    if (content.includes('ProfessionalService') || content.includes('Organization')) {
      hasOrgSchema = true;
    }
  }

  if (!hasOrgSchema) {
    fixes.push({
      file: 'src/components/schemas/organization-schema.tsx',
      schemaType: 'Organization/ProfessionalService',
      proposed: JSON.stringify(ORGANIZATION_SCHEMA, null, 2),
      action: 'create',
    });
  }

  // Check for FAQ schema on pages with FAQ content
  const pageFiles = await glob('**/page.{tsx,ts,jsx,js}', {
    cwd: sourcePath,
    ignore: ['node_modules/**', '.next/**', 'dist/**'],
  });

  for (const file of pageFiles) {
    const content = readFileSync(join(sourcePath, file), 'utf-8');
    if ((content.includes('FAQ') || content.includes('faq') || content.includes('Frequently')) && !content.includes('FAQPage')) {
      fixes.push({
        file,
        schemaType: 'FAQPage',
        proposed: '(will be AI-generated from FAQ content)',
        action: 'update',
      });
    }
  }

  log.info(`Found ${fixes.length} schema issues`);
  return fixes;
}

export async function applySchemaFixes(sourcePath: string, fixes: SchemaFix[]): Promise<number> {
  let fixedCount = 0;

  for (const fix of fixes) {
    if (fix.action === 'create') {
      const fullPath = join(sourcePath, fix.file);
      const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));

      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const componentContent = `export default function OrganizationSchema() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(${fix.proposed})
      }}
    />
  );
}
`;
      writeFileSync(fullPath, componentContent, 'utf-8');
      log.success(`Created schema component: ${fix.file}`);
      fixedCount++;
    }
  }

  return fixedCount;
}

export function printSchemaFixes(fixes: SchemaFix[]): void {
  if (fixes.length === 0) {
    log.success('Schema markup looks good!');
    return;
  }

  log.subheader(`Found ${fixes.length} Schema Issues`);

  for (const fix of fixes) {
    log.warn(`${fix.file}`);
    console.log(`    Schema:   ${fix.schemaType}`);
    console.log(`    Action:   ${fix.action}`);
    if (fix.proposed.length < 200) {
      console.log(`    Preview:  ${fix.proposed.substring(0, 150)}`);
    }
    console.log('');
  }

  console.log(`\nRun with --apply to create/update schemas.`);
}
