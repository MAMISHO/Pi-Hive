import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

export interface PignoreExtensionOptions {
  cwd: string;
  filename?: string;
}

type Rule = { regex: RegExp; dirOnly: boolean; negated: boolean };

function globToRegex(pattern: string, anchored: boolean, dirOnly: boolean): RegExp {
  let p = pattern.replace(/\\/g, '/');
  if (p.startsWith('/')) p = p.slice(1);
  if (p.endsWith('/')) p = p.slice(0, -1);

  let re = '';
  let i = 0;
  while (i < p.length) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        // **/ or **
        if (p[i + 2] === '/') { re += '(?:.*/)?'; i += 3; }
        else { re += '.*'; i += 2; }
      } else { re += '[^/]*'; i += 1; }
    } else if (c === '?') { re += '[^/]'; i += 1; }
    else if ('\\.[]{}()+-^$|'.includes(c)) { re += '\\' + c; i += 1; }
    else { re += c; i += 1; }
  }

  const prefix = anchored ? '' : '(?:^|.*/)';
  const suffix = dirOnly ? '(?:/.*)?$' : '(?:/.*)?$';
  // match the path itself or (for dir patterns / general) descendants
  return new RegExp('^' + prefix + re + suffix);
}

export function loadPignoreRules(cwd: string, filename = '.pignore'): Rule[] {
  const file = path.join(cwd, filename);
  if (!existsSync(file)) return [];
  let content = '';
  try { content = readFileSync(file, 'utf8'); } catch { return []; }
  const rules: Rule[] = [];
  for (let raw of content.split(/\r?\n/)) {
    let line = raw.replace(/\r$/, '');
    // trim trailing spaces (unescaped)
    line = line.replace(/(?<!\\)\s+$/, '');
    if (!line || line.startsWith('#')) continue;
    let negated = false;
    if (line.startsWith('!')) { negated = true; line = line.slice(1); }
    if (!line) continue;
    const dirOnly = line.endsWith('/');
    // anchored if starts with / or contains / in middle (gitignore semantics)
    const core = line.replace(/^\/+/, '').replace(/\/+$/, '');
    const anchored = line.startsWith('/') || core.includes('/');
    try {
      rules.push({ regex: globToRegex(line, anchored, dirOnly), dirOnly, negated });
    } catch { /* skip invalid */ }
  }
  return rules;
}

export function isPignored(relPath: string, rules: Rule[]): boolean {
  let p = relPath.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
  if (!p || p === '.') return false;
  let ignored = false;
  for (const r of rules) {
    if (r.regex.test(p)) ignored = !r.negated;
  }
  return ignored;
}

function toRel(candidate: any, cwd: string): string | null {
  if (candidate == null) return null;
  const s = String(candidate).trim();
  if (!s) return null;
  const abs = path.isAbsolute(s) ? path.resolve(s) : path.resolve(cwd, s);
  const rel = path.relative(cwd, abs);
  if (!rel || rel === '') return '.';
  if (rel.startsWith('..' + path.sep) || rel === '..') return null; // outside cwd: don't treat as pignored
  return rel.split(path.sep).join('/');
}

function blocked(reasonPath?: string) {
  const suffix = reasonPath ? ` (${reasonPath})` : '';
  return { block: true as const, reason: `Ruta excluida por .pignore del workspace${suffix}.` };
}

function extractBashPaths(command: string, cwd: string): string[] {
  const out: string[] = [];
  if (!command) return out;
  // quoted and unquoted tokens (simple heuristic)
  const re = /"([^"]*)"|'([^']*)'|`([^`]*)`|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(command))) {
    const tok = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim();
    if (!tok) continue;
    // consider absolute paths, relative (./ ../), home-ish, or tokens containing a slash
    if (tok.startsWith('/') || tok.startsWith('./') || tok.startsWith('../') || tok.includes('/')) {
      out.push(tok);
    }
  }
  return out;
}

function extractText(result: any): string {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  if (Array.isArray(result?.content)) {
    return result.content.map((c: any) => (typeof c === 'string' ? c : (c?.text ?? ''))).join('');
  }
  if (typeof result?.text === 'string') return result.text;
  if (typeof result?.output === 'string') return result.output;
  if (typeof result?.stdout === 'string') return result.stdout;
  return '';
}

