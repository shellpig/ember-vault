#!/usr/bin/env node
/**
 * Move-diff verifier for the engine.ts split (docs/engine-refactor-plan.md §4.1).
 *
 * Baseline = `git show <base>:src/game/engine.ts` (default `origin/main`, override with `--base <ref>`).
 * Current  = src/game/engine.ts + src/game/engine/**\/*.ts
 *
 * It checks that
 *   1. the set of class members (methods + fields + statics) is identical (old class vs new class + method objects),
 *   2. every member is identical after normalization (modifiers private/protected/public, `this: EmbervaultEngine`
 *      param, explicit return types, indentation, blank lines, object-method trailing comma are ignored),
 *   3. every module-level declaration (const / function / interface / type) is identical after normalization
 *      (a leading `export` is ignored) and that none is duplicated or missing.
 *
 * Plain Node, no dependencies. Exit code 0 = PASS, 1 = FAIL.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MOD_RE = /^(?:(?:private|public|protected)\s+)?/;

// ---------------------------------------------------------------------------------------------------------------
// Block parser: splits a container (class body, method object or the module top level) into items by indentation.
// ---------------------------------------------------------------------------------------------------------------

const indentOf = (l) => l.length - l.trimStart().length;
const isBlank = (l) => l.trim() === '';

/** Parses items of a container whose members sit at column `ind`, between lines (from, to) exclusive. */
export function parseItems(lines, from, to, ind) {
  const items = [];
  let i = from;
  const startsMember = (l) => !isBlank(l) && indentOf(l) === ind && !/^\s*[})\]]/.test(l);
  const continues = (l) => !isBlank(l) && (indentOf(l) > ind || (indentOf(l) === ind && /^\s*[})\]`]/.test(l)));
  while (i < to) {
    if (isBlank(lines[i])) { i++; continue; }
    if (indentOf(lines[i]) !== ind) { i++; continue; }
    // leading / standalone comment group
    let head = i;
    let commentStart = -1;
    while (head < to && indentOf(lines[head]) === ind && /^\s*(\/\*|\/\/|\*)/.test(lines[head])) {
      if (commentStart < 0) commentStart = head;
      if (/^\s*\/\*/.test(lines[head]) && !lines[head].includes('*/')) {
        head++;
        while (head < to && !lines[head].includes('*/')) head++;
      }
      head++;
    }
    if (head > i) {
      if (head >= to || isBlank(lines[head])) { // standalone banner comment
        items.push({ kind: 'comment', start: i, head: i, end: head - 1 });
        i = head;
        continue;
      }
    }
    if (!startsMember(lines[head])) { i = head + 1; continue; }
    let end = head;
    for (let j = head + 1; j < to; j++) {
      if (isBlank(lines[j])) continue;
      if (continues(lines[j])) end = j;
      else break;
    }
    items.push({ kind: 'member', start: i, head, end });
    i = end + 1;
  }
  return items;
}

/** Describes the first line of a class member / object method / top-level declaration. */
export function describeHead(line) {
  let t = line.trim();
  let isStatic = false;
  let kind = 'field';
  for (;;) {
    const m = /^(private|public|protected|readonly|static|async|abstract|override)\s+/.exec(t);
    if (!m) break;
    if (m[1] === 'static') isStatic = true;
    t = t.slice(m[0].length);
  }
  const acc = /^(get|set)\s+([A-Za-z_$][\w$]*)/.exec(t);
  if (acc) return { name: `${acc[1]} ${acc[2]}`, isStatic, kind: 'accessor' };
  const nm = /^([A-Za-z_$][\w$]*)/.exec(t);
  if (!nm) return { name: `?${t.slice(0, 20)}`, isStatic, kind: 'unknown' };
  const rest = t.slice(nm[1].length);
  if (/^\s*(<[^(]*>)?\s*\(/.test(rest)) kind = 'method';
  return { name: nm[1], isStatic, kind };
}

const squash = (s) => s.replace(/\s+/g, '');

/**
 * Normalizes one member: drops modifiers, `this: EmbervaultEngine`, return type, whitespace and blank lines.
 * Methods are split into header (modifiers kept for `async`/`static`, params) and body.
 */
export function normalizeMember(lines, item) {
  const raw = lines.slice(item.head, item.end + 1);
  const info = describeHead(raw[0]);
  const text = raw.map((l) => l.trim()).filter((l) => l !== '');
  if (info.kind !== 'method') {
    text[0] = text[0].replace(MOD_RE, '');
    return { info, norm: text.join('\n') };
  }
  // method: strip leading access modifiers, find the matching ")" of the parameter list
  let joined = raw.join('\n');
  joined = joined.replace(/^\s*(?:(?:private|public|protected)\s+)/, '');
  const open = joined.indexOf('(');
  let depth = 0;
  let close = -1;
  for (let k = open; k < joined.length; k++) {
    const c = joined[k];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) { close = k; break; } }
  }
  if (close < 0) return { info, norm: squash(joined) };
  const prefix = joined.slice(0, open).trim();
  const params = squash(joined.slice(open + 1, close).replace(/\bthis\s*:\s*EmbervaultEngine\s*,?/, '')).replace(/,$/, '');
  const afterParen = joined.slice(close + 1);
  const nl = afterParen.indexOf('\n');
  const firstRest = nl < 0 ? afterParen : afterParen.slice(0, nl);
  let body;
  if (/\{\s*$/.test(firstRest) && nl >= 0) {
    // `): ReturnType {` -> drop everything up to the final "{" of that line
    body = afterParen.slice(nl + 1);
  } else {
    // one-line body (or odd layout): compare literally minus a simple `: Type` annotation
    body = firstRest.replace(/^\s*:\s*[^{]*?(?=\{)/, '') + (nl < 0 ? '' : afterParen.slice(nl));
  }
  let bl = body.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  if (bl.length) bl[bl.length - 1] = bl[bl.length - 1].replace(/^\},$/, '}');
  return { info, norm: `${prefix}(${params}){\n${bl.join('\n')}` };
}

export function normalizeDecl(lines, item) {
  const raw = lines.slice(item.head, item.end + 1).map((l) => l.trim()).filter((l) => l !== '');
  raw[0] = raw[0].replace(/^export\s+/, '');
  return raw.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// File level extraction
// ---------------------------------------------------------------------------------------------------------------

function topLevel(lines) {
  const items = parseItems(lines, 0, lines.length, 0);
  const out = { members: [], decls: [], containers: [] };
  for (const it of items) {
    if (it.kind !== 'member') continue;
    const head = lines[it.head];
    if (/^import\b/.test(head) || /^export\s+(type\s+)?\{/.test(head)) continue; // plumbing
    if (/^Object\.assign\(/.test(head)) continue;
    // class / interface-merge / method object containers
    let m = /^export class (\w+)/.exec(head);
    if (m) { out.containers.push({ type: 'class', name: m[1], item: it }); continue; }
    m = /^export interface EmbervaultEngine\b/.exec(head);
    if (m) { out.containers.push({ type: 'merge', item: it }); continue; }
    m = /^export const (\w+Methods) = \{\s*$/.exec(head);
    if (m) { out.containers.push({ type: 'methods', name: m[1], item: it }); continue; }
    m = /^(?:export\s+)?type\s+\w+Methods\s*=\s*typeof\s+\w+Methods;?\s*$/.exec(head);
    if (m) { out.containers.push({ type: 'methodsType', item: it }); continue; }
    out.decls.push(it);
  }
  return out;
}

function collect(lines, label) {
  const tl = topLevel(lines);
  const members = []; // {key, norm, where}
  const decls = [];
  for (const c of tl.containers) {
    if (c.type !== 'class' && c.type !== 'methods') continue;
    const items = parseItems(lines, c.item.head + 1, c.item.end, 2);
    for (const it of items) {
      if (it.kind !== 'member') continue;
      const { info, norm } = normalizeMember(lines, it);
      members.push({ key: `${info.isStatic ? 'static ' : ''}${info.name}`, kind: info.kind, norm, where: `${label}:${it.head + 1}` });
    }
  }
  for (const d of tl.decls) {
    const info = describeHeadDecl(lines[d.head]);
    decls.push({ key: info, norm: normalizeDecl(lines, d), where: `${label}:${d.head + 1}` });
  }
  return { members, decls, tl };
}

function describeHeadDecl(line) {
  const t = line.trim().replace(/^export\s+/, '');
  const m = /^(?:declare\s+)?(const|let|var|function|interface|type|enum|class)\s+([A-Za-z_$][\w$]*)/.exec(t);
  return m ? `${m[1]} ${m[2]}` : `? ${t.slice(0, 30)}`;
}

function walk(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out.sort();
}

function main() {
  const args = process.argv.slice(2);
  const bi = args.indexOf('--base');
  const base = bi >= 0 ? args[bi + 1] : 'origin/main';
  const root = resolve(fileURLToPath(import.meta.url), '..', '..');
  const oldSrc = execFileSync('git', ['show', `${base}:src/game/engine.ts`], { cwd: root, maxBuffer: 1 << 28 }).toString('utf8');
  const oldLines = oldSrc.split(/\r?\n/);
  const files = [join(root, 'src/game/engine.ts')];
  const dir = join(root, 'src/game/engine');
  try { files.push(...walk(dir)); } catch { /* no engine/ dir yet */ }

  const oldC = collect(oldLines, `${base}`);
  const newMembers = [];
  const newDecls = [];
  const extras = [];
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split(/\r?\n/);
    const label = relative(root, f);
    const c = collect(lines, label);
    newMembers.push(...c.members);
    newDecls.push(...c.decls);
    for (const x of c.tl.containers) if (x.type === 'merge' || x.type === 'methodsType') extras.push(`${label}:${x.item.head + 1}`);
  }

  const problems = [];
  const groupBy = (arr) => {
    const m = new Map();
    for (const e of arr) { if (!m.has(e.key)) m.set(e.key, []); m.get(e.key).push(e); }
    return m;
  };

  function compare(kindLabel, oldArr, newArr) {
    const o = groupBy(oldArr);
    const n = groupBy(newArr);
    let same = 0;
    for (const [k, olist] of o) {
      const nlist = n.get(k);
      if (!nlist) { problems.push(`${kindLabel} MISSING: ${k}  (was ${olist[0].where})`); continue; }
      if (olist.length !== nlist.length) { problems.push(`${kindLabel} COUNT ${k}: old ${olist.length} new ${nlist.length} (${nlist.map((x) => x.where).join(', ')})`); continue; }
      for (let i = 0; i < olist.length; i++) {
        if (olist[i].norm === nlist[i].norm) same++;
        else {
          const a = olist[i].norm.split('\n');
          const b = nlist[i].norm.split('\n');
          let d = 0;
          while (d < a.length && d < b.length && a[d] === b[d]) d++;
          problems.push(`${kindLabel} DIFFERS: ${k}  (${olist[i].where} -> ${nlist[i].where}) first diff at normalized line ${d + 1}:\n      old: ${a[d] ?? '<end>'}\n      new: ${b[d] ?? '<end>'}`);
        }
      }
    }
    for (const [k, nlist] of n) if (!o.has(k)) problems.push(`${kindLabel} ADDED (not in baseline): ${k}  (${nlist[0].where})`);
    return { same, total: o.size };
  }

  const mres = compare('member', oldC.members, newMembers);
  const dres = compare('decl', oldC.decls, newDecls);

  // every method object must be mounted on the prototype
  const engineSrc = readFileSync(files[0], 'utf8');
  const objs = [];
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/^export const (\w+Methods) = \{/gm)) objs.push({ name: m[1], file: relative(root, f) });
  }
  const assigned = [...engineSrc.matchAll(/Object\.assign\(EmbervaultEngine\.prototype,([^)]*)\)/g)].flatMap((m) => m[1].split(',').map((x) => x.trim()).filter(Boolean));
  const merged = [...engineSrc.matchAll(/^export interface EmbervaultEngine extends ([^{]*)\{/gm)].flatMap((m) => m[1].split(',').map((x) => x.trim()).filter(Boolean));
  for (const o of objs) {
    const T = o.name.charAt(0).toUpperCase() + o.name.slice(1);
    if (!assigned.includes(o.name)) problems.push(`mount: ${o.name} (${o.file}) is not passed to Object.assign(EmbervaultEngine.prototype, ...)`);
    if (!merged.includes(T)) problems.push(`mount: ${T} (from ${o.name}) is not in "export interface EmbervaultEngine extends ..."`);
  }

  const methodsOld = oldC.members.filter((m) => m.kind === 'method').length;
  const methodsNewTotal = newMembers.filter((m) => m.kind === 'method').length;
  const inModules = newMembers.filter((m) => m.kind === 'method' && !m.where.endsWith('engine.ts') && !/engine\.ts:\d+$/.test(m.where)).length;
  console.log('=== engine split move-diff ===');
  console.log(`baseline: ${base}:src/game/engine.ts`);
  console.log(`files   : ${files.map((f) => relative(root, f)).join(', ')}`);
  console.log(`members : old ${oldC.members.length} (${methodsOld} methods) | new ${newMembers.length} (${methodsNewTotal} methods, ${inModules} living in engine/ modules)`);
  console.log(`members identical after normalization: ${mres.same}/${mres.total}`);
  console.log(`module-level decls identical: ${dres.same}/${dres.total} (old) | new files hold ${newDecls.length}`);
  console.log(`allowed additions seen (assembly): ${extras.length} merge/type lines, ${objs.length} method objects`);
  if (problems.length) {
    console.log(`\nFAIL: ${problems.length} problem(s)`);
    for (const p of problems) console.log(`  - ${p}`);
    process.exit(1);
  }
  console.log('\nPASS: same member set, every member and module-level declaration identical after normalization');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
