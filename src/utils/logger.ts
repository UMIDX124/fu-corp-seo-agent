const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

export const log = {
  info: (msg: string) => console.log(`${COLORS.cyan}ℹ${COLORS.reset} ${msg}`),
  success: (msg: string) => console.log(`${COLORS.green}✓${COLORS.reset} ${msg}`),
  warn: (msg: string) => console.log(`${COLORS.yellow}⚠${COLORS.reset} ${msg}`),
  error: (msg: string) => console.log(`${COLORS.red}✗${COLORS.reset} ${msg}`),
  critical: (msg: string) => console.log(`${COLORS.red}${COLORS.bold}🔴 CRITICAL:${COLORS.reset} ${msg}`),
  high: (msg: string) => console.log(`${COLORS.yellow}${COLORS.bold}🟡 HIGH:${COLORS.reset} ${msg}`),
  medium: (msg: string) => console.log(`${COLORS.blue}🔵 MEDIUM:${COLORS.reset} ${msg}`),
  low: (msg: string) => console.log(`${COLORS.gray}⚪ LOW:${COLORS.reset} ${msg}`),
  header: (msg: string) => console.log(`\n${COLORS.bold}${COLORS.cyan}${'═'.repeat(60)}${COLORS.reset}\n${COLORS.bold}  ${msg}${COLORS.reset}\n${COLORS.bold}${COLORS.cyan}${'═'.repeat(60)}${COLORS.reset}\n`),
  subheader: (msg: string) => console.log(`\n${COLORS.bold}${COLORS.white}── ${msg} ──${COLORS.reset}\n`),
  dim: (msg: string) => console.log(`${COLORS.dim}  ${msg}${COLORS.reset}`),
  table: (data: Record<string, string | number>[]) => console.table(data),
  divider: () => console.log(`${COLORS.gray}${'─'.repeat(60)}${COLORS.reset}`),
  score: (score: number) => {
    const color = score >= 80 ? COLORS.green : score >= 50 ? COLORS.yellow : COLORS.red;
    console.log(`\n${COLORS.bold}  SEO Score: ${color}${score}/100${COLORS.reset}\n`);
  },
};
