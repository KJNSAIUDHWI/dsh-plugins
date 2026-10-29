#!/usr/bin/env node
// dsh-purge CLI（小杨）— 移植自 dsh_purge.py 的静默模式，功能一个不差
// 用法:
//   dsh-purge              # 默认只显示状态（同 --status）
//   dsh-purge --status     # 显示状态
//   dsh-purge --apply      # 应用全部清洗
//   dsh-purge --revert     # 回滚还原
//   dsh-purge --sync       # 还原后按当前开关重打一遍
//   dsh-purge --groups     # 看分组开关
//   dsh-purge --group <名字> on|off   # 切换某个组（自动 sync）
//   dsh-purge --edit       # 编辑 prompt-inject.md
//   dsh-purge --help       # 帮助

import fs from "node:fs";
import * as core from "../lib/core.js";
import * as prompts from "../lib/prompts.js";
import * as plugman from "../lib/plugman.js";

const args = process.argv.slice(2);
const wantsJson = args.includes("--json");

/** --json 模式：机器可读（给 AI 用）；否则给人看。 */
function emit(humanText, payload) {
  if (wantsJson) console.log(JSON.stringify(payload, null, 2));
  else console.log(humanText);
}

function fmtSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return `${kb >= 100 ? Math.round(kb) : kb.toFixed(1)} KB`;
}

function drawTree(nodes, pad = "") {
  const out = [];
  for (const n of nodes) {
    const mark = n.type === "dir" ? "[目录]" : n.type === "link" ? "[链接]" : "      ";
    const extra = n.type === "file"
      ? `  ${fmtSize(n.size)}`
      : n.collapsed
        ? `  (node_modules: ${n.children_count} 项，不展开)`
        : "";
    out.push(`  ${pad}${mark} ${n.name}${extra}`);
    if (n.children && n.children.length) out.push(...drawTree(n.children, `${pad}  `));
  }
  return out;
}

function renderChanges(scan, self) {
  const groups = plugman.groupByPackage(scan.items);
  const out = [];
  out.push("dsh-purge 改动总览 / Changes");
  out.push(`  扫描根 ${scan.roots.join("  |  ")}`);
  out.push(`  实扫到 ${scan.items.length} 个带标记的文件，分布在 ${groups.length} 个包：`);
  out.push("");
  for (const g of groups) {
    out.push(`  ${String(g.files.length).padStart(2)} 个  ${g.name}${g.version ? "@" + g.version : ""}`);
    for (const f of g.files) out.push(`        ${f.rel}${f.exists ? "" : "   (目标文件不见了)"}`);
  }
  if (self) {
    out.push("");
    out.push("自报 vs 实扫（差集）");
    out.push(`  自报 ${self.patch_count} 条补丁 → ${self.reported_files} 个目标文件（存在的）`);
    out.push(`  实扫 ${self.scanned_files} 个标记文件`);
    out.push(`  自报有实扫没有（${self.only_reported.length}）${self.only_reported.length ? "" : "：无"}`);
    for (const fp of self.only_reported) out.push(`    - ${fp}`);
    out.push(`  实扫有自报没有（${self.only_scanned.length}）${self.only_scanned.length ? "：这些是补丁表里没声明的改动" : "：无"}`);
    for (const fp of self.only_scanned) out.push(`    - ${fp}`);
    if (self.error) out.push(`  注: ${self.error}`);
  }
  return out.join("\n");
}

function renderPlugins(ov) {
  const out = [];
  out.push(`dsh-purge 插件 / Plugins （profile: ${ov.profile.name || "?"}）`);
  out.push(`  profile 目录 ${ov.profile.dir || "?"}`);
  out.push("");
  for (const p of ov.plugins) {
    const kind = { junction: "junction", npm: "npm", official: "官方", missing: "缺失" }[p.kind] || p.kind;
    const changed = p.changed_by_it ? `它改了 ${p.changed_by_it} 个文件` : p.changed_in_it ? `内含 ${p.changed_in_it} 个被改文件` : "无改动记录";
    out.push(`  ${kind.padEnd(9)} ${p.name.padEnd(30)} ${String(p.version).padEnd(10)} ${changed}`);
    out.push(`            ${p.real_path || p.path || "(没找到本体)"}`);
  }
  out.push("");
  out.push(`  合计：实扫 ${ov.changed.total} 个被改文件，${ov.changed.packages.length} 个包（${JSON.stringify(ov.changed.by_owner)}）`);
  if (ov.truncated) out.push("  注意：扫描被截断了（目录太多），结果可能不全");
  return out.join("\n");
}

