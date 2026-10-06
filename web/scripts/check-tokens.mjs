// Проверка дизайн-системы: значения цветов и шрифтов живут только в tokens.css,
// запрещённые приёмы (градиенты, стекло, тени, капс с разрядкой) не используются нигде.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('../src/', import.meta.url).pathname;
const TOKENS = 'design/tokens.css';

const rules = [
  { re: /#[0-9a-fA-F]{3,8}\b/, msg: 'цвет в hex — используйте var(--color-*)', skipTokens: true },
  { re: /\b(rgba?|hsla?|hwb|oklch|lab|lch)\(/, msg: 'цвет функцией — используйте var(--color-*)', skipTokens: true },
  { re: /font-family\s*:(?!\s*var\()/, msg: 'шрифт напрямую — используйте var(--font-family)', skipTokens: true },
  { re: /font-weight\s*:(?!\s*var\()/, msg: 'вес шрифта напрямую — используйте var(--font-weight-*)', skipTokens: true },
  { re: /(linear|radial|conic)-gradient/, msg: 'градиенты запрещены' },
  { re: /backdrop-filter/, msg: 'эффект стекла запрещён' },
  { re: /box-shadow\s*:(?!\s*none)/, msg: 'тени запрещены' },
  { re: /text-transform\s*:\s*uppercase/, msg: 'капс запрещён' },
  { re: /letter-spacing/, msg: 'разрядка запрещена' },
];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const problems = [];
for (const file of walk(root).filter((f) => /\.(css|tsx?|jsx?)$/.test(f))) {
  const rel = relative(root, file);
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const r of rules) {
      if (r.skipTokens && rel === TOKENS) continue;
      if (r.re.test(line)) problems.push(`${rel}:${i + 1}  ${r.msg}\n    ${line.trim()}`);
    }
  });
}

if (problems.length) {
  console.error(`Нарушения дизайн-системы (${problems.length}):\n\n${problems.join('\n')}`);
  process.exit(1);
}
console.log('lint:tokens — ok');
