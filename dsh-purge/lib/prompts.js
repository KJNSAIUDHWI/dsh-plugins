// 多套破甲提示词
//
// 存储：$DSH_HOME/purge-prompts/<id>.md   每套的正文
//       $DSH_HOME/purge-prompts/state.json  { "active": "<id>" }
//
// 设计上刻意"笨"：切换 = 把选中的那套写进 $DSH_HOME/prompt-inject.md。
// 这样提示词注入逻辑一行都不用改（它照旧读 prompt-inject.md），
// 而且你随时打开那个文件看到的就是当前生效的那一套。

import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { findDshHome, findOverrideFile } from "./core.js";

const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const MAX_BYTES = 512 * 1024;

export { findDshHome };

export function promptsDir(dshHome) {
  return path.join(dshHome, "purge-prompts");
}
export function stateFilePath(dshHome) {
  return path.join(promptsDir(dshHome), "state.json");
}
export function promptPath(dshHome, id) {
  return path.join(promptsDir(dshHome), id + ".md");
}
export function validPromptId(id) {
  return typeof id === "string" && ID_RE.test(id);
}

/**
 * token 估算。刻意用一条粗公式而不是分词器：设置页要的是"这个套大概多贵"，
 * 不是精确值。中日韩字符按 0.6 tok/字、其余按 3.6 字符/tok —— 出厂那份
 * 40,001 字符的英文提示词算出来 ≈11.1k，和实测的 11,393 对得上。
 * （客户端 client.js 里有一份同样的实现，改这里记得改那边。）
 */