function renderPluginDetail(name, ov, tree) {
  const p = ov.plugins.find((x) => x.name === name) || null;
  const out = [];
  out.push(`dsh-purge 插件详情 / ${name}`);
  if (!p) {
    out.push(`  没有这个插件（名单里只有：${ov.plugins.map((x) => x.name).join(", ")}）`);
    return out.join("\n");
  }
  out.push(`  安装方式   ${{ junction: "junction（指向本地源码）", npm: "npm 安装", official: "dsh 官方包", missing: "缺失" }[p.kind] || p.kind}`);
  out.push(`  本体位置   ${p.path}`);
  out.push(`  真实路径   ${p.real_path}`);
  out.push(`  版本       ${p.version || "(无)"}   dshTarget: ${p.dsh_target || "(无)"}   带前端: ${p.has_client ? "是" : "否"}`);
  if (p.bundle_patch) out.push(`  bundle 补丁 ${p.bundle_patch}`);
  if (p.description) out.push(`  说明       ${p.description}`);
  const mine = plugman.changesForPlugin(p.name);
  out.push("");
  if (mine.count) {
    out.push(`  它改了 ${mine.count} 个文件（按包分组）：`);
    for (const g of mine.packages) {
      out.push(`    ${g.name}${g.version ? "@" + g.version : ""}`);
      for (const f of g.files) out.push(`      ${f.rel}`);
    }
  } else {
    out.push("  无改动记录（这个插件没有在 dsh 代码树里留过改动标记）");
  }
  if (tree && tree.nodes) {
    out.push("");
    out.push(`  它自己的文件树（${tree.root}，深度 ${tree.depth}${tree.truncated ? "，已截断" : ""}）：`);
    out.push(...drawTree(tree.nodes));
  }
  return out.join("\n");
}

function renderDiff(d) {
  const out = [];
  out.push(`dsh-purge 改前/改后 / ${d.path}`);
  out.push(`  备份 ${d.marker}`);
  out.push(`  包   ${d.pkg.name}${d.pkg.version ? "@" + d.pkg.version : ""}`);
  if (d.identical) {
    out.push("  内容一致（改动已被还原，或者补丁没生效）");
    return out.join("\n");
  }
  out.push(`  ${fmtSize(d.before_bytes)} → ${fmtSize(d.after_bytes)}    +${d.added} / -${d.removed} 行，${d.hunks.length} 个 hunk`);
  out.push("");
  for (const h of d.hunks) {
    out.push(`  @@ -${h.old_start} +${h.new_start} @@`);
    for (const r of h.rows) {
      const mark = r.type === "add" ? "+" : r.type === "del" ? "-" : " ";
      out.push(`  ${mark} ${String(r.old ?? "").padStart(5)} ${String(r.new ?? "").padStart(5)} | ${r.text}`);
    }
  }
  return out.join("\n");
}

