// 插件管理器（D1-D3）：谁装了、本体在哪、它自己的文件树、以及"它改了 dsh 的哪些文件"。
//
// 两条腿走路（见 08_插件管理器设计.md）：
//   ① 实扫：在磁盘上找 `*.dshpurge.bak` —— 这是 ground truth，谁改过就是谁留的标记
//   ② 自报：dsh-purge 自己的 core.patchTargets() —— "我打算改哪些"
//   两边一比就有差集：自报有实扫没有 = 那条补丁没打上；实扫有自报没有 = 有未声明的改动。
//
// 顺带白捡一个功能：`.dshpurge.bak` 就是改前的原件，所以"改前/改后"对比零成本。

import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import * as core from "./core.js";

/** 目录树里不往里走的目录（node_modules 例外说明见 pluginTree）。 */
const TREE_SKIP = new Set([".git", ".DS_Store", ".cache"]);
const SCAN_SKIP = new Set([".git"]);

const PROFILE_CACHE = { at: 0, value: null };
const SCAN_CACHE = { at: 0, value: null, roots: "" };
/** 扫描有点贵（官方树 240 个包），缓存 20 秒；界面连点几下不会反复全扫。 */
const SCAN_TTL_MS = 20 * 1000;

// ── 小工具 ────────────────────────────────────────────────────────