function withText(result: any, text: string): any {
  if (result == null) return text;
  if (typeof result === 'string') return text;
  if (Array.isArray(result?.content)) {
    const content = result.content.map((c: any) => ({ ...c }));
    let replaced = false;
    for (const c of content) {
      if (c && typeof c === 'object' && typeof c.text === 'string' && !replaced) { c.text = text; replaced = true; }
    }
    if (!replaced) content.unshift({ type: 'text', text });
    return { ...result, content };
  }
  if (typeof result?.text === 'string') return { ...result, text };
  if (typeof result?.output === 'string') return { ...result, output: text };
  if (typeof result?.stdout === 'string') return { ...result, stdout: text };
  return { ...result, content: [{ type: 'text', text }] };
}

function filterListingText(text: string, cwd: string, rules: Rule[]): { text: string; removed: number } {
  if (!text) return { text, removed: 0 };
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  let removed = 0;
  for (const line of lines) {
    const raw = line.trim();
    if (!raw) { kept.push(line); continue; }
    // try full line as path, then first token (ls/find outputs)
    const candidates = [raw, raw.split(/\s+/)[0]];
    let hit = false;
    for (const cand of candidates) {
      if (!cand || cand === '.' || cand === '..') continue;
      const rel = toRel(cand, cwd);
      if (rel && rel !== '.' && isPignored(rel, rules)) { hit = true; break; }
    }
    if (hit) { removed++; continue; }
    kept.push(line);
  }
  if (removed > 0) kept.push(`[.pignore] ${removed} ruta(s) excluida(s) ocultas.`);
  return { text: kept.join('\n'), removed };
}

function isListingLikeBash(command: string): boolean {
  const c = String(command || '').toLowerCase();
  return /\b(ls|find|tree|fd|rg\s+--files|git\s+ls-files)\b/.test(c);
}

export function createPignoreExtension(options: PignoreExtensionOptions) {
  const cwd = path.resolve(options.cwd);
  const rules = loadPignoreRules(cwd, options.filename || '.pignore');
  return (pi: any) => {
    if (!rules.length) return;
    const check = (candidate: any) => {
      const rel = toRel(candidate, cwd);
      return rel && rel !== '.' && isPignored(rel, rules) ? rel : null;
    };
    const recentBash = new Map<string, { cmd: string; ts: number }>();
    const remember = (id: any, cmd: string) => { const k = String(id || ''); if (k) recentBash.set(k, { cmd, ts: Date.now() }); };
    const recall = (id: any) => { const k = String(id || ''); const v = recentBash.get(k); if (v) recentBash.delete(k); return v?.cmd || ''; };

    pi.on('tool_call', async (event: any) => {
      const name = String(event?.toolName || event?.tool_name || event?.name || '');
      const input = event?.input || event?.args || {};
      const callId = event?.toolCallId || event?.tool_call_id || event?.id;
      if (name === 'read' || name === 'edit' || name === 'write') {
        const p = input.path ?? input.file_path ?? input.filePath;
        const hit = check(p);
        if (hit) return blocked(hit);
      } else if (name === 'ls' || name === 'find' || name === 'grep') {
        const p = input.path ?? input.directory ?? input.dir ?? input.cwd;
        if (p != null && String(p).trim() !== '') {
          const hit = check(p);
          if (hit) return blocked(hit);
        }
        // also guard glob/pattern if it looks like a path into ignored area
        const g = input.glob ?? input.pattern;
        if (typeof g === 'string' && (g.startsWith('/') || g.startsWith('./') || g.startsWith('../'))) {
          const hit = check(g.split('*')[0].split('?')[0]);
          if (hit) return blocked(hit);
        }
      } else if (name === 'bash' || name === 'shell' || name === 'exec') {
        const cmd = String(input.command || input.cmd || '');
        remember(callId, cmd);
        for (const tok of extractBashPaths(cmd, cwd)) {
          const hit = check(tok);
          if (hit) return blocked(hit);
        }
      }
      return undefined;
    });

    pi.on('tool_result', async (event: any) => {
      const name = String(event?.toolName || event?.tool_name || event?.name || '');
      const callId = event?.toolCallId || event?.tool_call_id || event?.id;
      const input = event?.input || event?.args || {};
      const isListing = (name === 'ls' || name === 'find' || name === 'grep')
        || ((name === 'bash' || name === 'shell' || name === 'exec') && isListingLikeBash(String(input.command || input.cmd || recall(callId))));
      if (!isListing) return undefined;
      const result = event?.result ?? event?.output ?? event?.content;
      const txt = extractText(result);
      if (!txt) return undefined;
      const filtered = filterListingText(txt, cwd, rules);
      if (filtered.removed <= 0) return undefined;
      const next = withText(result, filtered.text);
      if (event && 'result' in event) return { result: next };
      if (event && 'output' in event) return { output: next };
      return { result: next };
    });
  };
}

export default createPignoreExtension;