/** D3：插件管理器命令（人类可读 + --json 给 AI）。 */
async function handlePluginsCli() {
  const state = await core.gatherState(core.readDisabledGroups(core.findDshHome()));
  const ov = plugman.overview({ aiBase: state.ai_base });

  if (args.includes("--changes")) {
    const self = ov.self_report;
    emit(renderChanges({ items: scanItemsFor(ov), roots: ov.scan_roots, visited: { dirs: ov.scanned_dirs } }, self), {
      roots: ov.scan_roots,
      total: ov.changed.total,
      by_owner: ov.changed.by_owner,
      packages: ov.changed.packages,
      self_report: self,
    });
    return;
  }

  if (args.includes("--diff")) {
    const i = args.indexOf("--diff");
    const file = args[i + 1];
    if (!file) throw new Error("用法: dsh-purge --diff <文件路径>");
    const d = await plugman.diffFile(file);
    emit(renderDiff(d), d);
    return;
  }

  if (args.includes("--tree")) {
    const i = args.indexOf("--tree");
    const target = args[i + 1];
    const di = args.indexOf("--depth");
    const depth = di >= 0 ? Number(args[di + 1]) || 3 : 3;
    if (!target) throw new Error("用法: dsh-purge --tree <插件名|目录路径> [--depth N]");
    const p = ov.plugins.find((x) => x.name === target);
    const root = p ? p.real_path : target;
    if (!fs.existsSync(root)) throw new Error(`目录不存在: ${root}`);
    const tree = plugman.pluginTree(root, { depth });
    emit([`dsh-purge 文件树 / ${root}（深度 ${depth}）`, ...drawTree(tree.nodes), `  共 ${tree.entries} 个节点${tree.truncated ? "（已截断）" : ""}`].join("\n"), tree);
    return;
  }

  // 单个插件详情：--plugins <名字>
  const i = args.indexOf("--plugins");
  const name = args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : "";
  if (name) {
    const p = ov.plugins.find((x) => x.name === name);
    const tree = p && p.real_path ? plugman.pluginTree(p.real_path, { depth: 3 }) : null;
    emit(renderPluginDetail(name, ov, tree), { plugin: p, tree, changed: p ? ov.changed.packages.filter((g) => g.paths.length) : [] });
    return;
  }

  emit(renderPlugins(ov), ov);
}

/** overview 里只带了包的汇总；--changes 想按文件列，就再实扫一次（有缓存，便宜）。 */
function scanItemsFor(ov) {
  void ov;
  return plugman.scanChanges().items;
}

function printPrompts(st) {
  const out = ["dsh-purge 破甲提示词 / Prompt Sets", ""];
  out.push(`  存储目录  ${st.dir}`);
  out.push(`  生效文件  ${st.inject_path}  (${prompts.formatSize(st.inject_bytes)})`);
  out.push(`  当前状态  ${st.active ? (st.synced ? `激活: ${st.active}（已同步）` : `激活: ${st.active}（有未保存改动）`) : "未激活任何一套"}`);
  out.push("");
  for (const p of st.prompts) {
    out.push(`  ${p.id === st.active ? "▶" : "·"} ${p.id} (${prompts.formatSize(p.size)})${p.id === st.active ? "  ★ 当前" : ""}`);
  }
  if (st.prompts.length === 0) out.push("  （暂无套）");
  out.push("", "用法： dsh-purge --prompt use <id> | save <id> | off");
  return out.join("\n");
}

async function handlePromptCli() {
  const i = args.indexOf("--prompt");
  const sub = (args[i + 1] || "list").toLowerCase();
  const id = args[i + 2];
  const dshHome = core.findDshHome();
  try {
    if (sub === "use") {
      if (!id) throw new Error("用法: dsh-purge --prompt use <id>");
      const r = await prompts.usePrompt(dshHome, id);
      console.log(`✓ 已切到「${id}」。${r.flushed ? "（原来那套的改动已自动存回）" : ""}`);
    } else if (sub === "save") {
      if (!id) throw new Error("用法: dsh-purge --prompt save <id>");
      const r = await prompts.captureCurrent(dshHome, id);
      console.log(`✓ 已把当前 prompt-inject.md 存成「${id}」（${prompts.formatSize(r.size)}）`);
    } else if (sub === "off") {
      await prompts.detachPrompt(dshHome);
      console.log("✓ 已关掉破甲提示词（prompt-inject.md 已清空，正文存回原套）");
    } else if (sub === "delete") {
      if (!id) throw new Error("用法: dsh-purge --prompt delete <id>");
      await prompts.deletePrompt(dshHome, id);
      console.log(`✓ 已删除「${id}」`);
    } else {
      console.log(printPrompts(await prompts.promptsStatus(dshHome)));
      return;
    }
    console.log("");
    console.log(printPrompts(await prompts.promptsStatus(dshHome)));
    console.log("");
    console.log("提示词改动下一句话即生效（不用重启）。");
  } catch (e) {
    console.log(`[ERROR] ${e.message}`);
    process.exit(1);
  }
}

