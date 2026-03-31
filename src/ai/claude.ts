import Anthropic from '@anthropic-ai/sdk';
import { log } from '../utils/logger.js';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

async function ask(prompt: string, systemPrompt: string): Promise<string> {
  const anthropic = getClient();
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = response.content[0];
  if (block.type === 'text') return block.text;
  return '';
}

export async function generateAltText(imageSrc: string, pageContext: string): Promise<string> {
  const system = `You are an SEO expert. Generate a concise, descriptive alt text for an image.
Rules:
- Max 125 characters
- Be descriptive and specific
- Include relevant keywords naturally
- Don't start with "Image of" or "Picture of"
- Return ONLY the alt text, nothing else`;

  const prompt = `Generate alt text for this image:
Image source: ${imageSrc}
Page context: ${pageContext}`;

  return (await ask(prompt, system)).trim().replace(/^["']|["']$/g, '');
}

export async function generateMetaDescription(pageUrl: string, pageTitle: string, pageContent: string): Promise<string> {
  const system = `You are an SEO expert. Generate an optimized meta description.
Rules:
- 150-160 characters exactly
- Include a clear value proposition
- Include a call-to-action
- Use active voice
- Include the most important keyword naturally
- Return ONLY the meta description, nothing else`;

  const prompt = `Generate a meta description for this page:
URL: ${pageUrl}
Title: ${pageTitle}
Content summary: ${pageContent.substring(0, 500)}`;

  return (await ask(prompt, system)).trim().replace(/^["']|["']$/g, '');
}

export async function generateTitle(pageUrl: string, currentTitle: string, pageContent: string): Promise<string> {
  const system = `You are an SEO expert. Generate an optimized page title tag.
Rules:
- 50-60 characters
- Include primary keyword near the beginning
- Include brand name "Virtual Customer Solution" or "VCS" at the end after a pipe |
- Brand name should appear ONLY ONCE
- Be compelling and click-worthy
- Return ONLY the title tag text, nothing else`;

  const prompt = `Generate an optimized title tag:
URL: ${pageUrl}
Current title: ${currentTitle}
Content summary: ${pageContent.substring(0, 500)}`;

  return (await ask(prompt, system)).trim().replace(/^["']|["']$/g, '');
}

export async function generateSchema(schemaType: string, pageData: Record<string, unknown>): Promise<string> {
  const system = `You are an SEO expert specializing in structured data. Generate valid JSON-LD schema markup.
Rules:
- Output ONLY valid JSON (no markdown, no code blocks, no explanation)
- Use schema.org vocabulary
- Include all required properties for the schema type
- Be accurate with the data provided`;

  const prompt = `Generate ${schemaType} JSON-LD schema:
${JSON.stringify(pageData, null, 2)}`;

  const result = await ask(prompt, system);
  // Clean up any markdown code blocks
  return result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
}

export async function suggestInternalLinks(content: string, availablePages: { url: string; title: string }[]): Promise<{ anchor: string; url: string; reason: string }[]> {
  const system = `You are an SEO expert. Suggest internal link opportunities.
Rules:
- Find natural anchor text in the content that could link to available pages
- Max 5 suggestions
- Return a JSON array: [{"anchor": "text to link", "url": "/target-page", "reason": "why this link makes sense"}]
- Return ONLY the JSON array, nothing else`;

  const prompt = `Find internal link opportunities:
Content: ${content.substring(0, 1000)}
Available pages:
${availablePages.map(p => `- ${p.url}: ${p.title}`).join('\n')}`;

  try {
    const result = await ask(prompt, system);
    const cleaned = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return [];
  }
}

export function isConfigured(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return !!key && key !== 'your-api-key-here';
}