function readJson(fp) {
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

function statSafe(fp) {
  try {
    return fs.statSync(fp);
  } catch {
    return null;
  }
}

function lstatSafe(fp) {
  try {
    return fs.lstatSync(fp);
  } catch {
    return null;
  }
}

function relOf(base, fp) {
  try {
    return path.relative(base, fp).split(path.sep).join("/");
  } catch {
    return fp;
  }
}

/** 往上找最近的 package.json，拿包名/版本（探路脚本里验证过的写法，上限 12 层）。 */
export function owningPackage(file) {
  let dir = path.dirname(file);
  for (let i = 0; i < 12; i += 1) {
    const pkg = readJson(path.join(dir, "package.json"));
    if (pkg && (pkg.name || pkg.version)) {
      return { name: pkg.name || path.basename(dir), version: pkg.version || "", dir };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { name: "(未知包)", version: "", dir: path.dirname(file) };
}

// ── profile 与插件清单 ────────────────────────────────────────────

/** 当前跑的是哪个 profile：环境变量 → 命令行位置参数 → web → profiles 里的第一个。 */
export function resolveProfile(dshHome = core.findDshHome(), force = false) {
  if (!force && PROFILE_CACHE.value && Date.now() - PROFILE_CACHE.at < SCAN_TTL_MS) return PROFILE_CACHE.value;
  const profilesDir = path.join(dshHome, "profiles");
  const names = [];
  try {
    for (const e of fs.readdirSync(profilesDir, { withFileTypes: true })) {
      if (e.isDirectory() && fs.existsSync(path.join(profilesDir, e.name, "package.json"))) names.push(e.name);
    }
  } catch {
    /* 没有 profiles 目录 */
  }
  const fromArgv = process.argv.slice(1).find((a) => !a.startsWith("-") && names.includes(a));
  const name = [process.env.DSH_PROFILE, fromArgv, "web", names[0]].find((n) => n && names.includes(n)) || null;
  const value = { name, dir: name ? path.join(profilesDir, name) : null, profiles: names, dsh_home: dshHome };
  PROFILE_CACHE.at = Date.now();
  PROFILE_CACHE.value = value;
  return value;
}

/** 官方包的两处落点：程序根 / 或嵌在 @deepseek-ai/dsh 自己的 node_modules 里。 */
function officialCandidates(name) {
  const root = core.findDshBinRoot?.();
  const out = [];
  if (root) {
    out.push(path.join(root, "node_modules", name));
    out.push(path.join(root, "node_modules", "@deepseek-ai", "dsh", "node_modules", name));
  }
  return out;
}

function describePackage(name, dir, kind) {
  const pkg = readJson(path.join(dir, "package.json")) || {};
  return {
    name,
    kind, // junction | npm | official | missing
    path: dir,
    real_path: (() => {
      try {
        return fs.realpathSync(dir);
      } catch {
        return dir;
      }
    })(),
    version: pkg.version || "",
    description: typeof pkg.description === "string" ? pkg.description.slice(0, 200) : "",
    dsh_target: pkg.dshTarget || "",
    bundle_patch: pkg.dsh?.bundle?.patch || "",
    has_client: Boolean(pkg.dsh?.client),
    main: pkg.main || "",
  };
}

/** 装了哪些插件：读 profile 名单（bundles + dependencies），再解析每个人在哪儿。 */
export function listPlugins(profile = resolveProfile()) {
  if (!profile.name || !profile.dir) return { profile, plugins: [] };
  const manifest = readJson(path.join(profile.dir, "package.json")) || {};
  const bundles = Array.isArray(manifest.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : [];
  const deps = Object.keys(manifest.dependencies || {});
  const names = [...new Set([...bundles, ...deps])];
  const plugins = names.map((name) => {
    const local = path.join(profile.dir, "node_modules", name);
    const st = lstatSafe(local);
    if (st && st.isSymbolicLink()) return describePackage(name, local, "junction");
    if (st && st.isDirectory()) return describePackage(name, local, "npm");
    for (const cand of officialCandidates(name)) {
      if (fs.existsSync(path.join(cand, "package.json"))) return describePackage(name, cand, "official");
    }
    return { name, kind: "missing", path: "", real_path: "", in_bundles: bundles.includes(name) };
  }).map((p) => ({ ...p, in_bundles: bundles.includes(p.name) }));
  return { profile, plugins };
}

// ── 文件树 ────────────────────────────────────────────────────────

/**
 * 列目录树。**不展开 node_modules**（有的插件几百 MB），不跟进 junction（防环）。
 * 返回嵌套结构，客户端/CLI 自己画。
 */
export function pluginTree(root, { depth = 3, maxEntries = 400 } = {}) {
  const counter = { n: 0, cut: false };
  const walk = (dir, level) => {
    if (level > depth || counter.n >= maxEntries) {
      if (counter.n >= maxEntries) counter.cut = true;
      return [];
    }
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const nodes = [];
    for (const e of entries) {
      if (counter.n >= maxEntries) { counter.cut = true; break; }
      if (TREE_SKIP.has(e.name)) continue;
      const fp = path.join(dir, e.name);
      const lst = lstatSafe(fp);
      if (!lst) continue;
      if (lst.isSymbolicLink()) {
        counter.n += 1;
        nodes.push({ name: e.name, type: "link", size: 0, rel: relOf(root, fp) });
        continue;
      }
      if (lst.isDirectory()) {
        if (e.name === "node_modules") {
          // 只报个数，不展开
          let count = 0;
          try { count = fs.readdirSync(fp).length; } catch { /* ignore */ }
          counter.n += 1;
          nodes.push({ name: e.name, type: "dir", size: 0, rel: relOf(root, fp), collapsed: true, children_count: count, children: [] });
          continue;
        }
        counter.n += 1;
        nodes.push({ name: e.name, type: "dir", size: 0, rel: relOf(root, fp), children: walk(fp, level + 1) });
        continue;
      }
      counter.n += 1;
      nodes.push({ name: e.name, type: "file", size: lst.size, rel: relOf(root, fp) });
    }
    return nodes.sort((a, b) => {
      const rank = (t) => (t === "dir" ? 0 : t === "link" ? 1 : 2);
      return rank(a.type) - rank(b.type) || a.name.localeCompare(b.name);
    });
  };
  const nodes = walk(root, 1);
  return { root, depth, nodes, truncated: counter.cut, entries: counter.n };
}

// ── 实扫：谁改了哪些文件 ──────────────────────────────────────────

/** 标记文件名 → 归属插件。`cordis.patch.yml.dshpurge.bak` → `dshpurge`（只取最后一个扩展段）。 */
export function ownerOfMarker(fileName) {
  const m = /([^./\\]+)\.bak$/i.exec(String(fileName));
  return m ? m[1] : null;
}

/** 名字归一化后比较：`dsh-purge` / `dshpurge` / `@scope/dsh-purge` 都算同一个。 */
function ownerSlug(name) {
  return String(name || "").replace(/^@[^/]+\//, "").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

function scanRoots(profile = resolveProfile()) {
  const roots = [];
  const dshRoot = core.findDshBinRoot?.();
  if (dshRoot) roots.push(path.join(dshRoot, "node_modules"));
  if (profile.dir) roots.push(profile.dir);
  return roots;
}

/**
 * 走一遍目录找 `*.dshpurge.bak`。
 * 防环靠 realpath 去重（node_modules 里大量 junction），深度上限 9，
 * 跳过 .git，超大目录只报计数。结果缓存 20 秒。
 */
export function scanChanges({ profile = resolveProfile(), force = false } = {}) {
  const roots = scanRoots(profile);
  const key = roots.join("|");
  if (!force && SCAN_CACHE.value && SCAN_CACHE.roots === key && Date.now() - SCAN_CACHE.at < SCAN_TTL_MS) {
    return SCAN_CACHE.value;
  }
  const seen = new Set();
  const items = [];
  const visited = { dirs: 0, truncated: false };

  const walk = (dir, depth) => {
    if (depth > 9 || visited.truncated) return;
    let real = dir;
    try { real = fs.realpathSync(dir); } catch { return; }
    if (seen.has(real)) return; // 环 / 重复
    seen.add(real);
    visited.dirs += 1;
    if (visited.dirs > 40000) { visited.truncated = true; return; }
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SCAN_SKIP.has(e.name)) continue;
      const fp = path.join(dir, e.name);
      const lst = lstatSafe(fp);
      if (!lst) continue;
      if (lst.isFile()) {
        const owner = ownerOfMarker(e.name);
        if (!owner) continue;
        const target = fp.slice(0, -(owner.length + 5)); // 去掉 ".owner.bak"
        const tst = statSafe(target);
        items.push({
          owner,
          marker: fp,
          target,
          target_exists: Boolean(tst),
          marker_bytes: lst.size,
          target_bytes: tst ? tst.size : 0,
          identical: null, // 需要时再比，别在扫描里读大文件
        });
        continue;
      }
      if (lst.isDirectory()) walk(fp, depth + 1);
    }
  };

  for (const root of roots) walk(root, 0);
  // 归属包（往上找 package.json），顺带按包分组
  for (const it of items) {
    it.pkg = owningPackage(it.target_exists ? it.target : it.marker);
    it.rel = relOf(it.pkg.dir, it.target);
  }
  items.sort((a, b) => a.target.localeCompare(b.target));
  const value = { items, roots, visited, at: Date.now() };
  SCAN_CACHE.at = Date.now();
  SCAN_CACHE.roots = key;
  SCAN_CACHE.value = value;
  return value;
}

/** 按包分组（给界面画树用）。 */
export function groupByPackage(items = scanChanges().items) {
  const map = new Map();
  for (const it of items) {
    const key = it.pkg.dir;
    if (!map.has(key)) map.set(key, { name: it.pkg.name, version: it.pkg.version, dir: it.pkg.dir, files: [] });
    map.get(key).files.push({ owner: it.owner, path: it.target, rel: it.rel, exists: it.target_exists, marker: it.marker, bytes: it.target_bytes, marker_bytes: it.marker_bytes });
  }
  const out = [...map.values()];
  for (const g of out) g.files.sort((a, b) => a.rel.localeCompare(b.rel));
  out.sort((a, b) => (b.files.length - a.files.length) || a.name.localeCompare(b.name));
  return out;
}

/** 某个插件改了什么。只认它自己的标记；没留标记的插件就是"无改动记录"（正确答案，不是错误）。 */
export function changesForPlugin(name, { items = scanChanges().items } = {}) {
  const slug = ownerSlug(name);
  const mine = items.filter((it) => ownerSlug(it.owner) === slug);
  return { plugin: name, count: mine.length, packages: groupByPackage(mine), files: mine };
}

// ── 自报 vs 实扫 ──────────────────────────────────────────────────

export function selfCheck({ aiBase = null, items = scanChanges().items } = {}) {
  let reported = [];
  let error = "";
  if (!aiBase) {
    error = "没定位到官方插件根（DSH_BASE）—— 自报口径不可用，只有实扫结果";
  } else {
    try {
      reported = core.patchTargets(aiBase);
    } catch (e) {
      error = String(e.message || e);
    }
  }
  const reportedPaths = new Set();
  for (const p of reported) for (const fp of p.paths) reportedPaths.add(path.resolve(fp));
  const scannedPaths = new Set(items.filter((it) => ownerSlug(it.owner) === ownerSlug("dsh-purge")).map((it) => path.resolve(it.target)));
  const onlyReported = [...reportedPaths].filter((fp) => !scannedPaths.has(fp));
  const onlyScanned = [...scannedPaths].filter((fp) => !reportedPaths.has(fp));
  return {
    ai_base: aiBase,
    error,
    patch_count: reported.length,
    reported_files: reportedPaths.size,
    scanned_files: scannedPaths.size,
    only_reported: onlyReported,
    only_scanned: onlyScanned,
    patches: reported.map((p) => ({
      id: p.id,
      name: p.name,
      layer: p.layer,
      files: p.paths.map((fp) => path.resolve(fp)),
      marked: p.paths.some((fp) => scannedPaths.has(path.resolve(fp))),
    })),
  };
}

// ── 改前 / 改后 ───────────────────────────────────────────────────

function splitLines(text) {
  return String(text).split(/\r?\n/);
}

/** 简单行级 diff：先砍掉公共前后缀，中间做 LCS（太大就整段呈现，不装样子）。 */
export function lineDiff(beforeText, afterText, { maxCells = 2_000_000, context = 3 } = {}) {
  const A = splitLines(beforeText);
  const B = splitLines(afterText);
  let head = 0;
  while (head < A.length && head < B.length && A[head] === B[head]) head += 1;
  let tail = 0;
  while (tail < A.length - head && tail < B.length - head && A[A.length - 1 - tail] === B[B.length - 1 - tail]) tail += 1;
  const midA = A.slice(head, A.length - tail);
  const midB = B.slice(head, B.length - tail);

  const ops = [];
  if (midA.length * midB.length > maxCells) {
    ops.push({ type: "del", lines: midA });
    ops.push({ type: "add", lines: midB });
  } else {
    const n = midA.length;
    const m = midB.length;
    const width = m + 1;
    const dp = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        dp[i * width + j] = midA[i] === midB[j]
          ? dp[(i + 1) * width + j + 1] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        ops.push({ type: "same", lines: [midA[i]] });
        i += 1;
        j += 1;
      } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
        ops.push({ type: "del", lines: [midA[i]] });
        i += 1;
      } else {
        ops.push({ type: "add", lines: [midB[j]] });
        j += 1;
      }
    }
    while (i < n) { ops.push({ type: "del", lines: [midA[i]] }); i += 1; }
    while (j < m) { ops.push({ type: "add", lines: [midB[j]] }); j += 1; }
  }

  // 合并成 hunk：只留改动行 + 前后各 context 行
  const rows = [];
  let oldLine = 1;
  let newLine = 1;
  for (const op of ops) {
    for (const text of op.lines) {
      rows.push({ type: op.type, old: op.type === "add" ? null : oldLine, new: op.type === "del" ? null : newLine, text });
      if (op.type !== "add") oldLine += 1;
      if (op.type !== "del") newLine += 1;
    }
  }
  const changedIdx = [];
  for (let i = 0; i < rows.length; i += 1) if (rows[i].type !== "same") changedIdx.push(i);
  const ranges = [];
  for (const idx of changedIdx) {
    const last = ranges[ranges.length - 1];
    if (last && idx - last.end <= context * 2 + 1) last.end = idx;
    else ranges.push({ start: idx, end: idx });
  }
  const hunks = ranges.map((r) => {
    const from = Math.max(0, r.start - context);
    const to = Math.min(rows.length - 1, r.end + context);
    const slice = rows.slice(from, to + 1);
    const firstOld = slice.find((x) => x.old !== null);
    const firstNew = slice.find((x) => x.new !== null);
    return {
      old_start: firstOld ? firstOld.old : 1,
      new_start: firstNew ? firstNew.new : 1,
      rows: slice,
    };
  });

  const added = ops.reduce((n2, o) => n2 + (o.type === "add" ? o.lines.length : 0), 0);
  const removed = ops.reduce((n2, o) => n2 + (o.type === "del" ? o.lines.length : 0), 0);
  return { added, removed, total_lines: A.length, after_lines: B.length, hunks };
}

export async function diffFile(file) {
  const target = path.resolve(file);
  if (!fs.existsSync(target)) throw new Error("文件不存在: " + target);
  const marker = target + ".dshpurge.bak";
  if (!fs.existsSync(marker)) throw new Error("这个文件没有 .dshpurge.bak（不是被补丁改过的文件，或者备份已被清掉）");
  const before = await fsp.readFile(marker, "utf8");
  let after = "";
  try {
    after = await fsp.readFile(target, "utf8");
  } catch {
    after = "";
  }
  const diff = lineDiff(before, after);
  return {
    path: target,
    marker,
    identical: before === after,
    before_bytes: Buffer.byteLength(before, "utf8"),
    after_bytes: Buffer.byteLength(after, "utf8"),
    pkg: owningPackage(target),
    ...diff,
  };
}

// ── 给界面/CLI 的总入口 ──────────────────────────────────────────

export function overview({ aiBase = null, force = false } = {}) {
  const profile = resolveProfile(undefined, force);
  const { plugins } = listPlugins(profile);
  const scan = scanChanges({ profile, force });
  const groups = groupByPackage(scan.items);
  const self = selfCheck({ aiBase, items: scan.items });
  const byOwner = {};
  for (const it of scan.items) byOwner[it.owner] = (byOwner[it.owner] || 0) + 1;  return {
    profile: { name: profile.name, dir: profile.dir, profiles: profile.profiles },
    plugins: plugins.map((p) => {
      // changed_by_it = 这个插件自己改出去的文件（它留的标记）
      // changed_in_it = 这个包目录里被别人改过的文件（官方包才会 >0）
      const mine = changesForPlugin(p.name, { items: scan.items }).count;
      const inside = p.real_path
        ? scan.items.filter((it) => {
          const t = path.resolve(it.target).toLowerCase();
          const base = path.resolve(p.real_path).toLowerCase();
          return t.startsWith(base + path.sep);
        }).length
        : 0;
      return { ...p, changed_by_it: mine, changed_in_it: inside };
    }),
    changed: {
      total: scan.items.length,
      by_owner: byOwner,
      packages: groups.map((g) => ({ name: g.name, version: g.version, dir: g.dir, files: g.files.length, paths: g.files.map((f) => f.path) })),
    },
    self_report: self,
    scan_roots: scan.roots,
    scanned_dirs: scan.visited.dirs,
    truncated: scan.visited.truncated,
    cached_at: scan.at,
  };
}
