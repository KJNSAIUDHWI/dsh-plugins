// dsh-purge 插件入口（小杨）
// 功能（移植自 dsh_purge.py，一个不差）：
//   1. 启动自动重洗（autoApplyOnStart）— 解决 npm 升级覆盖 node_modules 后需手动重跑的痛点
//   2. /purge 命令 — status / apply / revert / edit / help
//   2b. /rules 命令 — list / use / create / delete / reset
//   3. 模型工具 — purge_status / purge_apply / purge_revert
//   4. systemPrompt 注入 — 会话强指令 section（兜底，不依赖改文件）

import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as core from "./core.js";
import * as rules from "./rules.js";
import * as prompts from "./prompts.js";
import * as runtime from "./runtime.js";
import * as plugman from "./plugman.js";
import {
  GLOBAL_PROMPT_ORDER,
  rewritePromptAssembly,
} from "./identity.js";

export const name = "dsh-purge";

export const inject = ["systemPrompt", "tools"];

const DEFAULTS = {
  enabled: true,
  autoApplyOnStart: true,
  autoRevertOnMissing: false,
  postPrompt: "",
  postPromptOrder: 5100,
  // 分组开关：这里的值只在 $DSH_HOME/dsh-purge.json 还没生成时用作初始值。
  // 之后以那个文件为准（插件和命令行读同一份）。
  disabledGroups: [],
  verbose: false,
};

const log = (config, ...args) => {
  if (config?.verbose) console.log("[dsh-purge]", ...args);
};

function fsExists(fp) {
  return fs.existsSync(fp);
}

// ── 文本渲染（无 rich 依赖）───────────────────────────────────────

function line(title, value, ok = null) {
  const mark = ok === null ? "·" : ok ? "✓" : "✗";
  return `${mark} ${title}: ${value}`;
}

function renderStatus(state) {
  const out = [];
  out.push("dsh-purge 状态 / Status");
  out.push(line("DSH_HOME", state.dsh_home));
  if (state.ai_base) {
    out.push(line("插件根 / plugin root", state.ai_base));
    for (const [key, fp] of Object.entries(state.files)) {
      out.push(`    ${fsExists(fp) ? "✓" : "✗"} ${key.padEnd(22)} ${fp}`);
    }
  } else {
    out.push(line("插件根 / plugin root", "NOT FOUND (set DSH_BASE)", false));
  }
  out.push(line("shim 目录", state.shim_dir || "未定位 / not found", !!state.shim_dir));
  if (state.desktop_runtimes?.length) {
    out.push(line("Desktop runtime", `${state.desktop_runtimes.length} sealed (shim OK; bak external)`, true));
    for (const d of state.desktop_runtimes) out.push(`    · ${d}`);
  }
  out.push(line("备份 / backup", state.has_backup ? "有 / yes" : "无 / no", state.has_backup));
  out.push(line("注入文件 / inject", state.override_path));
  out.push(line("注入状态 / override", state.override_status));
  out.push(line("开关配置 / config", core.purgeConfigPath(state.dsh_home)));
  out.push("");
  out.push("分组开关 / Groups");
  for (const g of core.groupStatus(state.disabled_groups)) {
    out.push(`  ${g.enabled ? "✓ 开" : "✗ 关"} ${g.id.padEnd(9)} ${String(g.label).padEnd(12)} ${g.count} 个补丁 — ${g.desc}`);
  }
  out.push("");
  out.push(`补丁 / patches: ${state.patches_applied}/${state.patches_total ?? core.ALL_PATCHES.length} applied, ${state.patches_pending} pending`);
  for (const p of core.ALL_PATCHES) {
    const s = state.patch_status[p.id];
    const mark = s === "applied" ? "✓" : s === "pending" ? "✗" : s === "disabled" ? "·" : "-";
    out.push(`  ${mark} [#${String(p.id).padEnd(2)}] ${p.name.padEnd(30)} ${p.layer}/${p.layer_en} — ${s}`);
  }
  out.push("");
  out.push(`shim: dsh.cmd=${state.shim_cmd}  dsh.ps1=${state.shim_ps1}  dsh=${state.shim_bin}`);
  return out.join("\n");
}

function readInjectFile(injectFile) {
  try {
    if (!injectFile || !fs.existsSync(injectFile)) return "";
    return fs.readFileSync(injectFile, "utf8").trim();
  } catch {
    return "";
  }
}

export function registerPromptSections(ctx, config, injectFile) {
  // prompt-inject.md verbatim. No plugin identity card.
  ctx.systemPrompt.section({
    name: "dsh-purge",
    order: GLOBAL_PROMPT_ORDER,
    text: () => {
      if (!config.enabled) return "";
      return readInjectFile(injectFile);
    },
  });

  // Rule sets are deliberately NOT a section here. rules.js writes them to
  // $DSH_HOME/AGENTS.md, and the official dsh-agent-instructions reader already
  // injects that file into every session — registering them as a section too put
  // the same text into the system prompt twice. Keep the rule SETS managed by
  // the settings page / rules HTTP routes; delivery belongs to the official path.
  const postPrompt = typeof config.postPrompt === "string" ? config.postPrompt.trim() : "";
  if (!postPrompt) return;
  if (!Number.isFinite(config.postPromptOrder) || config.postPromptOrder <= GLOBAL_PROMPT_ORDER) {
    throw new TypeError(`postPromptOrder must be a finite number greater than ${GLOBAL_PROMPT_ORDER}`);
  }
  ctx.systemPrompt.section({
    name: "dsh-purge:post",
    order: config.postPromptOrder,
    text: postPrompt,
  });
}

/** Cap fallback inject read so a huge/corrupt prompt-inject.md cannot blow memory each assemble. */
const INJECT_FALLBACK_MAX_BYTES = 512 * 1024;