function printStatus(state) {
  const out = [];
  out.push("dsh-purge 状态 / Status");
  out.push("  DSH_HOME      " + state.dsh_home);
  out.push("  开关配置      " + core.purgeConfigPath(state.dsh_home));
  if (state.ai_base) {
    out.push("  插件根 / root  " + state.ai_base);
    for (const [key, fp] of Object.entries(state.files)) {
      out.push(`    ${key.padEnd(22)} ${fp}`);
    }
  } else {
    out.push("  插件根 / root  NOT FOUND (set DSH_BASE)");
  }
  out.push(`  shim 目录      ${state.shim_dir || "未定位 / not found"}`);
  out.push(`  备份 / backup  ${state.has_backup ? "有 / yes" : "无 / no"}`);
  out.push(`  注入文件       ${state.override_path}`);
  out.push(`  注入状态       ${state.override_status}`);
  out.push("");
  out.push("  分组开关 / Groups");
  for (const g of core.groupStatus(state.disabled_groups)) {
    out.push(`    ${g.enabled ? "✓ 开" : "✗ 关"} ${g.id.padEnd(9)} ${String(g.label).padEnd(12)} ${String(g.count).padStart(2)} 个补丁`);
  }
  out.push("");
  out.push(`  补丁 ${state.patches_applied}/${state.patches_total} 已清洗, ${state.patches_pending} 待清洗`);
  for (const p of core.ALL_PATCHES) {
    const s = state.patch_status[p.id];
    const mark = s === "applied" ? "✓" : s === "pending" ? "✗" : s === "disabled" ? "·" : "-";
    out.push(`    ${mark} [#${String(p.id).padEnd(2)}] ${p.name.padEnd(30)} ${p.layer}/${p.layer_en} — ${s}`);
  }
  out.push("");
  out.push(`  shim: dsh.cmd=${state.shim_cmd}  dsh.ps1=${state.shim_ps1}  dsh=${state.shim_bin}`);
  return out.join("\n");
}

function printGroups(disabled) {
  const out = ["dsh-purge 分组开关 / Groups", ""];
  for (const g of core.groupStatus(disabled)) {
    out.push(`  ${g.enabled ? "✓ 开" : "✗ 关"}  ${g.id.padEnd(9)} ${String(g.label).padEnd(12)} ${String(g.count).padStart(2)} 个补丁`);
    out.push(`           ${g.desc}`);
  }
  out.push("", "切换： dsh-purge --group sandbox off");
  out.push("注： compat 组不允许关闭（不修就会坏的兼容补丁）。");
  return out.join("\n");
}

async function syncToSwitches(dshHome) {
  const disabled = core.readDisabledGroups(dshHome);
  const state = await core.gatherState(disabled);
  if (!state.ai_base) {
    console.log("[ERROR] 未找到 @deepseek-ai 插件根，无法重打");
    return;
  }
  const rev = await core.revertAll(state.ai_base);
  await core.backupAll(state.ai_base);
  const report = await core.applyPatches(state.ai_base, core.selectPatches(disabled));
  console.log(`  已还原 ${rev.reverted.length} 个文件，按当前开关重打：`);
  for (const r of report) {
    const m = r.status === "applied" ? "✓ 已打" : r.status === "already" ? "- 已是最新" : r.status === "missing_file" ? "⚠ 文件缺失" : `✗ ${r.status}`;
    console.log(`    ${m} patch #${String(r.patch_id).padEnd(2)} ${r.name}`);
  }
  console.log("");
  console.log(disabled.length ? `  已关闭的组（保持官方原版）: ${disabled.join(", ")}` : "  所有组都开着。");
  console.log("  重启 dsh 生效 / Restart dsh to take effect.");
}

