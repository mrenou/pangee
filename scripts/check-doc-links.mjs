#!/usr/bin/env node
/**
 * Vérifie que tout lien markdown relatif pointe vers un fichier existant, et
 * que chaque CLAUDE.md tient sous la limite de lignes. Voir docs/CLAUDE.md.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const MAX_CLAUDE_LINES = 30;
const SKIP = new Set(['node_modules', 'dist', '.git', 'coverage', '.serena']);

function markdownFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...markdownFiles(full));
    else if (entry.endsWith('.md')) found.push(full);
  }
  return found;
}

const problems = [];

for (const file of markdownFiles(process.cwd())) {
  const content = readFileSync(file, 'utf8');

  for (const [, link] of content.matchAll(/\]\(([^)]+)\)/g)) {
    if (/^(https?:|mailto:|#)/.test(link)) continue;
    const target = resolve(dirname(file), link.split('#')[0]);
    try {
      statSync(target);
    } catch {
      problems.push(`${file} : lien cassé vers ${link}`);
    }
  }

  if (file.endsWith('CLAUDE.md')) {
    const lines = content.trimEnd().split('\n').length;
    if (lines > MAX_CLAUDE_LINES) {
      problems.push(`${file} : ${lines} lignes, la limite est ${MAX_CLAUDE_LINES}`);
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('Documentation : liens valides, CLAUDE.md dans la limite.');