function readInjectFallback() {
  try {
    const fp = core.findOverrideFile(core.findDshHome());
    if (!fp || !fs.existsSync(fp)) return "";
    const st = fs.statSync(fp);
    if (!st.isFile() || st.size <= 0) return "";
    if (st.size <= INJECT_FALLBACK_MAX_BYTES) return fs.readFileSync(fp, "utf8");
    const fd = fs.openSync(fp, "r");
    try {
      const buf = Buffer.alloc(INJECT_FALLBACK_MAX_BYTES);
      const n = fs.readSync(fd, buf, 0, INJECT_FALLBACK_MAX_BYTES, 0);
      return buf.toString("utf8", 0, n);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}

function installIdentityOverride(ctx, cfg) {
  if (typeof ctx.on !== "function") return;
  const hook = async (_assembly, _context, next) => {
    const assembled = typeof next === "function" ? await next() : _assembly;
    // 软开关关掉就整个让开：官方身份不再被剥、注入也不再折进 persona。
    // （读的是 cfg 这个活对象，所以设置页一改立刻生效，不用重启。）
    if (!cfg.enabled) return assembled;
    // Fallback file read covers Liangshen phase-1 races where purge sections
    // were filtered before this hook ran — first turn must still get inject.
    return rewritePromptAssembly(assembled, readInjectFallback());
  };
  // Inner (no prepend): fold inject into persona BEFORE Liangshen phase-1 filter.
  try {
    ctx.on("system-prompt/assemble", hook, { global: true, prepend: false });
  } catch {}
  // Outer (prepend): if filter already ran, re-fold from file. Re-register once
  // after plugins settle so we stay outermost without stacking three listeners.
  ctx.on("system-prompt/assemble", hook, { global: true, prepend: true });
  const late = () => {
    try {
      ctx.on("system-prompt/assemble", hook, { global: true, prepend: true });
    } catch {}
  };
  queueMicrotask(late);
  setTimeout(late, 1500);
}

// ── 自动重洗 ──────────────────────────────────────────────────────

const LAUNCHER_SHIM_NAMES = ["dsh.cmd", "dsh.ps1", "dsh"];

function desktopShimNeedsPatch(dirs) {
  for (const dir of dirs || []) {
    for (const name of LAUNCHER_SHIM_NAMES) {
      if (core.shimFileStatus(path.join(dir, name)) === "original") return true;
    }
  }
  return false;
}

function shimNeedsPatch(state) {
  return (
    state.shim_cmd === "original" ||
    state.shim_ps1 === "original" ||
    state.shim_bin === "original" ||
    desktopShimNeedsPatch(state.desktop_runtimes)
  );
}

async function autoApply(config, switches) {
  try {
    core.applyRuntimeEnv();
    const sanitized = core.sanitizeDesktopCommandRuntimes();
    if (sanitized.length) log(config, "desktop runtime sanitized:", JSON.stringify(sanitized));

    const state = await core.gatherState(switches.disabledGroups);
    if (!config.enabled) {
      // 软开关关着：注入和补丁都不动。shim 也不碰，免得"关掉总开关"还在偷偷改启动器。
      log(config, "auto-apply skipped: plugin disabled (soft off)");
      return "soft_off";
    }
    await core.installOverride(state.dsh_home, false);
    if (!state.ai_base) {
      log(config, "skip auto-apply: plugin root not found");
      return "skip:plugin_root_not_found";
    }
    // No-flash must complete on every start — same pass as UI Apply.
    try {
      const flash = core.silenceCmdFlash(state.ai_base);
      log(config, "cmd-flash:", JSON.stringify(flash));
      if (!flash.ok) log(config, "cmd-flash incomplete:", flash.entry);
    } catch (e) {
      log(config, "cmd-flash failed:", String(e));
    }

    if (state.patches_pending === 0) {
      if (config.autoApplyOnStart && shimNeedsPatch(state)) {
        await core.patchAllShims();
        core.silenceCmdFlash(state.ai_base);
        log(config, "auto-apply: patches clean, shim refreshed");
        return "already_clean:shim_patched";
      }
      log(config, "auto-apply: already clean");
      return "already_clean";
    }
    if (!config.autoApplyOnStart) {
      log(config, "auto-apply disabled");
      return "disabled";
    }
    await core.backupAll(state.ai_base);
    const report = await core.applyPatches(state.ai_base, core.selectPatches(switches.disabledGroups));
    await core.patchAllShims();
    const flash = core.silenceCmdFlash(state.ai_base);
    const applied = report.filter((r) => r.status === "applied").length;
    log(config, `auto-apply done: ${applied} applied; cmd-flash=${flash.entry} ok=${flash.ok}`);
    return flash.ok ? `applied:${applied}` : `applied:${applied}:cmd_flash_incomplete`;
  } catch (e) {
    console.warn("[dsh-purge] auto-apply error:", String(e));
    return `error:${e}`;
  }
}

// ── 命令处理 ──────────────────────────────────────────────────────

async function handlePurgeCommand(rawInput, config, switches) {
  const args = (rawInput || "").trim().split(/\s+/).filter(Boolean);
  const sub = (args[0] || "status").toLowerCase();

  switch (sub) {
    case "status":
    case "s": {
      const state = await core.gatherState(switches.disabledGroups);
      return { kind: "success", text: renderStatus(state) };
    }
    case "groups":
    case "g": {
      const lines = ["分组开关 / Groups（改开关会自动「还原→重打」一遍）", ""];
      for (const g of core.groupStatus(switches.disabledGroups)) {
        lines.push(`  ${g.enabled ? "✓ 开" : "✗ 关"}  ${g.id.padEnd(9)} ${String(g.label).padEnd(12)} ${String(g.count).padStart(2)} 个补丁`);
        lines.push(`           ${g.desc}`);
      }
      lines.push("", "切换： /purge group sandbox off    （关掉沙箱那组）");
      lines.push("        /purge group sandbox on     （打开）");
      lines.push("        /purge sync                 （只重打一遍，不改开关）");
      lines.push("注1： compat 组是「不修就会坏」的兼容补丁，不允许关闭。");
      lines.push("注2： sandbox 和 approval 是绑定的 —— dsh 会校验这两个默认值的组合，");
      lines.push("      只有「workspace-write + ask」和「danger-full-access + never」两种合法组合。");
      lines.push("      单独关一个会让 dsh 启动失败，所以动一个另一个会跟着动。");
      return { kind: "success", text: lines.join("\n") };
    }
    case "group": {
      const name = (args[1] || "").toLowerCase();
      const value = (args[2] || "").toLowerCase();
      if (!name || !["on", "off", "开", "关"].includes(value)) {
        return { kind: "error", text: "用法: /purge group <组名> on|off\n组名: " + core.groupStatus().map((g) => g.id).join(" / ") };
      }
      if (!(name in core.PATCH_GROUPS)) {
        return { kind: "error", text: `没有这个组: ${name}\n可用: ${core.groupStatus().map((g) => g.id).join(" / ")}` };
      }
      if (core.NEVER_DISABLE_GROUPS.includes(name)) {
        return { kind: "error", text: `组 ${name} 不允许关闭（兼容性补丁，关了会出问题）` };
      }
      const wantEnabled = value === "on" || value === "开";
      // sandbox 和 approval 是绑定的：dsh 会校验这两个默认值的组合是否命中预设表，
      // 只改一个会拼出非法组合、导致 dsh 启动失败。所以这里联动。
      const family = core.coupledGroupsOf(name);
      const next = new Set(switches.disabledGroups);
      for (const g of family) {
        if (wantEnabled) next.delete(g);
        else next.add(g);
      }
      switches.disabledGroups = await core.writeDisabledGroups(core.findDshHome(), [...next]);
      const coupledNote =
        family.length > 1 ? `\n注：${family.join(" 和 ")} 是绑定的（dsh 会校验这两个默认值的组合，必须同开同关），所以一起改了。` : "";
      // 开关要靠"还原 → 重打"才落到文件上，所以这里直接连做，避免用户漏一步。
      const res = await handlePurgeCommand("sync", config, switches);
      return {
        kind: "success",
        text: `组 ${name} 已${wantEnabled ? "打开" : "关闭"}。${coupledNote}\n\n` + res.text,
      };
    }
    case "sync": {
      const state = await core.gatherState(switches.disabledGroups);
      if (!state.ai_base) {
        return { kind: "error", text: "插件根未找到 / plugin root NOT FOUND — 请设置 DSH_BASE" };
      }
      // 先把所有目标文件还原成官方原版，再按当前开关重打一遍。
      const rev = await core.revertAll(state.ai_base);
      await core.backupAll(state.ai_base);
      const report = await core.applyPatches(state.ai_base, core.selectPatches(switches.disabledGroups));
      await core.patchAllShims();
      const lines = [`已还原 ${rev.reverted.length} 个文件，按当前开关重打：`];
      for (const r of report) {
        const m = r.status === "applied" ? "✓ 已打" : r.status === "already" ? "- 已是最新" : r.status === "missing_file" ? "⚠ 文件缺失" : `✗ ${r.status}`;
        lines.push(`  ${m} patch #${String(r.patch_id).padEnd(2)} ${r.name}`);
      }
      const off = switches.disabledGroups;
      lines.push("", off.length ? `已关闭的组（这些保持官方原版）: ${off.join(", ")}` : "所有组都开着。");
      lines.push("重启 dsh 生效 / Restart dsh to take effect.");
      return { kind: "success", text: lines.join("\n") };
    }
    case "apply":
    case "a": {
      core.applyRuntimeEnv();
      const scrubbed = core.sanitizeDesktopCommandRuntimes();
      const state = await core.gatherState(switches.disabledGroups);
      if (!state.ai_base) {
        return { kind: "error", text: "插件根未找到 / plugin root NOT FOUND — 请设置 DSH_BASE" };
      }
      await core.backupAll(state.ai_base);
      const report = await core.applyPatches(state.ai_base, core.selectPatches(switches.disabledGroups));
      await core.installOverride(state.dsh_home, false);
      const shimResult = await core.patchAllShims();
      const flash = core.silenceCmdFlash(state.ai_base);
      const lines = report.map((r) => {
        const m = r.status === "applied" ? "✓ 已清洗" : r.status === "already" ? "- 已是最新" : r.status === "missing_file" ? "⚠ 文件缺失" : `✗ ${r.status}`;
        return `  ${m} patch #${String(r.patch_id).padEnd(2)} ${r.name}`;
      });
      lines.push("", "shim:");
      for (const [dir, st] of Object.entries(shimResult)) {
        lines.push(`  · ${dir} → ${typeof st === "object" ? JSON.stringify(st) : st}`);
      }
      lines.push(`  cmd-flash=${flash.entry} phase-1=${flash.phase1} ok=${flash.ok}`);
      if (scrubbed.length) {
        lines.push("", "Desktop in-bin .bak scrub:");
        for (const row of scrubbed) lines.push(`  ✓ ${row.dir} → ${row.cleaned.join(", ")}`);
      }
      lines.push("", "全部完成 / All done。重启 dsh 生效 / Restart dsh to take effect.");
      lines.push("Desktop: host-commands 密封目录只清理不注入；bak 禁止写进 bin（issue #9）。");
      return { kind: "success", text: lines.join("\n") };
    }
    case "prompt":
    case "p": {
      return handlePromptCommand(args);
    }
    case "revert":
    case "r": {
      const state = await core.gatherState();
      const lines = [];
      if (state.ai_base) {
        const { reverted, errors } = await core.revertAll(state.ai_base);
        lines.push(...reverted.map((p) => `  ✓ 已还原 / Reverted ${p}`));
        for (const [p, e] of errors) lines.push(`  ⚠ 还原失败 ${p}: ${e}`);
        if (reverted.length === 0) lines.push("  - 没有补丁备份可还原 / no patch backup");
      }
      const shimRevert = await core.revertAllShims();
      for (const [dir, st] of Object.entries(shimRevert)) {
        lines.push(`  shim ${dir}: ${typeof st === "object" ? JSON.stringify(st) : st}`);
      }
      lines.push("", "回滚完成 / Revert done。重启 dsh 后恢复 / restart to restore.");
      lines.push("注: prompt-inject.md 保留（用户文件）/ prompt-inject.md kept (user file)");
      return { kind: "success", text: lines.join("\n") };
    }
    case "edit":
    case "e": {
      const state = await core.gatherState();
      const r = core.editOverride(state.dsh_home);
      if (!r.ok && r.needCreate) {
        await core.installOverride(state.dsh_home, true);
        const r2 = core.editOverride(state.dsh_home);
        return {
          kind: "success",
          text: `已创建默认注入文件并打开编辑器：${r2.path}\n重启 dsh 生效。`,
        };
      }
      return {
        kind: "success",
        text: `已打开 ${r.editor} 编辑注入文件：${r.path}\n编辑完成后重启 dsh 生效。`,
      };
    }
    case "help":
    case "h":
    default:
      return {
        kind: "success",
        text:
          "dsh-purge 命令：\n" +
          "  /purge status     显示状态（含分组开关）\n" +
          "  /purge apply      应用全部清洗\n" +
          "  /purge revert     回滚还原（全部回官方原版）\n" +
          "  /purge sync       按当前开关「还原 → 重打」一遍\n" +
          "  /purge groups     看分组开关\n" +
          "  /purge group <组名> on|off   开关某组（自动 sync）\n" +
          "  /purge prompt ... 破甲提示词多套切换（list/use/save/off）\n" +
          "  /purge edit       编辑注入文件 prompt-inject.md\n" +
          "  /purge help       显示帮助\n" +
          "规则集切换见 /rules（list | use <id> | create | delete | reset）",
      };
  }
}

function renderRulesStatus(st) {
  const out = [];
  out.push("规则集 / Rule Sets");
  out.push(`  存储目录 / store  ${st.rules_dir}`);
  const targetLine = st.active
    ? `${st.agents_path} (${st.active_target})`
    : "(无激活)";
  out.push(`  目标文件 / target ${targetLine} — exists=${st.agents_exists}, synced=${st.agents_synced}`);
  out.push("");
  if (st.rules.length === 0) {
    out.push("  (暂无规则 / no rules — 用 /rules create <id> 或设置页新建)");
  }
  for (const r of st.rules) {
    const isActive = r.id === st.active;
    const label = r.name !== r.id ? `${r.name} (${r.id})` : r.id;
    out.push(`  ${isActive ? "▶" : "·"} ${label}${isActive ? " ★ 当前" : ""} [${r.target}] (${rules.formatSize(r.size)})`);
  }
  return out.join("\n");
}

async function handleRulesCommand(rawInput) {
  const args = (rawInput || "").trim().split(/\s+/).filter(Boolean);
  const sub = (args[0] || "list").toLowerCase();
  const dshHome = core.findDshHome();

  switch (sub) {
    case "list":
    case "ls":
    case "s":
      return { kind: "success", text: renderRulesStatus(await rules.rulesStatus(dshHome)) };
    case "use":
    case "activate":
    case "u": {
      const id = args[1];
      if (!id) return { kind: "error", text: "用法: /rules use <id>" };
      try {
        const meta = await rules.activateRule(dshHome, id);
        return {
          kind: "success",
          text: `✓ 已激活规则 ${meta.name}（${id}）→ 写入 ${rules.targetPath(dshHome, meta.target)}，由 dsh 官方当作全局指令读进每个会话。新会话生效。`,
        };
      } catch (e) {
        return { kind: "error", text: `激活失败: ${e.message}` };
      }
    }
    case "create":
    case "new":
    case "c": {
      const id = args[1];
      if (!id) return { kind: "error", text: "用法: /rules create <id> [别名] [AGENTS.md|CLAUDE.md]" };
      const name = args[2] || id;
      const target = args[3] || "AGENTS.md";
      if (!rules.validTarget(target)) {
        return { kind: "error", text: `无效目标: ${target}（只能是 AGENTS.md 或 CLAUDE.md）` };
      }
      try {
        await rules.saveRule(dshHome, id, "", { name, target });
        return {
          kind: "success",
          text: `✓ 已创建规则 ${name}（${id} → ${target}）。在设置页「规则设定」编辑内容后保存。`,
        };
      } catch (e) {
        return { kind: "error", text: `创建失败: ${e.message}` };
      }
    }
    case "delete":
    case "rm":
    case "d": {
      const id = args[1];
      if (!id) return { kind: "error", text: "用法: /rules delete <id>" };
      try {
        await rules.deleteRule(dshHome, id);
        return { kind: "success", text: `✓ 已删除规则 ${id}。` };
      } catch (e) {
        return { kind: "error", text: `删除失败: ${e.message}` };
      }
    }
    case "reset":
    case "restore":
    case "还原": {
      try {
        const r = await rules.resetToOriginal(dshHome);
        const lines = [];
        if (r.removed.length > 0) lines.push(`✓ 已删除插件写入的目标文件: ${r.removed.join(", ")}`);
        if (r.skipped.length > 0) {
          lines.push(`⚠ 跳过（文件内容与规则不一致，可能被手动修改）: ${r.skipped.join(", ")}`);
        }
        lines.push("已清空激活状态。规则库内容保留，随时可重新激活。现在回到出厂状态：无全局指令。");
        return { kind: "success", text: lines.join("\n") };
      } catch (e) {
        return { kind: "error", text: `还原失败: ${e.message}` };
      }
    }
    case "help":
    case "h":
    default:
      return {
        kind: "success",
        text: "规则集命令：\n" +
          "  /rules list                         列出所有规则\n" +
          "  /rules use <id>                     激活规则（写入 AGENTS.md/CLAUDE.md，并注入 systemPrompt）\n" +
          "  /rules create <id> [别名] [目标]     新建规则\n" +
          "  /rules delete <id>                  删除规则\n" +
          "  /rules reset                        还原原始状态\n" +
          "  /rules help                         显示帮助",
      };
  }
}

// ── 破甲提示词多套切换 ────────────────────────────────────────────

function renderPromptsStatus(st) {
  const out = [];
  out.push("破甲提示词 / Prompt Sets");
  out.push(`  存储目录 / store   ${st.dir}`);
  out.push(`  生效文件 / inject  ${st.inject_path}  (${prompts.formatSize(st.inject_bytes)})`);
  out.push(
    `  当前状态 ${st.active ? (st.synced ? `激活: ${st.active}（已同步）` : `激活: ${st.active}（有未保存改动）`) : "未激活任何一套"}`,
  );
  out.push("");
  if (st.prompts.length === 0) {
    out.push("  （暂无套 / no sets — 用 /purge prompt save <id> 把当前内容存成一套）");
  }
  for (const p of st.prompts) {
    const on = p.id === st.active;
    out.push(`  ${on ? "▶" : "·"} ${p.id} (${prompts.formatSize(p.size)})${on ? "  ★ 当前" : ""}`);
  }
  return out.join("\n");
}

async function handlePromptCommand(args) {
  const sub = (args[1] || "list").toLowerCase();
  const dshHome = core.findDshHome();
  try {
    switch (sub) {
      case "list":
      case "ls":
      case "s":
        return { kind: "success", text: renderPromptsStatus(await prompts.promptsStatus(dshHome)) };
      case "use":
      case "u": {
        const id = args[2];
        if (!id) return { kind: "error", text: "用法: /purge prompt use <id>" };
        const r = await prompts.usePrompt(dshHome, id);
        return {
          kind: "success",
          text: `✓ 已切到「${id}」。${r.flushed ? "（原来那套的改动已自动存回）" : ""}\n下一句话即生效。`,
        };
      }
      case "save":
      case "capture":
      case "c": {
        const id = args[2];
        if (!id) return { kind: "error", text: "用法: /purge prompt save <id>  （把当前 prompt-inject.md 存成一套）" };
        const r = await prompts.captureCurrent(dshHome, id);
        return { kind: "success", text: `✓ 已存成「${id}」（${prompts.formatSize(r.size)}）。用 /purge prompt use ${id} 切换。` };
      }
      case "new": {
        const id = args[2];
        if (!id) return { kind: "error", text: "用法: /purge prompt new <id>" };
        await prompts.savePrompt(dshHome, id, "");
        return { kind: "success", text: `✓ 已新建空白套「${id}」。文件：${prompts.promptPath(dshHome, id)}` };
      }
      case "show":
      case "cat": {
        const id = args[2];
        if (!id) return { kind: "error", text: "用法: /purge prompt show <id>" };
        const c = await prompts.readPrompt(dshHome, id);
        if (c === null) return { kind: "error", text: `没有这一套: ${id}` };
        return { kind: "success", text: `「${id}」开头 800 字：\n\n${c.slice(0, 800)}` };
      }
      case "delete":
      case "rm":
      case "d": {
        const id = args[2];
        if (!id) return { kind: "error", text: "用法: /purge prompt delete <id>" };
        await prompts.deletePrompt(dshHome, id);
        return { kind: "success", text: `✓ 已删除「${id}」。` };
      }
      case "off": {
        const r = await prompts.detachPrompt(dshHome);
        return {
          kind: "success",
          text: `✓ 已关掉破甲提示词：prompt-inject.md 已清空${r.flushed ? "，改动已存回原来那套" : ""}。\n下一句话即生效。想恢复：/purge prompt use <id>`,
        };
      }
      default:
        return {
          kind: "success",
          text: [
            "破甲提示词命令：",
            "  /purge prompt list            列出所有套",
            "  /purge prompt use <id>        切换（切之前自动把改动存回原来那套）",
            "  /purge prompt save <id>       把当前 prompt-inject.md 存成一套",
            "  /purge prompt new <id>        新建空白套",
            "  /purge prompt show <id>       看某套开头",
            "  /purge prompt delete <id>     删除",
            "  /purge prompt off             关掉破甲（清空 prompt-inject.md）",
          ].join("\n"),
        };
    }
  } catch (e) {
    return { kind: "error", text: `prompt 命令失败: ${e.message}` };
  }
}

// ── 插件 apply ────────────────────────────────────────────────────

export function apply(ctx, config) {
  const ymlCfg = { ...DEFAULTS, ...(config || {}) };
  // 硬关：cordis.patch.yml 里写了 enabled: false —— 插件根本不加载。
  // 设置页里的「总开关」是软开关（下面一行盖上去那种），关了插件照样挂着，
  // 否则关掉之后设置页就再也点不回来了。
  if (!ymlCfg.enabled) return;

  // 分组开关和运行时开关的真相来源都是 $DSH_HOME/dsh-purge.json
  // （命令行也读它）。第一次运行时用 cordis.patch.yml 里的值作为初始值落盘。
  const cfgHome = core.findDshHome();
  const persisted = core.readPurgeConfig(cfgHome);
  const cfg = { ...ymlCfg };
  const overridden = runtime.applyRuntimeConfig(cfg, persisted);
  if (overridden.length) log(cfg, "runtime config from dsh-purge.json:", JSON.stringify(overridden));

  let cfgPathExisted = true;
  try {
    cfgPathExisted = fs.existsSync(core.purgeConfigPath(cfgHome));
  } catch {}
  if (!cfgPathExisted) {
    core.writeDisabledGroups(cfgHome, Array.isArray(cfg.disabledGroups) ? cfg.disabledGroups : []).catch(() => {});
  }
  const switches = { disabledGroups: cfgPathExisted ? core.readDisabledGroups(cfgHome) : (Array.isArray(cfg.disabledGroups) ? cfg.disabledGroups : []) };
  log(cfg, "disabled groups:", JSON.stringify(switches.disabledGroups));
  log(cfg, cfg.enabled ? "plugin enabled" : "soft-off: 不注入、不自动重打（设置页仍可用）");

  // Scrub illegal in-bin *.dshpurge.bak early; still patch Desktop launchers later.
  // Windows: force CREATE_NO_WINDOW on every child_process spawn in this host.
  try {
    const hide = core.ensureHiddenConsole();
    log(cfg, "hide-console:", JSON.stringify(hide));
  } catch (e) {
    console.warn("[dsh-purge] hide-console error:", String(e));
  }
  core.applyRuntimeEnv();
  try {
    const scrubbed = core.sanitizeDesktopCommandRuntimes();
    if (scrubbed.length) log(cfg, "desktop runtime scrub on load:", JSON.stringify(scrubbed));
  } catch (e) {
    console.warn("[dsh-purge] desktop runtime scrub error:", String(e));
  }

  // 1. 启动自动重洗（异步，不阻塞启动）
  setImmediate(() => {
    autoApply(cfg, switches).then((r) => log(cfg, "auto-apply:", r));
    rules.ensureInitialState(core.findDshHome())
      .then((r) => log(cfg, "rules init:", JSON.stringify(r)))
      .catch((e) => console.warn("[dsh-purge] rules init error:", String(e)));
    prompts
      .ensureInitialState(core.findDshHome())
      .then((r) => log(cfg, "prompts init:", JSON.stringify(r)))
      .catch((e) => console.warn("[dsh-purge] prompts init error:", String(e)));
  });

  // 2. systemPrompt 注入（操作员提示词放在 persona 之后，避免被 coding agent 盖住）
  installIdentityOverride(ctx, cfg);
  const injectFile = core.findOverrideFile(core.findDshHome());
  registerPromptSections(ctx, cfg, injectFile);

  // 3. /purge 命令
  const commands = ctx.get?.("commands");
  if (commands) {
    commands.register({
      name: "purge",
      description: "dsh 指令权威性清洗（status/apply/revert/sync/groups/group/edit/help）",
      input: { hint: "status | apply | revert | sync | groups | group <组名> on|off | edit | help" },
      handler: async (invocation) => handlePurgeCommand(invocation.rawInput ?? "", cfg, switches),
    });
    commands.register({
      name: "rules",
      description: "规则集切换（写入 AGENTS.md/CLAUDE.md）: list | use <id> | create <id> [别名] [目标] | delete <id> | reset | help",
      input: { hint: "list | use <id> | create <id> [别名] [目标] | delete <id> | reset | help" },
      handler: async (invocation) => handleRulesCommand(invocation.rawInput ?? ""),
    });
  }

  // 4. 模型工具（原始 JSON-Schema ToolDefinition，零 peer 依赖）
  if (ctx.tools) {
    ctx.tools.register({
      name: "purge_status",
      description: `查看 dsh 指令权威性清洗状态（${core.ALL_PATCHES.length} patch 清洗进度、shim 注入、override 文件）。`,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { text: { type: "string" } },
        },
        render: (_args, value) => [{ type: "text", text: String(value?.text ?? "") }],
      },
      async execute() {
        const state = await core.gatherState(switches.disabledGroups);
        return { text: renderStatus(state) };
      },
    });
    ctx.tools.register({
      name: "purge_apply",
      description: `应用 dsh 指令权威性清洗：${core.ALL_PATCHES.length} patch（提示词层+代码默认+引擎级审批/沙箱绕过）+ shim 注入 + override 文件。需重启 dsh 完全生效。`,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { text: { type: "string" } },
        },
        render: (_args, value) => [{ type: "text", text: String(value?.text ?? "") }],
      },
      async execute() {
        core.applyRuntimeEnv();
        const scrubbed = core.sanitizeDesktopCommandRuntimes();
        const state = await core.gatherState(switches.disabledGroups);
        if (!state.ai_base) return { text: "ERROR: 插件根未找到 / set DSH_BASE" };
        await core.backupAll(state.ai_base);
        const report = await core.applyPatches(state.ai_base, core.selectPatches(switches.disabledGroups));
        await core.installOverride(state.dsh_home, false);
        await core.patchAllShims();
        const flash = core.silenceCmdFlash(state.ai_base);
        const applied = report.filter((r) => r.status === "applied").length;
        const already = report.filter((r) => r.status === "already").length;
        const scrubNote = scrubbed.length ? ` desktop_scrub=${scrubbed.length}` : "";
        return { text: `清洗完成 / applied=${applied}, already=${already}.${scrubNote} phase-1=${flash.phase1} 重启 dsh 生效.` };
      },
    });
    ctx.tools.register({
      name: "purge_revert",
      description: "回滚 dsh 指令权威性清洗到备份原件（保留 prompt-inject.md 用户文件）。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { text: { type: "string" } },
        },
        render: (_args, value) => [{ type: "text", text: String(value?.text ?? "") }],
      },
      async execute() {
        const state = await core.gatherState();
        const lines = [];
        if (state.ai_base) {
          const { reverted, errors } = await core.revertAll(state.ai_base);
          lines.push(`reverted=${reverted.length}${errors.length ? ` errors=${errors.length}` : ""}`);
        }
        const shimRevert = await core.revertAllShims();
        lines.push(`shim_dirs=${Object.keys(shimRevert).length}`);
        return { text: `回滚完成 / ${lines.join(", ")}. 重启 dsh 恢复.` };
      },
    });
  }

  // 5. HTTP API（Web UI 设置面板用）
  installWebServer(ctx, cfg, switches, persisted);
}