async function main() {
  const mode = args.find((a) => [
    "--apply", "--revert", "--status", "--edit", "--help", "--groups", "--sync", "--group",
    "--prompts", "--prompt", "--plugins", "--changes", "--diff", "--tree",
  ].includes(a));

  if (mode === "--help" || args.includes("-h")) {
    console.log(`dsh-purge 用法:
  dsh-purge --status                  显示状态
  dsh-purge --apply                   应用全部清洗
  dsh-purge --revert                  回滚还原
  dsh-purge --sync                    还原后按当前开关重打
  dsh-purge --groups                  看分组开关
  dsh-purge --group <名字> on|off     切换某个组（自动 sync）
  dsh-purge --prompts                 看破甲提示词有哪些套
  dsh-purge --prompt use <id>         切到某一套（下一句生效）
  dsh-purge --prompt save <id>        把当前 prompt-inject.md 存成一套
  dsh-purge --prompt delete <id>      删除一套
  dsh-purge --prompt off              关掉破甲（清空 prompt-inject.md）
  dsh-purge --edit                    编辑注入文件 prompt-inject.md

插件管理器（哪个插件改了 dsh 的哪些文件）:
  dsh-purge --plugins                 列插件（安装方式 / 本体位置 / 改了哪些）
  dsh-purge --plugins <名字>          单个插件详情（本体 + 它自己的文件树 + 改了哪些）
  dsh-purge --changes                 全局改动总览（按包分组）+ 自报 vs 实扫的差集
  dsh-purge --diff <文件路径>         改前/改后对比（用 .dshpurge.bak）
  dsh-purge --tree <插件名|目录>      文件树（--depth N 控制深度，默认 3）
  加 --json 输出机器可读 JSON（给 AI 用）

  dsh-purge --help                    帮助`);
    return;
  }

  if (["--plugins", "--changes", "--diff", "--tree"].includes(mode)) {
    try {
      await handlePluginsCli();
    } catch (e) {
      console.log(`[ERROR] ${e.message}`);
      process.exit(1);
    }
    return;
  }

  if (mode === "--prompts" || mode === "--prompt") {
    await handlePromptCli();
    return;
  }

  const state = await core.gatherState(core.readDisabledGroups(core.findDshHome()));

  if (mode === "--groups") {
    console.log(printGroups(state.disabled_groups));
    return;
  }

  console.log(printStatus(state));
  console.log("");

  if (mode === "--group") {
    const i = args.indexOf("--group");
    const name = (args[i + 1] || "").toLowerCase();
    const value = (args[i + 2] || "").toLowerCase();
    if (!name || !["on", "off"].includes(value)) {
      console.log("用法: dsh-purge --group <组名> on|off");
      console.log("可用组: " + core.groupStatus().map((g) => g.id).join(" / "));
      process.exit(1);
    }
    if (!(name in core.PATCH_GROUPS)) {
      console.log(`[ERROR] 没有这个组: ${name}`);
      process.exit(1);
    }
    if (core.NEVER_DISABLE_GROUPS.includes(name)) {
      console.log(`[ERROR] 组 ${name} 不允许关闭（兼容性补丁）`);
      process.exit(1);
    }
    const family = core.coupledGroupsOf(name);
    const next = new Set(state.disabled_groups);
    for (const g of family) {
      if (value === "on") next.delete(g);
      else next.add(g);
    }
    const saved = await core.writeDisabledGroups(state.dsh_home, [...next]);
    console.log(`组 ${name} 已${value === "on" ? "打开" : "关闭"}。当前关闭的组: ${saved.length ? saved.join(", ") : "(无)"}`);
    if (family.length > 1) {
      console.log(`注：${family.join(" 和 ")} 是绑定的（dsh 会校验这两个默认值的组合，必须同开同关），所以一起改了。`);
    }
    console.log("");
    await syncToSwitches(state.dsh_home);
    return;
  }

  if (mode === "--apply") {
    if (!state.ai_base) {
      console.log("[ERROR] 未找到 @deepseek-ai 插件根");
      console.log("  fix: 设置 DSH_BASE=完整路径");
      process.exit(1);
    }
    const { made, errors } = await core.backupAll(state.ai_base);
    for (const b of made) console.log(`  ✓ 备份 / backup → ${b}`);
    for (const [p, e] of errors) console.log(`  ⚠ 备份失败 ${p}: ${e}`);
    const report = await core.applyPatches(state.ai_base, core.selectPatches(state.disabled_groups));
    for (const r of report) {
      const m = r.status === "applied" ? "✓ 已清洗" : r.status === "already" ? "- 已是最新" : r.status === "missing_file" ? "⚠ 文件缺失" : `✗ ${r.status}`;
      console.log(`  ${m} patch #${String(r.patch_id).padEnd(2)} ${r.name}`);
    }
    if (state.disabled_groups.length) console.log(`  · 已跳过关闭的组: ${state.disabled_groups.join(", ")}`);
    const flash = core.silenceCmdFlash(state.ai_base);
    console.log(`  cmd-flash=${flash.entry} phase-1=${flash.phase1} ok=${flash.ok}`);
    const ov = await core.installOverride(state.dsh_home, false);
    console.log(ov === "wrote" ? `  ✓ 写入 ${state.override_path}` : "  - prompt-inject.md 已存在 (你的自定义内容将保留)");
    if (state.shim_dir) {
      const r = await core.patchShim(state.shim_dir);
      for (const [fname, st] of Object.entries(r)) {
        if (st === "patched") console.log(`  ✓ shim ${fname} 注入 / injected`);
        else if (st === "already_patched") console.log(`  - shim ${fname} 已注入 / already injected`);
        else if (st === "missing") console.log(`  - shim ${fname} 不存在 / missing`);
        else console.log(`  ⚠ shim ${fname}: ${st}`);
      }
    } else {
      console.log("  ⚠ 未定位 shim 目录，跳过注入");
    }
    console.log("");
    console.log("全部完成 / All done。重启 dsh 生效 / Restart dsh to take effect.");
  } else if (mode === "--sync") {
    await syncToSwitches(state.dsh_home);
  } else if (mode === "--revert") {
    if (state.ai_base) {
      const { reverted, errors } = await core.revertAll(state.ai_base);
      for (const p of reverted) console.log(`  ✓ 已还原 / Reverted ${p}`);
      for (const [p, e] of errors) console.log(`  ⚠ 还原失败 ${p}: ${e}`);
      if (reverted.length === 0) console.log("  - 没有补丁备份可还原 / no patch backup");
    }
    if (state.shim_dir) {
      const r = await core.revertShim(state.shim_dir);
      for (const [fname, st] of Object.entries(r)) {
        if (st === "reverted" || st === "stripped_inject") console.log(`  ✓ shim ${fname}: ${st}`);
        else console.log(`  - shim ${fname}: ${st}`);
      }
    }
    console.log("");
    console.log("回滚完成 / Revert done。重启 dsh 后恢复 / restart to restore.");
    console.log("注: prompt-inject.md 保留（用户文件）/ prompt-inject.md kept (user file)");
  } else if (mode === "--edit") {
    const r = core.editOverride(state.dsh_home);
    if (!r.ok && r.needCreate) {
      await core.installOverride(state.dsh_home, true);
      console.log(`  ✓ 已创建默认注入文件：${state.override_path}`);
      core.editOverride(state.dsh_home);
    } else {
      console.log(`  → 已打开 ${r.editor} 编辑注入文件：${r.path}`);
    }
    console.log("  编辑完成后重启 dsh 生效。");
  } else {
    // 默认只显示状态（对齐 py 的"默认不清洗"）
    console.log("默认不清洗，使用 --apply 应用清洗。");
  }
}

main().catch((e) => {
  console.error("[dsh-purge] error:", e);
  process.exit(1);
});