export function estimateTokens(text) {
  const s = String(text ?? "");
  let cjk = 0;
  let other = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (
      (cp >= 0x3000 && cp <= 0x303f) ||
      (cp >= 0x3040 && cp <= 0x30ff) ||
      (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      cp >= 0x20000
    ) {
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return Math.round(cjk * 0.6 + other / 3.6);
}

/** 一套提示词的体检数据：大小 / 字符 / 行数 / token / 首行预览。 */
export function promptStats(content, { previewChars = 120 } = {}) {
  const s = String(content ?? "");
  let preview = "";
  for (const raw of s.split(/\r?\n/)) {
    const line = raw.trim();
    if (line) {
      preview = line.length > previewChars ? `${line.slice(0, previewChars)}…` : line;
      break;
    }
  }
  return {
    bytes: Buffer.byteLength(s, "utf8"),
    chars: [...s].length,
    lines: s.length === 0 ? 0 : s.split(/\r?\n/).length,
    tokens: estimateTokens(s),
    preview,
  };
}

export async function promptExists(dshHome, id) {
  if (!validPromptId(id)) return false;
  try {
    await fsp.access(promptPath(dshHome, id));
    return true;
  } catch {
    return false;
  }
}

export async function listPrompts(dshHome) {
  const dir = promptsDir(dshHome);
  const out = [];
  try {
    for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
      if (!e.isFile() || !e.name.endsWith(".md")) continue;
      const id = e.name.slice(0, -3);
      if (!validPromptId(id)) continue;
      let size = 0;
      let stats = null;
      try {
        const fp = path.join(dir, e.name);
        size = (await fsp.stat(fp)).size;
        stats = promptStats(await fsp.readFile(fp, "utf8"));
      } catch {}
      out.push(stats ? { id, size, ...stats } : { id, size });
    }
  } catch {
    /* 目录不存在 → 空 */
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

export async function readPrompt(dshHome, id) {
  if (!validPromptId(id)) throw new Error(`invalid id: ${id}`);
  try {
    return await fsp.readFile(promptPath(dshHome, id), "utf8");
  } catch {
    return null;
  }
}

export async function savePrompt(dshHome, id, content) {
  if (!validPromptId(id)) throw new Error(`invalid id: ${id}`);
  if (Buffer.byteLength(content, "utf8") > MAX_BYTES) throw new Error("提示词太大（上限 512KB）");
  await fsp.mkdir(promptsDir(dshHome), { recursive: true });
  await fsp.writeFile(promptPath(dshHome, id), content, "utf8");
  // 如果改的正好是当前激活那套，顺手同步到 prompt-inject.md
  if ((await readActive(dshHome)) === id) {
    await fsp.writeFile(findOverrideFile(dshHome), content, "utf8");
  }
  return { id };
}

/** 新建一套（已存在就报错，避免手滑覆盖）。 */
export async function createPrompt(dshHome, id, content = "") {
  if (!validPromptId(id)) throw new Error(`id 不合法: ${id}（字母数字开头，可含 . _ -，最长 64）`);
  if (await promptExists(dshHome, id)) throw new Error(`已经有一套叫 ${id} 了`);
  await savePrompt(dshHome, id, content);
  return { id, ...promptStats(content) };
}

/** 复制一套。目标已存在就报错（想覆盖请先删）。 */
export async function copyPrompt(dshHome, fromId, toId) {
  if (!validPromptId(fromId)) throw new Error(`invalid id: ${fromId}`);
  if (!validPromptId(toId)) throw new Error(`id 不合法: ${toId}`);
  const content = await readPrompt(dshHome, fromId);
  if (content === null) throw new Error(`没有这一套: ${fromId}`);
  if (await promptExists(dshHome, toId)) throw new Error(`已经有一套叫 ${toId} 了`);
  await savePrompt(dshHome, toId, content);
  return { id: toId, from: fromId, ...promptStats(content) };
}

/**
 * 改名 = 内容搬到新 id、删掉旧 id。激活的是它的话，就把 state.json 指过去
 * （prompt-inject.md 内容本来就和它一致，一个字都不用动）。
 */
export async function renamePrompt(dshHome, id, newId) {
  if (!validPromptId(id)) throw new Error(`invalid id: ${id}`);
  if (!validPromptId(newId)) throw new Error(`id 不合法: ${newId}（字母数字开头，可含 . _ -，最长 64）`);
  if (id === newId) return { id, renamed: false };
  const stored = await readPrompt(dshHome, id);
  if (stored === null) throw new Error(`没有这一套: ${id}`);
  if (await promptExists(dshHome, newId)) throw new Error(`已经有一套叫 ${newId} 了`);
  const wasActive = (await readActive(dshHome)) === id;
  // 激活那套以 prompt-inject.md 为准：里面可能有手改还没存回去的内容，改名不该吃掉它。
  const content = wasActive ? readInject(dshHome) || stored : stored;
  await savePrompt(dshHome, newId, content);
  await fsp.unlink(promptPath(dshHome, id));
  if (wasActive) {
    await writeActive(dshHome, newId);
    await fsp.writeFile(findOverrideFile(dshHome), content, "utf8");
  }
  return { id: newId, from: id, renamed: true, was_active: wasActive };
}

export async function deletePrompt(dshHome, id) {
  if (!validPromptId(id)) throw new Error(`invalid id: ${id}`);
  try {
    await fsp.unlink(promptPath(dshHome, id));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if ((await readActive(dshHome)) === id) {
    // 删掉的就是正在生效那套：状态清空的同时把 prompt-inject.md 也清掉。
    // 不然界面显示「没激活任何一套」，而模型还在吃那段正文 —— 状态对不上。
    await writeActive(dshHome, null);
    await fsp.mkdir(dshHome, { recursive: true });
    await fsp.writeFile(findOverrideFile(dshHome), "", "utf8");
    return { deleted: id, detached: true };
  }
  return { deleted: id, detached: false };
}

export async function readActive(dshHome) {
  try {
    const parsed = JSON.parse(await fsp.readFile(stateFilePath(dshHome), "utf8"));
    return typeof parsed?.active === "string" && validPromptId(parsed.active) ? parsed.active : null;
  } catch {
    return null;
  }
}

export async function writeActive(dshHome, id) {
  await fsp.mkdir(promptsDir(dshHome), { recursive: true });
  await fsp.writeFile(stateFilePath(dshHome), JSON.stringify({ active: id }, null, 2) + "\n", "utf8");
}

function readInject(dshHome) {
  try {
    return fs.readFileSync(findOverrideFile(dshHome), "utf8");
  } catch {
    return "";
  }
}

/**
 * 切换前把 prompt-inject.md 的当前内容存回它原来所属的那一套，
 * 免掉"我改了却忘了保存，一切换就没了"。
 */
async function flushCurrent(dshHome) {
  const active = await readActive(dshHome);
  if (!active) return false;
  const current = readInject(dshHome);
  const saved = await readPrompt(dshHome, active);
  if (saved === null || saved === current) return false;
  await fsp.writeFile(promptPath(dshHome, active), current, "utf8");
  return true;
}

/** 切到某一套：把它的内容写进 prompt-inject.md。 */
export async function usePrompt(dshHome, id) {
  const content = await readPrompt(dshHome, id);
  if (content === null) throw new Error(`没有这一套: ${id}`);
  const flushed = await flushCurrent(dshHome);
  await fsp.mkdir(dshHome, { recursive: true });
  await fsp.writeFile(findOverrideFile(dshHome), content, "utf8");
  await writeActive(dshHome, id);
  return { id, flushed };
}

/** 关掉破甲提示词：把当前内容存回原套，然后清空 prompt-inject.md。 */
export async function detachPrompt(dshHome) {
  const flushed = await flushCurrent(dshHome);
  await fsp.mkdir(dshHome, { recursive: true });
  await fsp.writeFile(findOverrideFile(dshHome), "", "utf8");
  await writeActive(dshHome, null);
  return { flushed };
}

/** 把当前 prompt-inject.md 的内容另存为一套（不切换）。 */
export async function captureCurrent(dshHome, id) {
  const content = readInject(dshHome);
  await savePrompt(dshHome, id, content);
  return { id, size: Buffer.byteLength(content, "utf8") };
}

/** 首次使用：把已有的 prompt-inject.md 收成一套叫 default 的，并设为激活。 */
export async function ensureInitialState(dshHome) {
  const listed = await listPrompts(dshHome);
  if (listed.length > 0) return { prompts: listed.length, seeded: false };
  const content = readInject(dshHome);
  if (content.trim().length === 0) return { prompts: 0, seeded: false };
  await savePrompt(dshHome, "default", content);
  await writeActive(dshHome, "default");
  return { prompts: 1, seeded: true, id: "default" };
}

export async function promptsStatus(dshHome) {
  const prompts = await listPrompts(dshHome);
  const active = await readActive(dshHome);
  const inject = readInject(dshHome);
  const activeContent = active ? await readPrompt(dshHome, active) : null;
  return {
    prompts,
    active,
    dir: promptsDir(dshHome),
    inject_path: findOverrideFile(dshHome),
    inject_bytes: Buffer.byteLength(inject, "utf8"),
    inject_stats: promptStats(inject),
    // 当前 prompt-inject.md 和激活的那套是否一致（不一致 = 有未保存的改动）
    synced: activeContent !== null && activeContent === inject,
    attached: inject.trim().length > 0,
  };
}

export function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return `${kb >= 100 ? Math.round(kb) : kb.toFixed(1)} KB`;
}