function portFromRequest(request) {
  const hostHeader = String(request.headers?.host || "");
  const match = hostHeader.match(/:(\d+)$/);
  if (match) return Number(match[1]);
  return 3080;
}

function hostFromRequest(request) {
  const hostHeader = String(request.headers?.host || "127.0.0.1");
  return hostHeader.replace(/:\d+$/, "") || "127.0.0.1";
}

function restartArgv() {
  // Always relaunch via node + absolute bin.js — never dsh.cmd (cmd.exe always flashes).
  const root = core.findDshBinRoot();
  const binJs = root ? path.join(root, "lib", "bin.js") : null;
  if (binJs && fs.existsSync(binJs)) {
    const args = [binJs];
    // Keep profile/subcommand flags from the current process, drop the old entry path.
    const rest = process.argv.slice(2).filter((arg) => arg !== "--no-open");
    // If argv was `node bin.js web ...`, slice(2) is already `web ...`.
    // If argv was `node dsh.cmd web` weirdness, ensure `web` is present when we are a web host.
    if (!rest.includes("web") && !rest.includes("desktop")) {
      const port = Number(process.env.PORT) || 3080;
      rest.unshift("web", "--port", String(port));
    }
    rest.push("--no-open");
    return [...args, ...rest];
  }
  const argv = process.argv.slice(1).filter((arg) => arg !== "--no-open");
  if (argv[0] && /\.(cmd|bat)$/i.test(argv[0])) {
    const dir = path.dirname(argv[0]);
    const candidates = [
      path.resolve(dir, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
      path.resolve(dir, "..", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
    ];
    const hit = candidates.find((p) => fs.existsSync(p));
    if (hit) argv[0] = hit;
  }
  argv.push("--no-open");
  return argv;
}

function scheduleWebRestart(request) {
  // Final no-flash pin before exit so the replacement process loads hide-console first.
  try {
    core.silenceCmdFlash();
  } catch {}
  const helper = fileURLToPath(new URL("./restart-web.js", import.meta.url));
  const child = spawn(process.execPath, [helper], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: false,
    env: {
      ...core.envForDetachedSpawn(),
      DSH_PURGE_RESTART: JSON.stringify({
        execPath: process.execPath,
        argv: restartArgv(),
        cwd: process.cwd(),
        host: hostFromRequest(request),
        port: portFromRequest(request),
      }),
    },
  });
  child.unref();
  // Exit only after the helper is detached; apply/restart handlers already finished.
  setTimeout(() => process.exit(0), 250);
}

// ── Web UI 设置面板后端（HTTP 路由）──────────────────────────────

function installWebServer(ctx, cfg, switches, persisted) {
  ctx.inject(["webServer"], (host) => {
    host.effect(() => {
      host.webServer.register({
        kind: "exact",
        path: "/dsh-purge/status",
        handler: async (request, response) => {
          if (request.method !== "GET") {
            response.writeHead(405, { allow: "GET" });
            response.end();
            return;
          }
          try {
            const state = await core.gatherState(switches.disabledGroups);
            const patch_names = {};
            for (const p of core.ALL_PATCHES) patch_names[String(p.id)] = p.name;
            sendJson(response, 200, {
              ok: true,
              ai_base: state.ai_base,
              patches_applied: state.patches_applied,
              patches_pending: state.patches_pending,
              patches_total: state.patches_total,
              disabled_groups: state.disabled_groups,
              groups: core.groupStatus(state.disabled_groups),
              patch_status: state.patch_status,
              patch_names,
              shim_cmd: state.shim_cmd,
              shim_ps1: state.shim_ps1,
              shim_bin: state.shim_bin,
              has_backup: state.has_backup,
              override_status: state.override_status,
              override_path: state.override_path,
              dsh_home: state.dsh_home,
            });
          } catch (e) {
            sendJson(response, 500, { ok: false, error: String(e) });
          }
        },
      }, "dsh-purge: status");
      host.webServer.register({
        kind: "exact",
        path: "/dsh-purge/apply",
        handler: async (request, response) => {
          if (request.method !== "POST") {
            response.writeHead(405, { allow: "POST" });
            response.end();
            return;
          }
          try {
            core.applyRuntimeEnv();
            const scrubbed = core.sanitizeDesktopCommandRuntimes();
            const state = await core.gatherState(switches.disabledGroups);
            if (!state.ai_base) {
              sendJson(response, 500, { ok: false, error: "插件根未找到 / set DSH_BASE" });
              return;
            }
            await core.backupAll(state.ai_base);
            const report = await core.applyPatches(state.ai_base, core.selectPatches(switches.disabledGroups));
            const override = await core.ensureOverrideContent(state.dsh_home, false);
            const shim = await core.patchAllShims();
            // Apply must finish the no-flash pass before offering restart.
            const flash = core.silenceCmdFlash(state.ai_base);
            const summary = core.summarizeApplyReport(report);
            // Restart when required patches are soft-ok AND (on win32) bin pin is ok/soft.
            const complete = summary.failed.length === 0 && flash.ok === true;
            sendJson(response, 200, {
              ok: true,
              complete,
              applied: summary.applied,
              already: summary.already,
              failed: summary.failed.length,
              failed_items: summary.failed.map((r) => ({
                id: r.patch_id,
                name: r.name,
                status: r.status,
              })),
              report: report.map((r) => ({ id: r.patch_id, name: r.name, status: r.status })),
              override_content: override.content,
              override_path: override.path,
              override_installed: override.installed,
              shim,
              desktop_scrubbed: scrubbed,
              cmd_flash: flash,
            });
          } catch (e) {
            sendJson(response, 500, { ok: false, error: String(e) });
          }
        },
      }, "dsh-purge: apply");
      host.webServer.register({
        kind: "exact",
        path: "/dsh-purge/revert",
        handler: async (request, response) => {
          if (request.method !== "POST") {
            response.writeHead(405, { allow: "POST" });
            response.end();
            return;
          }
          try {
            const state = await core.gatherState();
            const result = {};
            if (state.ai_base) {
              const { reverted, errors } = await core.revertAll(state.ai_base);
              result.reverted = reverted.length;
              result.errors = errors.length;
            }
            result.shim = await core.revertAllShims();
            sendJson(response, 200, { ok: true, ...result, note: "重启 dsh 恢复; prompt-inject.md 保留" });
          } catch (e) {
            sendJson(response, 500, { ok: false, error: String(e) });
          }
        },
      }, "dsh-purge: revert");
      host.webServer.register({
        kind: "exact",
        path: "/dsh-purge/override",
        handler: async (request, response) => {
          if (request.method === "GET") {
            try {
              const dshHome = core.findDshHome();
              const fp = core.findOverrideFile(dshHome);
              let content = "";
              if (fs.existsSync(fp)) content = await fsp.readFile(fp, "utf8");
              sendJson(response, 200, { ok: true, exists: fs.existsSync(fp), content, path: fp });
            } catch (e) {
              sendJson(response, 500, { ok: false, error: String(e) });
            }
            return;
          }
          if (request.method === "POST") {
            try {
              const body = await readJsonBody(request);
              const content = typeof body?.content === "string" ? body.content : null;
              if (content === null) {
                sendJson(response, 400, { ok: false, error: "content must be a string" });
                return;
              }
              const dshHome = core.findDshHome();
              const fp = core.findOverrideFile(dshHome);
              await fsp.mkdir(dshHome, { recursive: true });
              await fsp.writeFile(fp, content, "utf8");
              sendJson(response, 200, { ok: true, path: fp });
            } catch (e) {
              sendJson(response, 500, { ok: false, error: String(e) });
            }
            return;
          }
          response.writeHead(405, { allow: "GET, POST" });
          response.end();
        },
      }, "dsh-purge: override");
      host.webServer.register({
        kind: "exact",
        path: "/dsh-purge/group",
        handler: async (request, response) => {
          if (request.method !== "POST") {
            response.writeHead(405, { allow: "POST" });
            response.end();
            return;
          }
          try {
            const body = await readJsonBody(request);
            const name = typeof body?.name === "string" ? body.name : "";
            const enabled = body?.enabled === true;
            if (!(name in core.PATCH_GROUPS)) {
              sendJson(response, 400, { ok: false, error: `unknown group: ${name}` });
              return;
            }
            if (core.NEVER_DISABLE_GROUPS.includes(name)) {
              sendJson(response, 400, { ok: false, error: `group ${name} cannot be disabled` });
              return;
            }
            // sandbox / approval 绑定：dsh 会校验这两个默认值的组合，只改一个会让它起不来。
            const family = core.coupledGroupsOf(name);
            const next = new Set(switches.disabledGroups);
            for (const g of family) {
              if (enabled) next.delete(g);
              else next.add(g);
            }
            switches.disabledGroups = await core.writeDisabledGroups(core.findDshHome(), [...next]);

            // 开关要落到文件上必须「还原 → 按开关重打」，这里直接做完。
            const state = await core.gatherState(switches.disabledGroups);
            let report = [];
            if (state.ai_base) {
              await core.revertAll(state.ai_base);
              await core.backupAll(state.ai_base);
              report = await core.applyPatches(state.ai_base, core.selectPatches(switches.disabledGroups));
            }
            sendJson(response, 200, {
              ok: true,
              disabled_groups: switches.disabledGroups,
              groups: core.groupStatus(switches.disabledGroups),
              coupled: family.length > 1 ? family : null,
              applied: report.filter((r) => r.status === "applied").length,
              reverted: report.length ? true : false,
              note: "重启 dsh 生效 / restart dsh to take effect",
            });
          } catch (e) {
            sendJson(response, 500, { ok: false, error: String(e) });
          }
        },
      }, "dsh-purge: group toggle");
      installRulesHttp(host.webServer);
      installPromptsHttp(host.webServer);
      installRuntimeHttp(host.webServer, cfg, switches, persisted);
      installPluginsHttp(host.webServer, switches);
      host.webServer.register({
        kind: "exact",
        path: "/dsh-purge/restart",
        handler: async (request, response) => {
          if (request.method !== "POST") {
            response.writeHead(405, { allow: "POST" });
            response.end();
            return;
          }
          try {
            scheduleWebRestart(request);
            sendJson(response, 200, { ok: true, note: "正在重启 dsh web…" });
          } catch (e) {
            sendJson(response, 500, { ok: false, error: String(e) });
          }
        },
      }, "dsh-purge: restart");
    }, "dsh-purge: http routes");
  });
}

function methodNotAllowed(request, response, allow) {
  if (allow.includes(request.method)) return false;
  response.writeHead(405, { allow: allow.join(", ") });
  response.end();
  return true;
}

// ── 运行时开关 / 身份层 / shim（设置页「高级」页用）──────────────

function installRuntimeHttp(webServer, cfg, switches, persisted) {
  const dshHome = core.findDshHome();

  const configPayload = async () => {
    const saved = core.readPurgeConfig(dshHome);
    const identity = runtime.readIdentityLayer();
    return {
      ok: true,
      ...runtime.runtimeStatus(cfg, saved),
      config_path: core.purgeConfigPath(dshHome),
      plugin_root: runtime.PLUGIN_ROOT,
      patch_yml: identity.path,
      identity: { ok: identity.ok, mode: identity.mode, error: identity.error, mode_known: identity.mode_known },
      identity_modes: runtime.IDENTITY_MODES,
      note: "enabled / verbose 立刻生效；autoApplyOnStart 下次启动生效；身份层改的是插件自己的 cordis.patch.yml，要重启 dsh",
    };
  };

  webServer.register({
    kind: "exact",
    path: "/dsh-purge/config",
    handler: async (request, response) => {
      if (methodNotAllowed(request, response, ["GET", "POST"])) return;
      try {
        if (request.method === "GET") {
          sendJson(response, 200, await configPayload());
          return;
        }
        const body = await readJsonBody(request);
        const patch = runtime.normalizeRuntimePatch(body);
        const saved = await core.writePurgeConfig(dshHome, patch);
        // cfg 是活对象：systemPrompt 段和 identity hook 每轮现读它，所以立刻生效。
        Object.assign(cfg, patch);
        Object.assign(persisted, patch);
        log(cfg, "runtime config changed:", JSON.stringify(patch));
        sendJson(response, 200, await configPayload());
      } catch (e) {
        sendJson(response, 400, { ok: false, error: String(e.message || e) });
      }
    },
  }, "dsh-purge: runtime config");

  webServer.register({
    kind: "exact",
    path: "/dsh-purge/identity",
    handler: async (request, response) => {
      if (methodNotAllowed(request, response, ["POST"])) return;
      try {
        const body = await readJsonBody(request);
        const mode = typeof body?.mode === "string" ? body.mode : "";
        if (!runtime.validIdentityMode(mode)) {
          sendJson(response, 400, { ok: false, error: `mode 只能是 ${runtime.IDENTITY_MODES.join(" / ")}` });
          return;
        }
        // dshHome 必须传：切走破甲身份时要把那段 persona 缓存进 dsh-purge.json，
        // 否则「官方身份 → 破甲身份」切回来会把你手改过的 persona 换成出厂默认。
        const written = await runtime.writeIdentityLayer(mode, { dshHome: core.findDshHome() });
        sendJson(response, 200, {
          ok: true,
          mode: written.mode,
          path: written.path,
          backup: written.backup,
          identity: runtime.readIdentityLayer(),
          note: "已改写插件的 cordis.patch.yml。重启 dsh 生效。",
        });
      } catch (e) {
        sendJson(response, 500, { ok: false, error: String(e.message || e) });
      }
    },
  }, "dsh-purge: identity layer");

  webServer.register({
    kind: "exact",
    path: "/dsh-purge/shim",
    handler: async (request, response) => {
      if (methodNotAllowed(request, response, ["POST"])) return;
      try {
        const body = await readJsonBody(request);
        if (typeof body?.enabled !== "boolean") {
          sendJson(response, 400, { ok: false, error: "enabled must be true/false" });
          return;
        }
        const result = body.enabled ? await core.patchAllShims() : await core.revertAllShims();
        const state = await core.gatherState(switches.disabledGroups);
        sendJson(response, 200, {
          ok: true,
          enabled: body.enabled,
          result,
          shim_cmd: state.shim_cmd,
          shim_ps1: state.shim_ps1,
          shim_bin: state.shim_bin,
          note: body.enabled
            ? "已把 dsh 启动器改成隐藏黑框版；下次启动 dsh 生效"
            : "已还原启动器；下次启动 dsh 会闪一下黑框",
        });
      } catch (e) {
        sendJson(response, 500, { ok: false, error: String(e.message || e) });
      }
    },
  }, "dsh-purge: shim toggle");
}

function installRulesHttp(webServer) {
  const dshHome = core.findDshHome();

  webServer.register({
    kind: "exact",
    path: "/dsh-purge/rules/status",
    handler: async (request, response) => {
      if (methodNotAllowed(request, response, ["GET"])) return;
      try {
        sendJson(response, 200, { ok: true, ...(await rules.rulesStatus(dshHome)) });
      } catch (e) {
        sendJson(response, 500, { ok: false, error: String(e) });
      }
    },
  }, "dsh-purge: rules status");

  webServer.register({
    kind: "exact",
    path: "/dsh-purge/rules/read",
    handler: async (request, response) => {
      if (methodNotAllowed(request, response, ["GET"])) return;
      try {
        const url = new URL(request.url ?? "", "http://localhost");
        const id = url.searchParams.get("id") ?? "";
        if (!rules.validRuleId(id)) {
          sendJson(response, 400, { ok: false, error: "invalid id" });
          return;
        }
        const content = await rules.readRule(dshHome, id);
        if (content === null) {
          sendJson(response, 404, { ok: false, error: `rule not found: ${id}` });
          return;
        }
        const meta = await rules.readRuleMeta(dshHome, id);
        sendJson(response, 200, { ok: true, id, name: meta.name, target: meta.target, content });
      } catch (e) {
        sendJson(response, 500, { ok: false, error: String(e) });
      }
    },
  }, "dsh-purge: rules read");

  webServer.register({
    kind: "exact",
    path: "/dsh-purge/rules/save",
    handler: async (request, response) => {
      if (methodNotAllowed(request, response, ["POST"])) return;
      try {
        const body = await readJsonBody(request);
        const id = typeof body?.id === "string" ? body.id : "";
        const content = typeof body?.content === "string" ? body.content : null;
        if (!rules.validRuleId(id) || content === null) {
          sendJson(response, 400, { ok: false, error: "id and content (string) required" });
          return;
        }
        await rules.saveRule(dshHome, id, content, {
          name: typeof body?.name === "string" ? body.name : undefined,
          target: typeof body?.target === "string" ? body.target : undefined,
        });
        sendJson(response, 200, { ok: true, id });
      } catch (e) {
        sendJson(response, 500, { ok: false, error: String(e) });
      }
    },
  }, "dsh-purge: rules save");

  webServer.register({
    kind: "exact",
    path: "/dsh-purge/rules/activate",
    handler: async (request, response) => {
      if (methodNotAllowed(request, response, ["POST"])) return;
      try {
        const body = await readJsonBody(request);
        const id = typeof body?.id === "string" ? body.id : "";
        if (!rules.validRuleId(id)) {
          sendJson(response, 400, { ok: false, error: "invalid id" });
          return;
        }
        const meta = await rules.activateRule(dshHome, id);
        sendJson(response, 200, {
          ok: true,
          id,
          name: meta.name,
          target: meta.target,
          agents_path: rules.targetPath(dshHome, meta.target),
          note: "已写入目标文件并注入 systemPrompt，新会话生效",
        });
      } catch (e) {
        sendJson(response, 500, { ok: false, error: String(e) });
      }
    },
  }, "dsh-purge: rules activate");

  webServer.register({
    kind: "exact",
    path: "/dsh-purge/rules/delete",
    handler: async (request, response) => {
      if (methodNotAllowed(request, response, ["POST"])) return;
      try {
        const body = await readJsonBody(request);
        const id = typeof body?.id === "string" ? body.id : "";
        if (!rules.validRuleId(id)) {
          sendJson(response, 400, { ok: false, error: "invalid id" });
          return;
        }
        await rules.deleteRule(dshHome, id);
        sendJson(response, 200, { ok: true, id });
      } catch (e) {
        sendJson(response, 500, { ok: false, error: String(e) });
      }
    },
  }, "dsh-purge: rules delete");

  webServer.register({
    kind: "exact",
    path: "/dsh-purge/rules/reset",
    handler: async (request, response) => {
      if (methodNotAllowed(request, response, ["POST"])) return;
      try {
        const r = await rules.resetToOriginal(dshHome);
        sendJson(response, 200, { ok: true, ...r, note: "已还原出厂状态（无全局指令）；规则库保留" });
      } catch (e) {
        sendJson(response, 500, { ok: false, error: String(e) });
      }
    },
  }, "dsh-purge: rules reset");
}

function installPromptsHttp(webServer) {
  const dshHome = core.findDshHome();

  webServer.register({
    kind: "exact",
    path: "/dsh-purge/prompts/status",
    handler: async (request, response) => {
      if (methodNotAllowed(request, response, ["GET"])) return;
      try {
        sendJson(response, 200, { ok: true, ...(await prompts.promptsStatus(dshHome)) });
      } catch (e) {
        sendJson(response, 500, { ok: false, error: String(e) });
      }
    },
  }, "dsh-purge: prompts status");

  webServer.register({
    kind: "exact",
    path: "/dsh-purge/prompts/read",
    handler: async (request, response) => {
      if (methodNotAllowed(request, response, ["GET"])) return;
      try {
        const url = new URL(request.url ?? "", "http://localhost");
        const id = url.searchParams.get("id") ?? "";
        if (!prompts.validPromptId(id)) {
          sendJson(response, 400, { ok: false, error: "invalid id" });
          return;
        }
        const content = await prompts.readPrompt(dshHome, id);
        if (content === null) {
          sendJson(response, 404, { ok: false, error: `not found: ${id}` });
          return;
        }
        sendJson(response, 200, { ok: true, id, content });
      } catch (e) {
        sendJson(response, 500, { ok: false, error: String(e) });
      }
    },
  }, "dsh-purge: prompts read");

  webServer.register({
    kind: "exact",
    path: "/dsh-purge/prompts/use",
    handler: async (request, response) => {
      if (methodNotAllowed(request, response, ["POST"])) return;
      try {
        const body = await readJsonBody(request);
        const id = typeof body?.id === "string" ? body.id : "";
        if (!prompts.validPromptId(id)) {
          sendJson(response, 400, { ok: false, error: "invalid id" });
          return;
        }
        const r = await prompts.usePrompt(dshHome, id);
        sendJson(response, 200, { ok: true, id, flushed: r.flushed, note: "下一句话即生效，不用重启" });
      } catch (e) {
        sendJson(response, 500, { ok: false, error: String(e) });
      }
    },
  }, "dsh-purge: prompts use");

  webServer.register({
    kind: "exact",
    path: "/dsh-purge/prompts/save",
    handler: async (request, response) => {
      if (methodNotAllowed(request, response, ["POST"])) return;
      try {
        const body = await readJsonBody(request);
        const id = typeof body?.id === "string" ? body.id : "";
        if (!prompts.validPromptId(id)) {
          sendJson(response, 400, { ok: false, error: "invalid id" });
          return;
        }
        const r = await prompts.captureCurrent(dshHome, id);
        sendJson(response, 200, { ok: true, id, size: r.size, note: "已把当前 prompt-inject.md 存成一套" });
      } catch (e) {
        sendJson(response, 500, { ok: false, error: String(e) });
      }
    },
  }, "dsh-purge: prompts save");

  webServer.register({
    kind: "exact",
    path: "/dsh-purge/prompts/delete",
    handler: async (request, response) => {
      if (methodNotAllowed(request, response, ["POST"])) return;
      try {
        const body = await readJsonBody(request);
        const id = typeof body?.id === "string" ? body.id : "";
        if (!prompts.validPromptId(id)) {
          sendJson(response, 400, { ok: false, error: "invalid id" });
          return;
        }
        await prompts.deletePrompt(dshHome, id);
        sendJson(response, 200, { ok: true, id });
      } catch (e) {
        sendJson(response, 500, { ok: false, error: String(e) });
      }
    },
  }, "dsh-purge: prompts delete");

  webServer.register({
    kind: "exact",
    path: "/dsh-purge/prompts/off",
    handler: async (request, response) => {
      if (methodNotAllowed(request, response, ["POST"])) return;
      try {
        const r = await prompts.detachPrompt(dshHome);
        sendJson(response, 200, { ok: true, flushed: r.flushed, note: "已清空 prompt-inject.md，下一句话即生效" });
      } catch (e) {
        sendJson(response, 500, { ok: false, error: String(e) });
      }
    },
  }, "dsh-purge: prompts off");

  // 直接写某一套的正文（设置页的编辑器保存走这里，写的就是这一套，不是"把当前文件另存"）。
  webServer.register({
    kind: "exact",
    path: "/dsh-purge/prompts/write",
    handler: async (request, response) => {
      if (methodNotAllowed(request, response, ["POST"])) return;
      try {
        const body = await readJsonBody(request);
        const id = typeof body?.id === "string" ? body.id : "";
        const content = typeof body?.content === "string" ? body.content : null;
        if (!prompts.validPromptId(id) || content === null) {
          sendJson(response, 400, { ok: false, error: "id and content (string) required" });
          return;
        }
        await prompts.savePrompt(dshHome, id, content);
        const active = await prompts.readActive(dshHome);
        sendJson(response, 200, {
          ok: true,
          id,
          active: active === id,
          ...prompts.promptStats(content),
          note: active === id ? "已保存并同步到 prompt-inject.md，下一句话即生效" : "已保存",
        });
      } catch (e) {
        sendJson(response, 500, { ok: false, error: String(e) });
      }
    },
  }, "dsh-purge: prompts write");

  webServer.register({
    kind: "exact",
    path: "/dsh-purge/prompts/create",
    handler: async (request, response) => {
      if (methodNotAllowed(request, response, ["POST"])) return;
      try {
        const body = await readJsonBody(request);
        const id = typeof body?.id === "string" ? body.id : "";
        const content = typeof body?.content === "string" ? body.content : "";
        const r = await prompts.createPrompt(dshHome, id, content);
        sendJson(response, 200, { ok: true, ...r });
      } catch (e) {
        sendJson(response, 400, { ok: false, error: String(e.message || e) });
      }
    },
  }, "dsh-purge: prompts create");

  // 从文件导入：客户端把 .md 读成字符串发过来，和 create 是同一件事，只是语义更清楚。
  webServer.register({
    kind: "exact",
    path: "/dsh-purge/prompts/import",
    handler: async (request, response) => {
      if (methodNotAllowed(request, response, ["POST"])) return;
      try {
        const body = await readJsonBody(request);
        const id = typeof body?.id === "string" ? body.id : "";
        const content = typeof body?.content === "string" ? body.content : null;
        if (content === null) {
          sendJson(response, 400, { ok: false, error: "content (string) required" });
          return;
        }
        const overwrite = body?.overwrite === true;
        if (!overwrite) {
          const r = await prompts.createPrompt(dshHome, id, content);
          sendJson(response, 200, { ok: true, imported: true, overwritten: false, ...r });
          return;
        }
        await prompts.savePrompt(dshHome, id, content);
        sendJson(response, 200, { ok: true, imported: true, overwritten: true, id, ...prompts.promptStats(content) });
      } catch (e) {
        sendJson(response, 400, { ok: false, error: String(e.message || e) });
      }
    },
  }, "dsh-purge: prompts import");

  webServer.register({
    kind: "exact",
    path: "/dsh-purge/prompts/rename",
    handler: async (request, response) => {
      if (methodNotAllowed(request, response, ["POST"])) return;
      try {
        const body = await readJsonBody(request);
        const id = typeof body?.id === "string" ? body.id : "";
        const newId = typeof body?.newId === "string" ? body.newId : "";
        const r = await prompts.renamePrompt(dshHome, id, newId);
        sendJson(response, 200, { ok: true, ...r, note: r.was_active ? "当前激活的那套已改名，注入文件跟着走了" : "已改名" });
      } catch (e) {
        sendJson(response, 400, { ok: false, error: String(e.message || e) });
      }
    },
  }, "dsh-purge: prompts rename");

  webServer.register({
    kind: "exact",
    path: "/dsh-purge/prompts/duplicate",
    handler: async (request, response) => {
      if (methodNotAllowed(request, response, ["POST"])) return;
      try {
        const body = await readJsonBody(request);
        const id = typeof body?.id === "string" ? body.id : "";
        const newId = typeof body?.newId === "string" ? body.newId : "";
        const r = await prompts.copyPrompt(dshHome, id, newId);
        sendJson(response, 200, { ok: true, ...r, note: `已复制成 ${r.id}（还没切过去）` });
      } catch (e) {
        sendJson(response, 400, { ok: false, error: String(e.message || e) });
      }
    },
  }, "dsh-purge: prompts duplicate");
}

// ── 插件管理器（D1-D3）────────────────────────────────────────────

/**
 * 列表 / 文件树 / 改前改后。
 * 只暴露"插件管理器需要的东西"：插件自己的目录树（按名单解析，不接受任意路径），
 * 以及**有 .dshpurge.bak 兄弟文件**的那些文件的 diff —— 所以它不会变成通用文件浏览器。
 */
function installPluginsHttp(webServer, switches) {
  webServer.register({
    kind: "exact",
    path: "/dsh-purge/plugins",
    handler: async (request, response) => {
      if (methodNotAllowed(request, response, ["GET"])) return;
      try {
        const url = new URL(request.url ?? "", "http://localhost");
        const force = url.searchParams.get("force") === "1";
        const state = await core.gatherState(switches.disabledGroups);
        sendJson(response, 200, { ok: true, ...plugman.overview({ aiBase: state.ai_base, force }) });
      } catch (e) {
        sendJson(response, 500, { ok: false, error: String(e.message || e) });
      }
    },
  }, "dsh-purge: plugins overview");

  webServer.register({
    kind: "exact",
    path: "/dsh-purge/plugins/tree",
    handler: async (request, response) => {
      if (methodNotAllowed(request, response, ["GET"])) return;
      try {
        const url = new URL(request.url ?? "", "http://localhost");
        const name = url.searchParams.get("name") ?? "";
        const depth = Math.min(Math.max(Number(url.searchParams.get("depth")) || 3, 1), 6);
        const { plugins } = plugman.listPlugins();
        const hit = plugins.find((p) => p.name === name);
        if (!hit) {
          sendJson(response, 404, { ok: false, error: `没有这个插件: ${name}` });
          return;
        }
        if (hit.kind === "missing" || !hit.real_path) {
          sendJson(response, 404, { ok: false, error: `${name} 没找到本体目录` });
          return;
        }
        sendJson(response, 200, { ok: true, plugin: { name: hit.name, kind: hit.kind, path: hit.path, real_path: hit.real_path }, ...plugman.pluginTree(hit.real_path, { depth }) });
      } catch (e) {
        sendJson(response, 500, { ok: false, error: String(e.message || e) });
      }
    },
  }, "dsh-purge: plugin tree");

  webServer.register({
    kind: "exact",
    path: "/dsh-purge/plugins/diff",
    handler: async (request, response) => {
      if (methodNotAllowed(request, response, ["GET"])) return;
      try {
        const url = new URL(request.url ?? "", "http://localhost");
        const file = url.searchParams.get("path") ?? "";
        if (!file) {
          sendJson(response, 400, { ok: false, error: "path required" });
          return;
        }
        sendJson(response, 200, { ok: true, ...(await plugman.diffFile(file)) });
      } catch (e) {
        sendJson(response, 400, { ok: false, error: String(e.message || e) });
      }
    },
  }, "dsh-purge: plugin diff");
}

function sendJson(response, status, payload) {  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 512 * 1024) throw new Error("request body too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
