// dsh-purge client bundle: settings section follows Harness zh/en.
//
// 结构（B9 多标签重构，2026-09-18）：
//   概览      指标 + 非权限分组开关 + 全部补丁表 + 应用/还原/重启
//   提示词    prompt-inject.md 的多套管理（列表 + 编辑器，B4）
//   规则      AGENTS.md / CLAUDE.md 规则集
//   沙箱&门禁 沙箱/审批两个分组开关 + 文件纪律现状
//   插件      关键路径（D1-D3 文件树/卡片/CLI 还没做）
//   高级      运行时开关 enabled/autoApplyOnStart/verbose + shim + 身份层三选一（B3/B7）
//
// 标签页是"懒挂载 + 挂上就不卸"：没点开过的页不发请求，点开过的一直挂着，
// 这样切标签不会丢掉编辑器里没保存的内容。
window.__ModuleLoader__.load({ id: "dsh-purge", factory: (require) => {

		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		const h = react.createElement;
		const { useState, useEffect, useCallback, useMemo, useRef } = react;

		const name = "dsh-purge";
		const inject = ["slots", "locale"];
		const NS = "settings.dsh-purge";
		let translate = (key) => key;
		function useT() {
			return translate;
		}
		function apiUrl(p) {
			try { return new URL(p, window.location.origin).toString(); } catch { return p; }
		}
		async function apiJson(p, init) {
			const ctrl = new AbortController();
			const timer = setTimeout(() => ctrl.abort(), 12000);
			try {
				const r = await fetch(apiUrl(p), Object.assign({ cache: "no-store", credentials: "same-origin", signal: ctrl.signal }, init || {}));
				const text = await r.text();
				let data;
				try { data = text ? JSON.parse(text) : null; } catch {
					throw new Error(r.status + " non-json: " + text.slice(0, 120));
				}
				if (!r.ok) throw new Error((data && (data.error || data.message)) || (r.status + " " + r.statusText));
				return data;
			} finally { clearTimeout(timer); }
		}
		function apiPost(p, payload) {
			return apiJson(p, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload || {}),
			});
		}

		const TARGETS = ["AGENTS.md", "CLAUDE.md"];
		const TAB_KEY = "dshp-tab";
		const TABS = [
			{ id: "overview", label: "tab.overview" },
			{ id: "prompts", label: "tab.prompts" },
			{ id: "rules", label: "tab.rules" },
			{ id: "sandbox", label: "tab.sandbox" },
			{ id: "plugins", label: "tab.plugins" },
			{ id: "advanced", label: "tab.advanced" },
		];
		// 编辑器行高，必须和 CSS 里 .dshp-code textarea 的 line-height 一致（滚动定位靠它）。
		const CODE_LINE_H = 20;

		const zh = {
			nav: "破甲 · 沙箱",
			"theme.aria": "外观",
			"theme.white": "白",
			"theme.ink": "墨",
			"tab.overview": "概览",
			"tab.prompts": "提示词",
			"tab.rules": "规则",
			"tab.sandbox": "沙箱 & 门禁",
			"tab.plugins": "插件",
			"tab.advanced": "高级",
			"purge.title": "补丁",
			"metric.purged": "补丁",
			"metric.shim": "shim",
			"metric.bak.yes": "有备份",
			"metric.bak.no": "无备份",
			"metric.bak.hint": "备份",
			"table.patch": "项目",
			"table.status": "状态",
			"status.applied": "已应用",
			"status.pending": "待应用",
			"status.disabled": "已关闭",
			"skip": "跳过",
			"unknown": "未知",
			"delete": "删除",
			"btn.apply": "应用",
			"btn.apply.busy": "处理中…",
			"btn.revert": "还原",
			"action.apply": "应用",
			"action.revert": "还原",
			"ok.done": "已完成",
			"err.action": "失败: {error}",
			"err.status": "读取失败: {error}",
			"err.override": "读取失败: {error}",
			"err.rules": "读取失败: {error}",
			"err.read": "读取失败: {error}",
			"err.save": "保存失败: {error}",
			"err.config": "读取失败: {error}",
			"err.needRestart": "已保存，重启 dsh 生效",
			"btn.restart": "重启 dsh",
			"btn.restart.busy": "重启中…",
			"restarting": "重启中…",
			"restart.timeout": "超时，请刷新",
			"restart.fail": "失败: {error}",
			"restart.confirm": "清洗已完成，重启后生效。",
			"restart.incomplete": "清洗未完成：{detail}",
			"restart.incomplete.patches": "必需补丁失败 {failed} 项（#{ids}）",
			"restart.incomplete.flash": "CMD 无感未钉入（{entry}）",
			"restart.later": "以后",
			"group.prompt": "提示词",
			"group.sandbox": "沙箱",
			"group.approval": "审批",
			"group.tools": "工具上限",
			"group.compat": "0.1.5 兼容",
			"switch.title": "分组开关",
			"switch.hint": "改开关会自动「还原 → 重打」一遍，重启 dsh 生效",
			"switch.coupled": "沙箱与审批绑定，必须同开同关",
			"switch.locked": "不可关闭",
			"switch.desc.prompt": "身份 / 人设 / 拒绝话术的中性化改写",
			"switch.desc.sandbox": "文件与命令沙箱的检查、拦截、提权放宽",
			"switch.desc.approval": "弹窗询问与自动放行",
			"switch.desc.tools": "超时 / 读取上限 / 重复提醒 / 工具输出剪短",
			"switch.desc.compat": "预设与旧会话格式的兼容补丁",
			"switch.on": "开",
			"switch.off": "关",
			"switch.moved": "沙箱与审批这两个开关在「沙箱 & 门禁」页 —— 它们一动就连带权限，单独放一页。",
			"prompts.title": "破甲提示词套",
			"prompts.hint": "点一套名字就切过去；切换前会把当前改动存回原来那套。改完下一句话即生效，不用重启。",
			"prompts.search": "搜索名字或内容开头",
			"prompts.count": "{n} 套",
			"prompts.new": "新建空套",
			"prompts.copy": "复制",
			"prompts.rename": "改名",
			"prompts.export": "导出",
			"prompts.import": "导入 .md",
			"prompts.preview": "预览",
			"prompts.use": "启用",
			"prompts.inUse": "当前",
			"prompts.delete": "删除",
			"prompts.none": "还没有任何一套。用下面的「新建空套」，或把现有 prompt-inject.md 存成一套。",
			"prompts.noMatch": "没有匹配的套",
			"prompts.unsaved": "改动未保存",
			"prompts.saved": "已保存",
			"prompts.dirty.confirm": "「{id}」有未保存的改动。先保存再继续？（点「取消」会再问一次要不要丢弃）",
			"prompts.dirty.drop": "不保存，直接丢弃这些改动？",
			"prompts.confirmDelete": "删除「{id}」？",
			"prompts.confirmDelete.active": "它正在生效 —— 删掉后 prompt-inject.md 也会被清空（等于关掉破甲）。",
			"prompts.deleted": "已删除「{id}」",
			"prompts.nameLabel": "新套的名字（字母数字开头，可含 . _ -）",
			"prompts.copyLabel": "复制成…",
			"prompts.renameLabel": "改名成…",
			"prompts.importLabel": "导入为…",
			"prompts.pathLabel": "存哪",
			"prompts.needName": "先填个名字",
			"prompts.imported": "已导入「{id}」",
			"prompts.exported": "已导出「{id}」",
			"prompts.turnOff": "关掉破甲",
			"prompts.attached": "注入中",
			"prompts.detached": "未注入（prompt-inject.md 空着）",
			"prompts.unsynced": "prompt-inject.md 和当前那套不一致（有手改没存回去）",
			"prompts.totalTokens": "合计约 {n} tok",
			"prompts.stats": "{size} · 约 {tok} tok · {lines} 行",
			"ed.title": "编辑「{id}」",
			"ed.find": "查找",
			"ed.next": "下一个",
			"ed.prev": "上一个",
			"ed.noMatch": "没找到",
			"ed.matches": "{n} 处",
			"ed.save": "保存",
			"ed.discard": "放弃改动",
			"ed.dirty": "有未保存的改动",
			"ed.clean": "和磁盘上一致",
			"ed.discard.confirm": "放弃「{id}」里未保存的改动？",
			"ed.saved": "已保存「{id}」",
			"ed.pick": "点左边一套开始编辑；或新建一套。",
			"ed.meta": "{size} · 约 {tok} tok · {lines} 行",
			"rules.title": "规则集",
			"rules.hint": "规则集写进 dsh 的全局指令文件（AGENTS.md / CLAUDE.md），由 dsh 官方读给每个会话 —— 和「提示词」页那套 persona 注入是两条路。",
			"rules.empty": "暂无规则",
			"rules.pick": "选择规则",
			"rules.none": "无",
			"rules.reset": "还原",
			"rules.reset.confirm": "还原全局指令文件？规则库会保留。",
			"pill.current": "当前",
			"btn.use": "启用",
			"btn.inUse": "当前",
			"confirm.delete": "删除 {id}？",
			"ph.id": "id",
			"ph.alias": "名称",
			"ph.alias.short": "名称",
			"btn.create": "新建",
			"need.id": "需要 id",
			"btn.saveRule": "保存",
			"sandbox.title": "沙箱 & 审批",
			"sandbox.desc": "这两个组是权限相关的：沙箱管「文件与命令的检查/拦截」，审批管「弹窗询问与自动放行」。dsh 会校验这两个默认值的组合（只有 workspace-write+ask 和 danger-full-access+never 两套合法），所以它们必须同开同关。",
			"sandbox.warn": "关掉 = 拆掉沙箱与审批门（这是本插件的主要目的之一）；打开 = 官方原样。",
			"gate.title": "文件门禁（全局指令）",
			"gate.desc": "C4 的 hook 硬闸（临时产物写到 D:\\temp 以外就拦下）用户明确说不做，所以这里只有「全局指令怎么交付」的现状。",
			"gate.rules": "规则交付",
			"gate.target": "目标文件",
			"gate.state": "状态",
			"gate.yes": "已写入",
			"gate.no": "未写入（等于没有全局指令）",
			"gate.skipped": "文件内容与规则不一致，没动它",
			"gate.pending": "hook 硬闸：未做（C4）",
			"gate.where": "规则内容存在",
			"sandbox.patches": "这两个组管哪些补丁",
			"plugins.title": "插件管理器",
			"plugins.hint": "点一行看它的卡片：本体在哪、它自己的文件树、它改了 dsh 的哪些文件（每个文件可以看改前/改后）。「改了」靠的是插件留在被改文件旁边的 .dshpurge.bak 标记 —— 没留标记的插件显示「无改动记录」是正确答案，不是出错。",
			"plugins.list": "装了哪些",
			"plugins.profile": "profile: {name}",
			"plugins.rescan": "重新扫描",
			"plugins.scanning": "扫描中…",
			"plugins.scanMeta": "实扫 {files} 个被改文件 · {pkgs} 个包 · 走了 {dirs} 个目录",
			"plugins.truncated": "扫描被截断（结果可能不全）",
			"plugins.kind": "安装方式",
			"plugins.kind.official": "dsh 官方",
			"plugins.kind.junction": "junction",
			"plugins.kind.npm": "npm",
			"plugins.kind.missing": "缺失",
			"plugins.depOnly": "只是依赖",
			"plugins.changedBy": "它改了 {n} 个文件",
			"plugins.changedByShort": "它改了 {n} 个",
			"plugins.changedIn": "内含 {n} 个被改文件",
			"plugins.changedInShort": "内含 {n} 个",
			"plugins.noChanges": "无改动记录",
			"plugins.noChangesShort": "无改动",
			"plugins.noChangesHint": "这个插件没有在 dsh 代码树里留过改动标记（它可能只用配置文件，或者根本不改官方文件）。",
			"plugins.files": "{n} 个文件",
			"plugins.copyPath": "复制真实路径",
			"plugins.card.location": "本体位置",
			"plugins.card.realPath": "真实路径",
			"plugins.card.version": "版本",
			"plugins.card.target": "dshTarget",
			"plugins.card.client": "带前端",
			"plugins.card.bundle": "bundle 补丁",
			"plugins.card.desc": "说明",
			"plugins.card.tree": "它自己的文件树",
			"plugins.card.treeMeta": "{n} 个节点",
			"plugins.card.treeHint": "不展开 node_modules（有的插件几百 MB）；深度 3 层。",
			"plugins.card.changed": "它改了哪些",
			"plugins.treeCollapsed": "(node_modules {n} 项，不展开)",
			"plugins.treeMissing": "没取到文件树（插件本体目录可能不在）。",
			"plugins.changed.title": "dsh 代码树里被改的文件",
			"plugins.changed.summary": "实扫到 {files} 个被改文件，分布在 {pkgs} 个包；留标记的是「{owner}」。",
			"plugins.changed.none": "没有扫到任何改动标记（补丁可能还没打过）。",
			"plugins.self.title": "自报 vs 实扫",
			"plugins.self.reported": "自报",
			"plugins.self.reportedValue": "{patches} 条补丁 → {files} 个目标文件",
			"plugins.self.scanned": "实扫",
			"plugins.self.scannedValue": "{n} 个标记文件",
			"plugins.self.onlyReported": "自报有、实扫没有",
			"plugins.self.onlyScanned": "实扫有、自报没有",
			"plugins.self.none": "无",
			"plugins.self.onlyScannedHint": "这些文件被改过、但不在补丁表里声明（属于未声明的改动）：",
			"plugins.diff": "看 diff",
			"plugins.diff.title": "改前 / 改后",
			"plugins.diff.identical": "两边内容一致（改动已被还原，或者补丁没生效）。",
			"plugins.diff.stats": "{before} → {after} · +{add} / -{del} 行",
			"plugins.root": "插件本体",
			"plugins.home": "DSH_HOME",
			"plugins.config": "开关配置",
			"plugins.inject": "注入文件",
			"plugins.promptsDir": "提示词套目录",
			"plugins.rulesDir": "规则集目录",
			"plugins.yml": "身份层配置",
			"yes": "是",
			"no": "否",
			"adv.config": "运行时开关",
			"adv.config.hint": "enabled 和 verbose 立刻生效；autoApplyOnStart 下次启动 dsh 才生效。都存在 {path}。",
			"adv.enabled": "总开关（软）",
			"adv.enabled.desc": "关掉后不再注入 prompt-inject.md、启动时不再自动重打补丁。已经打进文件里的补丁不会自己退回 —— 要退回请去「概览」点还原。",
			"adv.enabled.hard": "想彻底不加载插件：改 cordis.patch.yml 里的 enabled: false（硬关；那时这个设置页也不会出现）。",
			"adv.autoApply": "开机自动重打",
			"adv.autoApply.desc": "dsh 启动时自动把补丁打回去，解决 npm 升级覆盖 node_modules 后要手动重跑的麻烦。",
			"adv.verbose": "详细日志",
			"adv.verbose.desc": "往 dsh 控制台多打过程日志（排错用）。",
			"adv.shim": "隐藏黑框",
			"adv.shim.desc": "把 dsh 启动器换成不带控制台窗口的版本（dsh.cmd / dsh.ps1 / dsh）。还原后下次启动会闪一下黑框。",
			"adv.shim.on": "已隐藏",
			"adv.shim.off": "未隐藏",
			"adv.shim.cmdNote": "dsh.cmd 插件刻意不注入 —— .cmd 由 cmd.exe 起、必定闪窗，注入了也没用，所以它一直是 original，不是故障。判断是否隐藏看 ps1 / unix 两个。",
			"adv.shim.enable": "改成隐藏",
			"adv.shim.disable": "还原启动器",
			"adv.identity": "身份层",
			"adv.identity.hint": "改的是插件自己的 cordis.patch.yml，重启 dsh 生效。",
			"adv.identity.purge": "破甲身份",
			"adv.identity.official": "官方原版身份",
			"adv.identity.none": "无身份",
			"adv.identity.desc.purge": "剥掉官方「你是编程助手」的身份，persona 用破甲话术；正文由 prompt-inject.md 提供。",
			"adv.identity.desc.official": "官方身份照原样。想彻底回官方，再回「概览」把「提示词」组关掉并点一次应用。",
			"adv.identity.desc.none": "官方身份也剥掉、也不给替代 persona —— 身份完全由 prompt-inject.md 决定。",
			"adv.identity.current": "当前：{mode}",
			"adv.identity.confirm": "改成「{mode}」并改写 cordis.patch.yml？重启 dsh 后生效。",
			"adv.identity.done": "已改成「{mode}」，重启 dsh 生效",
			"adv.paths": "关键路径",
			"adv.source.yml": "来自 cordis.patch.yml",
			"adv.source.saved": "在设置页改过",
			"adv.saved": "已保存",
			"btn.close": "关闭",
			"btn.cancel": "取消",
			"btn.ok": "确定",
			"btn.save": "保存",
			"patch.1": "全局免责 → 强指令",
			"patch.2": "替换式免责 → 强指令",
			"patch.3": "作用域免责 → 强指令",
			"patch.4": "persona 会话强指令",
			"patch.5": "审批提示句 → 全权限",
			"patch.6": "沙箱 deny → allow 写",
			"patch.7": "沙箱默认全权限",
			"patch.8": "审批默认 never",
			"patch.9": "审批门自动放行",
			"patch.10": "审批配置默认 never",
			"patch.11": "never 提示句 → 自动放行",
			"patch.12": "ask 提示句 → 自动放行",
			"patch.13": "豁免升级阶梯",
			"patch.14": "升级无条件授信",
			"patch.15": "沙箱 confine 直通",
			"patch.16": "文件系统围栏取消",
			"patch.17": "观察策略读写放行",
			"patch.18": "重复调用守卫禁用",
			"patch.19": "工具结果修剪禁用",
			"patch.20": "dsh-web-fetch-http：启用 fetch + provider",
			"patch.21": "dsh-web-fetch-http：base 写入依赖",
			"patch.22": "bash 超时 60s → 10min",
			"patch.23": "read 上限放宽",
			"patch.24": "子代理深度 3 → 10",
			"patch.25": "preset fetch 启用",
			"patch.26": "Harness 身份剥离",
			"patch.27": "minimal 人设清洗",
			"patch.28": "dsh-liangshen（梁神）：人设拒绝锁→可执行",
			"patch.29": "dsh-liangshen（梁神）：phase-1 保留注入段",
			"patch.30": "dsh-tool-web：外部 untrusted 拦截→可执行",
			"patch.31": "dsh-hooks-claude-code：deny→allow",
			"patch.32": "dsh-hooks-codex：deny→allow",
			"patch.33": "Web 表面身份中性化",
			"patch.34": "Shell 拒绝提示 → 可执行",
			"patch.35": "沙箱提示中性化",
			"patch.36": "升级 never 不拒",
			"patch.37": "文件系统升级 schema 放行",
			"patch.38": "子代理 scope lock 中性化",
			"patch.39": "persona text→prefix（0.1.2 预设）",
			"patch.40": "会话 v0 plugin summary（mnemon）",
		};

		const en = {
			nav: "Purge · Sandbox",
			"theme.aria": "Appearance",
			"theme.white": "Light",
			"theme.ink": "Ink",
			"tab.overview": "Overview",
			"tab.prompts": "Prompts",
			"tab.rules": "Rules",
			"tab.sandbox": "Sandbox",
			"tab.plugins": "Plugins",
			"tab.advanced": "Advanced",
			"purge.title": "Patches",
			"metric.purged": "Patches",
			"metric.shim": "shim",
			"metric.bak.yes": "Backup",
			"metric.bak.no": "No backup",
			"metric.bak.hint": "Backup",
			"table.patch": "Item",
			"table.status": "Status",
			"status.applied": "Applied",
			"status.pending": "Pending",
			"status.disabled": "Disabled",
			"skip": "Skipped",
			"unknown": "Unknown",
			"delete": "Delete",
			"btn.apply": "Apply",
			"btn.apply.busy": "Working…",
			"btn.revert": "Restore",
			"action.apply": "Apply",
			"action.revert": "Restore",
			"ok.done": "Done",
			"err.action": "Failed: {error}",
			"err.status": "Read failed: {error}",
			"err.override": "Read failed: {error}",
			"err.rules": "Read failed: {error}",
			"err.read": "Read failed: {error}",
			"err.save": "Save failed: {error}",
			"err.config": "Read failed: {error}",
			"err.needRestart": "Saved. Restart dsh to take effect.",
			"btn.restart": "Restart",
			"btn.restart.busy": "Restarting…",
			"restarting": "Restarting…",
			"restart.timeout": "Timed out; refresh",
			"restart.fail": "Failed: {error}",
			"restart.confirm": "Apply finished. Restart to take effect.",
			"restart.incomplete": "Apply incomplete: {detail}",
			"restart.incomplete.patches": "{failed} required patch(es) failed (#{ids})",
			"restart.incomplete.flash": "CMD silence not pinned ({entry})",
			"restart.later": "Later",
			"group.prompt": "Prompt",
			"group.sandbox": "Sandbox",
			"group.approval": "Approval",
			"group.tools": "Tools",
			"group.compat": "0.1.5 compat",
			"switch.title": "Group switches",
			"switch.hint": "Toggling rewrites the target files (revert then re-apply). Restart dsh to take effect.",
			"switch.coupled": "Sandbox and approval are coupled and toggle together",
			"switch.locked": "always on",
			"switch.desc.prompt": "Identity / persona / refusal wording neutralized",
			"switch.desc.sandbox": "Sandbox checks, denials and escalation widening",
			"switch.desc.approval": "Approval prompts and auto-grant",
			"switch.desc.tools": "Timeouts / read caps / repeat reminder / tool-result pruning",
			"switch.desc.compat": "Preset and legacy session-format compatibility",
			"switch.on": "On",
			"switch.off": "Off",
			"switch.moved": "The sandbox and approval switches live on the Sandbox tab — they move file permissions together.",
			"prompts.title": "Prompt sets",
			"prompts.hint": "Click a name to switch. Uncommitted edits are stored back to the set you are leaving first. Takes effect on the next message — no restart needed.",
			"prompts.search": "Filter by name or first line",
			"prompts.count": "{n} sets",
			"prompts.new": "New empty set",
			"prompts.copy": "Copy",
			"prompts.rename": "Rename",
			"prompts.export": "Export",
			"prompts.import": "Import .md",
			"prompts.preview": "Preview",
			"prompts.use": "Enable",
			"prompts.inUse": "On",
			"prompts.delete": "Delete",
			"prompts.none": "No sets yet. Create an empty one, or save the current prompt-inject.md as a set.",
			"prompts.noMatch": "No matching set",
			"prompts.unsaved": "Unsaved edits",
			"prompts.saved": "Saved",
			"prompts.dirty.confirm": "\"{id}\" has unsaved edits. Save them and continue? (Cancel asks whether to discard.)",
			"prompts.dirty.drop": "Discard those edits without saving?",
			"prompts.confirmDelete": "Delete \"{id}\"?",
			"prompts.confirmDelete.active": "It is the active set — prompt-inject.md will be emptied too (that turns purge off).",
			"prompts.deleted": "Deleted \"{id}\"",
			"prompts.nameLabel": "New set name (start with a letter/digit, may contain . _ -)",
			"prompts.copyLabel": "Copy as…",
			"prompts.renameLabel": "Rename to…",
			"prompts.importLabel": "Import as…",
			"prompts.pathLabel": "Stored in",
			"prompts.needName": "Enter a name first",
			"prompts.imported": "Imported \"{id}\"",
			"prompts.exported": "Exported \"{id}\"",
			"prompts.turnOff": "Turn off",
			"prompts.attached": "Injecting",
			"prompts.detached": "Not injecting (prompt-inject.md is empty)",
			"prompts.unsynced": "prompt-inject.md differs from the active set (hand edits not saved back)",
			"prompts.totalTokens": "~{n} tok total",
			"prompts.stats": "{size} · ~{tok} tok · {lines} lines",
			"ed.title": "Editing \"{id}\"",
			"ed.find": "Find",
			"ed.next": "Next",
			"ed.prev": "Previous",
			"ed.noMatch": "No match",
			"ed.matches": "{n} hits",
			"ed.save": "Save",
			"ed.discard": "Discard",
			"ed.dirty": "Unsaved edits",
			"ed.clean": "Matches disk",
			"ed.discard.confirm": "Discard unsaved edits in \"{id}\"?",
			"ed.saved": "Saved \"{id}\"",
			"ed.pick": "Pick a set on the left to edit, or create one.",
			"ed.meta": "{size} · ~{tok} tok · {lines} lines",
			"rules.title": "Rule sets",
			"rules.hint": "Rule sets are written into dsh's global instruction files (AGENTS.md / CLAUDE.md) and read by dsh itself for every session — a different path from the persona injection on the Prompts tab.",
			"rules.empty": "No rules",
			"rules.pick": "Select a rule",
			"rules.none": "None",
			"rules.reset": "Restore",
			"rules.reset.confirm": "Restore global instruction files? The rule library is kept.",
			"pill.current": "On",
			"btn.use": "Enable",
			"btn.inUse": "On",
			"confirm.delete": "Delete {id}?",
			"ph.id": "id",
			"ph.alias": "Name",
			"ph.alias.short": "Name",
			"btn.create": "New",
			"need.id": "id required",
			"btn.saveRule": "Save",
			"sandbox.title": "Sandbox & approval",
			"sandbox.desc": "These two groups are the permission layer: sandbox covers file/command checks and denials, approval cover the ask prompts and auto-granting. dsh validates the pair (only workspace-write+ask and danger-full-access+never are legal), so they must be toggled together.",
			"sandbox.warn": "Off = the sandbox and approval gate are removed (one of this plugin's main purposes); on = shipped behaviour.",
			"gate.title": "File gate (global instructions)",
			"gate.desc": "The C4 hook gate (blocking temp artifacts written outside D:\\temp) was explicitly declined, so this is only the current state of how global instructions are delivered.",
			"gate.rules": "Rule delivery",
			"gate.target": "Target file",
			"gate.state": "State",
			"gate.yes": "written",
			"gate.no": "not written (no global instructions)",
			"gate.skipped": "content differed from the rule; left alone",
			"gate.pending": "Hook gate: not built (C4)",
			"gate.where": "Rule content in",
			"sandbox.patches": "Patches in these groups",
			"plugins.title": "Plugin manager",
			"plugins.hint": "Click a row for its card: where the plugin lives, its own file tree, and which files of dsh it changed (each with a before/after diff). \"Changed\" comes from the .dshpurge.bak markers a plugin leaves next to each file it patches — \"no change record\" for a plugin that leaves none is the correct answer, not an error.",
			"plugins.list": "Installed",
			"plugins.profile": "profile: {name}",
			"plugins.rescan": "Rescan",
			"plugins.scanning": "Scanning…",
			"plugins.scanMeta": "{files} changed files · {pkgs} packages · {dirs} dirs walked",
			"plugins.truncated": "scan truncated (results may be incomplete)",
			"plugins.kind": "Install",
			"plugins.kind.official": "dsh official",
			"plugins.kind.junction": "junction",
			"plugins.kind.npm": "npm",
			"plugins.kind.missing": "missing",
			"plugins.depOnly": "dependency only",
			"plugins.changedBy": "changed {n} files",
			"plugins.changedByShort": "changed {n}",
			"plugins.changedIn": "contains {n} changed files",
			"plugins.changedInShort": "contains {n}",
			"plugins.noChanges": "no change record",
			"plugins.noChangesShort": "no change",
			"plugins.noChangesHint": "This plugin never left a change marker in the dsh tree (it may only use config, or not touch official files at all).",
			"plugins.files": "{n} files",
			"plugins.copyPath": "Copy real path",
			"plugins.card.location": "Location",
			"plugins.card.realPath": "Real path",
			"plugins.card.version": "Version",
			"plugins.card.target": "dshTarget",
			"plugins.card.client": "Client half",
			"plugins.card.bundle": "Bundle patch",
			"plugins.card.desc": "Description",
			"plugins.card.tree": "Its own file tree",
			"plugins.card.treeMeta": "{n} entries",
			"plugins.card.treeHint": "node_modules is not expanded (some plugins are hundreds of MB); depth 3.",
			"plugins.card.changed": "What it changed",
			"plugins.treeCollapsed": "(node_modules: {n} entries, not expanded)",
			"plugins.treeMissing": "No tree (the plugin root may be missing).",
			"plugins.changed.title": "Files changed inside the dsh tree",
			"plugins.changed.summary": "{files} changed files in {pkgs} packages; the markers were left by \"{owner}\".",
			"plugins.changed.none": "No change markers found (the patches may not be applied).",
			"plugins.self.title": "Self-reported vs scanned",
			"plugins.self.reported": "Self-reported",
			"plugins.self.reportedValue": "{patches} patches → {files} target files",
			"plugins.self.scanned": "Scanned",
			"plugins.self.scannedValue": "{n} marker files",
			"plugins.self.onlyReported": "Reported but not scanned",
			"plugins.self.onlyScanned": "Scanned but not reported",
			"plugins.self.none": "none",
			"plugins.self.onlyScannedHint": "These files were changed but are not declared in the patch table (undeclared changes):",
			"plugins.diff": "Diff",
			"plugins.diff.title": "Before / after",
			"plugins.diff.identical": "Both sides are identical (the change was reverted, or the patch never took effect).",
			"plugins.diff.stats": "{before} → {after} · +{add} / -{del} lines",
			"plugins.root": "Plugin root",
			"plugins.home": "DSH_HOME",
			"plugins.config": "Switch config",
			"plugins.inject": "Inject file",
			"plugins.promptsDir": "Prompt sets dir",
			"plugins.rulesDir": "Rule sets dir",
			"plugins.yml": "Identity layer file",
			"yes": "yes",
			"no": "no",
			"adv.config": "Runtime switches",
			"adv.config.hint": "enabled and verbose apply immediately; autoApplyOnStart applies on the next dsh start. All stored in {path}.",
			"adv.enabled": "Master switch (soft)",
			"adv.enabled.desc": "When off: prompt-inject.md is not injected and patches are not re-applied on start. Patches already written into files stay — use Restore on the Overview tab to undo them.",
			"adv.enabled.hard": "To unload the plugin entirely, set enabled: false in cordis.patch.yml (hard off; this settings page disappears with it).",
			"adv.autoApply": "Auto re-apply on start",
			"adv.autoApply.desc": "Re-applies the patches when dsh starts, so an npm upgrade that overwrites node_modules does not need a manual re-run.",
			"adv.verbose": "Verbose log",
			"adv.verbose.desc": "Print more progress lines to the dsh console (for troubleshooting).",
			"adv.shim": "Hide console window",
			"adv.shim.desc": "Swaps the dsh launchers (dsh.cmd / dsh.ps1 / dsh) for versions without a console window. After restoring, the next start flashes a console window.",
			"adv.shim.on": "hidden",
			"adv.shim.off": "not hidden",
			"adv.shim.cmdNote": "dsh.cmd is deliberately never injected: a .cmd host spawn always flashes a console, so it stays original — not a fault. Hidden state is judged by ps1 / unix.",
			"adv.shim.enable": "Hide window",
			"adv.shim.disable": "Restore launchers",
			"adv.identity": "Identity layer",
			"adv.identity.hint": "Rewrites the plugin's own cordis.patch.yml; restart dsh to take effect.",
			"adv.identity.purge": "Purge identity",
			"adv.identity.official": "Official identity",
			"adv.identity.none": "No identity",
			"adv.identity.desc.purge": "Strips the official \"you are a coding agent\" identity and uses the purge persona; the body comes from prompt-inject.md.",
			"adv.identity.desc.official": "Official identity as shipped. For a full return, switch the Prompt group off on the Overview tab and apply once.",
			"adv.identity.desc.none": "Official identity stripped and no replacement persona — identity is whatever prompt-inject.md says.",
			"adv.identity.current": "Current: {mode}",
			"adv.identity.confirm": "Switch to \"{mode}\" and rewrite cordis.patch.yml? Takes effect after restarting dsh.",
			"adv.identity.done": "Switched to \"{mode}\". Restart dsh to take effect.",
			"adv.paths": "Key paths",
			"adv.source.yml": "from cordis.patch.yml",
			"adv.source.saved": "changed in settings",
			"adv.saved": "Saved",
			"btn.close": "Close",
			"btn.cancel": "Cancel",
			"btn.ok": "OK",
			"btn.save": "Save",
			"patch.1": "Global disclaimer → mandate",
			"patch.2": "Replacement disclaimer → mandate",
			"patch.3": "Scope disclaimer → mandate",
			"patch.4": "Persona session mandate",
			"patch.5": "Approval copy → full access",
			"patch.6": "Sandbox deny → allow write",
			"patch.7": "Sandbox default full access",
			"patch.8": "Approval default never",
			"patch.9": "Approval gate auto-grant",
			"patch.10": "Approval config default never",
			"patch.11": "never copy → auto-grant",
			"patch.12": "ask copy → auto-grant",
			"patch.13": "Escalation ladder exempt",
			"patch.14": "Escalation unconditional grant",
			"patch.15": "Sandbox confine passthrough",
			"patch.16": "Filesystem fence off",
			"patch.17": "Observation policy allow R/W",
			"patch.18": "Repeat-call guard off",
			"patch.19": "Tool-result pruner off",
			"patch.20": "dsh-web-fetch-http: enable fetch + provider",
			"patch.21": "dsh-web-fetch-http: pin base dependency",
			"patch.22": "bash timeout 60s → 10min",
			"patch.23": "read cap raised",
			"patch.24": "subagent depth 3 → 10",
			"patch.25": "preset fetch on",
			"patch.26": "Harness identity strip",
			"patch.27": "minimal persona purge",
			"patch.28": "dsh-liangshen: refusal lock → executable",
			"patch.29": "dsh-liangshen: keep inject in phase-1",
			"patch.30": "dsh-tool-web: untrusted framing → usable data",
			"patch.31": "dsh-hooks-claude-code: deny→allow",
			"patch.32": "dsh-hooks-codex: deny→allow",
			"patch.33": "Web surface identity neutral",
			"patch.34": "Shell denial prompt → executable",
			"patch.35": "Sandbox hint neutralized",
			"patch.36": "Escalation never-reject",
			"patch.37": "FS escalation schema opened",
			"patch.38": "Subagent scope lock neutralized",
			"patch.39": "persona text→prefix (0.1.2 presets)",
			"patch.40": "session v0 plugin summary (mnemon)",
		};

		const THEME_KEY = "dshp-theme";
		const THEME_MODE_KEY = "dshp-theme-mode"; // "manual" = user picked; else follow host
		const PURGE_CSS = `
.dshp-root{--dshp-display:"Songti SC","Noto Serif SC","Iowan Old Style",Palatino,"Palatino Linotype",Georgia,serif;--dshp-sans:"Yu Gothic UI","Hiragino Sans GB","Source Han Sans SC",system-ui,sans-serif;--dshp-mono:"Cascadia Mono","Sarasa Mono SC",ui-monospace,monospace;--dshp-ease:cubic-bezier(.16,1,.3,1);max-width:920px;display:flex;flex-direction:column;gap:16px;padding:16px;border-radius:12px;background:var(--dshp-bg);color:var(--dshp-ink);font-family:var(--dshp-sans)}
.dshp-root[data-theme="white"]{--dshp-bg:#ffffff;--dshp-paper:#f7f6f3;--dshp-ink:#4a4742;--dshp-mute:#9a958c;--dshp-line:#eceae4;--dshp-fill:#f3f1ec;--dshp-accent:#7d9a86;--dshp-accent-soft:#e7efe9;--dshp-ok:#5d8a6c;--dshp-warn:#a8844a;--dshp-bad:#c48989;color-scheme:light}
.dshp-root[data-theme="dusk"]{--dshp-bg:#2a2926;--dshp-paper:#32312d;--dshp-ink:#e6e2db;--dshp-mute:#a8a39a;--dshp-line:#3f3d38;--dshp-fill:#353430;--dshp-accent:#9bb5a6;--dshp-accent-soft:#3a433d;--dshp-ok:#8fbf9c;--dshp-warn:#d4b07a;--dshp-bad:#d4a0a0;color-scheme:dark}
.dshp-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.dshp-tabs{display:flex;gap:2px;flex-wrap:wrap;border-bottom:1px solid var(--dshp-line)}
.dshp-tab{appearance:none;border:0;background:transparent;color:var(--dshp-mute);font:13px/1 var(--dshp-sans);padding:9px 12px;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}
.dshp-tab:hover{color:var(--dshp-ink)}
.dshp-tab.is-on{color:var(--dshp-ink);border-bottom-color:var(--dshp-accent)}
.dshp-tab:focus-visible{outline:2px solid var(--dshp-accent);outline-offset:-2px}
.dshp-switch{display:inline-flex;border:1px solid var(--dshp-line);border-radius:999px;overflow:hidden;background:var(--dshp-paper)}
.dshp-switch button{appearance:none;border:0;background:transparent;color:var(--dshp-mute);font:12px/1 var(--dshp-sans);padding:6px 14px;cursor:pointer}
.dshp-switch button.is-on{background:var(--dshp-accent-soft);color:var(--dshp-ink)}
.dshp-switch button:focus-visible{outline:2px solid var(--dshp-accent);outline-offset:-2px}
.dshp-panel{border:1px solid var(--dshp-line);background:var(--dshp-paper);border-radius:10px;padding:18px 18px 16px}
.dshp-panel+.dshp-panel{margin-top:0}
.dshp-title{font-family:var(--dshp-display);font-size:20px;font-weight:500;letter-spacing:.02em;line-height:1.3;margin:0;color:var(--dshp-ink)}
.dshp-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap}
.dshp-head>.dshp-title{flex:0 0 auto;white-space:nowrap}
.dshp-sub{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:20px 0 10px}
.dshp-sub h4{margin:0;font-family:var(--dshp-display);font-size:15px;font-weight:500}
.dshp-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:14px}
.dshp-metric{border:1px solid var(--dshp-line);background:var(--dshp-bg);padding:12px;min-height:68px;display:flex;flex-direction:column;gap:4px;border-radius:8px}
.dshp-metric b{font-family:var(--dshp-display);font-size:18px;font-weight:500;line-height:1.2}
.dshp-metric span{font-size:11px;color:var(--dshp-mute)}
.dshp-bar{height:3px;border-radius:99px;background:var(--dshp-line);overflow:hidden;margin:8px 0 14px}
.dshp-bar>i{display:block;height:100%;background:var(--dshp-accent);width:0;transition:width .4s var(--dshp-ease)}
.dshp-group{border:1px solid var(--dshp-line);margin:0 0 8px;background:var(--dshp-bg);border-radius:8px;overflow:hidden}
.dshp-group-h{width:100%;display:flex;align-items:center;gap:10px;padding:9px 12px;border:0;background:transparent;color:inherit;cursor:pointer;font:inherit;text-align:left}
.dshp-group-h:hover{background:var(--dshp-fill)}
.dshp-group-h:focus-visible{outline:2px solid var(--dshp-accent);outline-offset:-2px}
.dshp-group-h strong{font-family:var(--dshp-display);font-size:14px;font-weight:500}
.dshp-group-h em{font-style:normal;font-size:12px;color:var(--dshp-mute);flex:1}
.dshp-count{font-family:var(--dshp-mono);font-size:12px;color:var(--dshp-mute)}
.dshp-table{width:100%;border-collapse:collapse;font-size:12.5px}
.dshp-table th{text-align:left;font-weight:500;font-size:11px;letter-spacing:.06em;color:var(--dshp-mute);padding:7px 12px;border-bottom:1px solid var(--dshp-line)}
.dshp-table td{padding:8px 12px;border-bottom:1px solid var(--dshp-line);vertical-align:middle}
.dshp-table td:last-child,.dshp-table th:last-child{white-space:nowrap;width:1%}
.dshp-table tr:last-child td{border-bottom:0}
.dshp-table tr.is-on td{background:var(--dshp-accent-soft)}
.dshp-id{font-family:var(--dshp-mono);opacity:.75;width:42px}
.dshp-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dshp-row+.dshp-row{margin-top:10px}
.dshp-pill{display:inline-flex;align-items:center;gap:6px;font-family:var(--dshp-mono);font-size:11px;padding:2px 8px;border:1px solid var(--dshp-line);border-radius:99px;line-height:1.6;background:var(--dshp-bg)}
.dshp-pill::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.dshp-pill.is-ok{color:var(--dshp-ok);border-color:color-mix(in srgb,var(--dshp-ok) 30%,var(--dshp-line))}
.dshp-pill.is-wait{color:var(--dshp-warn);border-color:color-mix(in srgb,var(--dshp-warn) 30%,var(--dshp-line))}
.dshp-pill.is-miss{color:var(--dshp-mute)}
.dshp-pill.is-bad{color:var(--dshp-bad)}
.dshp-btn{appearance:none;font-family:var(--dshp-sans);font-size:13px;font-weight:500;min-height:34px;padding:0 14px;border-radius:8px;border:1px solid transparent;cursor:pointer;transition:background .15s var(--dshp-ease),opacity .15s var(--dshp-ease)}
.dshp-btn:disabled{opacity:.45;cursor:not-allowed}
.dshp-btn:focus-visible{outline:2px solid var(--dshp-accent);outline-offset:2px}
.dshp-btn-primary{background:var(--dshp-accent-soft);color:var(--dshp-ink);border-color:color-mix(in srgb,var(--dshp-accent) 35%,var(--dshp-line))}
.dshp-btn-primary:hover:not(:disabled){background:color-mix(in srgb,var(--dshp-accent) 22%,var(--dshp-bg))}
.dshp-btn-ghost{background:transparent;color:var(--dshp-ink);border-color:var(--dshp-line)}
.dshp-btn-danger{background:transparent;color:var(--dshp-bad);border-color:color-mix(in srgb,var(--dshp-bad) 40%,var(--dshp-line))}
.dshp-btn-solid-danger{background:color-mix(in srgb,var(--dshp-bad) 16%,var(--dshp-bg));color:var(--dshp-bad);border-color:color-mix(in srgb,var(--dshp-bad) 30%,var(--dshp-line))}
.dshp-btn-tiny{min-height:28px;padding:0 10px;font-size:12px}
.dshp-field,.dshp-area{width:100%;box-sizing:border-box;font:13px/1.55 var(--dshp-mono);padding:8px 10px;background:var(--dshp-bg);color:var(--dshp-ink);border:1px solid var(--dshp-line);border-radius:8px}
.dshp-field{width:auto;min-width:140px}
.dshp-area{min-height:220px;resize:vertical}
.dshp-field:focus,.dshp-area:focus{outline:none;border-color:var(--dshp-accent);box-shadow:0 0 0 3px var(--dshp-accent-soft)}
.dshp-field:disabled,.dshp-area:disabled{opacity:.5}
.dshp-ask{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;padding:10px 12px;border:1px solid var(--dshp-line);border-radius:8px;background:var(--dshp-bg);font-size:13px}
.dshp-notice{font-size:12.5px;line-height:1.4}
.dshp-notice.is-ok{color:var(--dshp-ok)}
.dshp-notice.is-bad{color:var(--dshp-bad)}
.dshp-skel{height:12px;border-radius:6px;background:linear-gradient(90deg,var(--dshp-fill),var(--dshp-line),var(--dshp-fill));background-size:200% 100%;animation:dshp-pulse 1.2s ease-in-out infinite}
.dshp-empty{padding:28px 12px;font-size:13px;color:var(--dshp-mute);text-align:center}
.dshp-split{display:flex;flex-direction:column;gap:12px}
.dshp-rulelist{display:flex;flex-direction:column;border:1px solid var(--dshp-line);border-radius:8px;background:var(--dshp-bg);overflow:hidden}
.dshp-rulebody{max-height:240px;overflow:auto}
.dshp-ruleitem{display:flex;align-items:center;gap:12px;width:100%;padding:10px 12px;border:0;border-bottom:1px solid var(--dshp-line);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dshp-ruleitem:hover{background:var(--dshp-fill)}
.dshp-ruleitem.is-edit{background:var(--dshp-accent-soft)}
.dshp-rule-main{flex:1;min-width:0}
.dshp-rule-name{display:flex;align-items:center;gap:8px;font-family:var(--dshp-display);font-size:14px;line-height:1.35}
.dshp-rule-meta{display:block;margin-top:3px;font-family:var(--dshp-mono);font-size:11px;color:var(--dshp-mute)}
.dshp-rule-ops{display:flex;flex-direction:row;align-items:center;gap:6px;flex-shrink:0}
.dshp-create{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-top:1px solid var(--dshp-line);background:var(--dshp-paper)}
.dshp-create-row{display:flex;gap:6px;align-items:center}
.dshp-create .dshp-field{flex:1;min-width:0;width:auto}
.dshp-editor{display:flex;flex-direction:column;gap:10px;min-width:0;border:1px solid var(--dshp-line);border-radius:8px;background:var(--dshp-bg);padding:12px;min-height:320px}
.dshp-editor .dshp-area{flex:1;min-height:240px}
.dshp-editor-empty{flex:1;display:flex;align-items:center;justify-content:center;color:var(--dshp-mute);font-size:13px;min-height:160px}
.dshp-card{border:1px solid var(--dshp-line);background:var(--dshp-bg);border-radius:8px;padding:12px;margin-top:10px}
.dshp-body{margin:0;font-size:12.5px;line-height:1.75;color:var(--dshp-ink)}
.dshp-note{margin:8px 0 0;font-size:11.5px;color:var(--dshp-mute);line-height:1.7}
.dshp-kv{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 12px;font-size:12.5px}
.dshp-kv b{font-weight:500;color:var(--dshp-mute);white-space:nowrap}
.dshp-kv code{font-family:var(--dshp-mono);font-size:11.5px;word-break:break-all}
.dshp-switchrow{display:flex;align-items:center;gap:12px;padding:11px 12px;border:1px solid var(--dshp-line);border-radius:8px;background:var(--dshp-bg)}
.dshp-switchrow+.dshp-switchrow{margin-top:8px}
.dshp-switchrow-main{flex:1 1 auto;min-width:0}
.dshp-switchrow strong{font-family:var(--dshp-display);font-size:14px;font-weight:500;display:flex;align-items:center;gap:8px}
.dshp-switchrow em{display:block;font-style:normal;font-size:11.5px;color:var(--dshp-mute);line-height:1.6;margin-top:3px}
.dshp-tag{font-family:var(--dshp-mono);font-size:10px;color:var(--dshp-mute);border:1px solid var(--dshp-line);border-radius:99px;padding:1px 6px;font-weight:400}
.dshp-seg{display:inline-flex;border:1px solid var(--dshp-line);border-radius:8px;overflow:hidden;background:var(--dshp-bg)}
.dshp-seg button{appearance:none;border:0;background:transparent;color:var(--dshp-mute);font:12px/1 var(--dshp-sans);padding:8px 12px;cursor:pointer;border-right:1px solid var(--dshp-line)}
.dshp-seg button:last-child{border-right:0}
.dshp-seg button.is-on{background:var(--dshp-accent-soft);color:var(--dshp-ink)}
.dshp-seg button:focus-visible{outline:2px solid var(--dshp-accent);outline-offset:-2px}
.dshp-plist{display:flex;flex-direction:column;border:1px solid var(--dshp-line);border-radius:8px;background:var(--dshp-bg);overflow:hidden;max-height:300px;overflow-y:auto}
.dshp-pitem{display:flex;align-items:center;gap:12px;width:100%;padding:10px 12px;border:0;border-bottom:1px solid var(--dshp-line);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dshp-pitem:last-child{border-bottom:0}
.dshp-pitem:hover{background:var(--dshp-fill)}
.dshp-pitem.is-edit{background:var(--dshp-accent-soft)}
.dshp-pitem-main{flex:1 1 auto;min-width:0}
.dshp-pitem-name{display:flex;align-items:center;gap:8px;font-family:var(--dshp-display);font-size:14px;line-height:1.35}
.dshp-pitem-meta{display:block;margin-top:3px;font-family:var(--dshp-mono);font-size:11px;color:var(--dshp-mute)}
.dshp-pitem-prev{display:block;margin-top:4px;font-size:11.5px;color:var(--dshp-mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshp-pitem-ops{display:flex;align-items:center;gap:6px;flex:0 0 auto;flex-wrap:wrap;justify-content:flex-end;white-space:nowrap}
.dshp-code{display:flex;border:1px solid var(--dshp-line);border-radius:8px;background:var(--dshp-bg);overflow:hidden;min-height:300px;height:52vh}
.dshp-gutter{flex:0 0 auto;overflow:hidden;background:var(--dshp-fill);border-right:1px solid var(--dshp-line);padding:10px 8px 10px 10px}
.dshp-gutter pre{margin:0;font:12.5px/20px var(--dshp-mono);color:var(--dshp-mute);text-align:right;white-space:pre}
.dshp-code textarea{flex:1 1 auto;width:100%;border:0;outline:none;resize:none;background:transparent;color:var(--dshp-ink);font:12.5px/20px var(--dshp-mono);padding:10px 12px;white-space:pre;overflow:auto;tab-size:2}
.dshp-code textarea:focus{outline:none}
.dshp-find{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dshp-find .dshp-field{min-width:120px;max-width:200px;font:12px/1.4 var(--dshp-mono);padding:5px 8px}
.dshp-tree{display:flex;flex-direction:column;border:1px solid var(--dshp-line);border-radius:8px;background:var(--dshp-bg);padding:8px 10px;max-height:340px;overflow:auto}
.dshp-tnode{display:flex;align-items:center;gap:8px;padding:2px 0;font-family:var(--dshp-mono);font-size:12px;min-width:0}
.dshp-tmark{flex:0 0 12px;color:var(--dshp-mute);text-align:center}
.dshp-tname{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshp-tname.is-dir{color:var(--dshp-ink);font-weight:500}
.dshp-tsize{flex:0 0 auto;color:var(--dshp-mute);font-size:11px}
.dshp-kv-tree{background:var(--dshp-paper);border:1px solid var(--dshp-line);border-radius:8px;padding:10px}
.dshp-hunk{border:1px solid var(--dshp-line);border-radius:8px;margin-bottom:8px;overflow:hidden;background:var(--dshp-paper)}
.dshp-hunk-h{font-family:var(--dshp-mono);font-size:11px;color:var(--dshp-mute);padding:5px 10px;border-bottom:1px solid var(--dshp-line);background:var(--dshp-fill)}
.dshp-drow{display:flex;gap:6px;font-family:var(--dshp-mono);font-size:12px;line-height:1.6;padding:0 10px;white-space:pre-wrap;word-break:break-word}
.dshp-drow.is-add{background:color-mix(in srgb,var(--dshp-ok) 14%,transparent)}
.dshp-drow.is-del{background:color-mix(in srgb,var(--dshp-bad) 14%,transparent)}
.dshp-dln{flex:0 0 auto;color:var(--dshp-mute);font-size:11px;min-width:34px;text-align:right;user-select:none}
.dshp-dmark{flex:0 0 10px;color:var(--dshp-mute)}
.dshp-drow.is-add .dshp-dmark{color:var(--dshp-ok)}
.dshp-drow.is-del .dshp-dmark{color:var(--dshp-bad)}
.dshp-dtext{flex:1 1 auto;min-width:0}
.dshp-stats{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-family:var(--dshp-mono);font-size:11px;color:var(--dshp-mute)}
.dshp-overlay{position:fixed;inset:0;background:rgba(18,18,16,.5);display:flex;align-items:center;justify-content:center;z-index:80;padding:20px}
.dshp-modal{background:var(--dshp-bg);color:var(--dshp-ink);border:1px solid var(--dshp-line);border-radius:12px;padding:18px;width:min(620px,94vw);max-height:86vh;display:flex;flex-direction:column;gap:12px;box-shadow:0 18px 48px rgba(0,0,0,.28)}
.dshp-modal h4{margin:0;font-family:var(--dshp-display);font-size:16px;font-weight:500;display:flex;align-items:center;gap:8px}
.dshp-modal pre{margin:0;overflow:auto;font:12.5px/1.6 var(--dshp-mono);background:var(--dshp-paper);border:1px solid var(--dshp-line);border-radius:8px;padding:12px;white-space:pre-wrap;word-break:break-word;flex:1 1 auto;min-height:120px}
@keyframes dshp-pulse{0%{background-position:200% 0}100%{background-position:-200% 0}}
@media (max-width:640px){.dshp-metrics{grid-template-columns:1fr}.dshp-ruleitem{flex-wrap:wrap}.dshp-rule-ops{width:100%;justify-content:flex-end}.dshp-pitem{flex-wrap:wrap}.dshp-pitem-ops{max-width:none;width:100%}}
@media (prefers-reduced-motion:reduce){.dshp-btn,.dshp-bar>i{transition:none}.dshp-skel{animation:none}}
`;

		function formatSize(bytes) {
			if (typeof bytes !== "number" || !isFinite(bytes) || bytes < 0) return "0 B";
			if (bytes < 1024) return bytes + " B";
			const kb = bytes / 1024;
			return (kb >= 100 ? Math.round(kb) : kb.toFixed(1)) + " KB";
		}

		function formatNum(n) {
			if (typeof n !== "number" || !isFinite(n)) return "0";
			return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
		}

		// 服务端 lib/prompts.js 里有一份同样的实现，改的时候两边一起改。
		function estimateTokens(text) {
			const s = typeof text === "string" ? text : "";
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
				) cjk += 1;
				else other += 1;
			}
			return Math.round(cjk * 0.6 + other / 3.6);
		}

		function utf8Bytes(text) {
			const s = typeof text === "string" ? text : "";
			try { return new Blob([s]).size; } catch { /* fall through */ }
			try { return encodeURIComponent(s).replace(/%[0-9A-F]{2}/g, "x").length; } catch { return s.length; }
		}

		function textStats(text) {
			const s = typeof text === "string" ? text : "";
			return {
				bytes: utf8Bytes(s),
				lines: s.length === 0 ? 0 : s.split("\n").length,
				tokens: estimateTokens(s),
			};
		}

		function textMeta(t, text) {
			const st = textStats(text);
			return t("prompts.stats", {
				size: formatSize(st.bytes),
				tok: formatNum(st.tokens),
				lines: formatNum(st.lines),
			});
		}

		function statusKind(st) {
			if (st === "applied" || st === "already") return "ok";
			if (st === "pending") return "wait";
			if (st === "missing_file") return "miss";
			if (st === "disabled") return "off";
			return "bad";
		}

		function statusLabel(st, t) {
			if (st === "applied" || st === "already") return t("status.applied");
			if (st === "pending") return t("status.pending");
			if (st === "missing_file" || st === "skipped") return t("skip");
			if (st === "disabled") return t("status.disabled");
			return st || t("unknown");
		}

		function shimKind(v) {
			if (v === "patched") return "ok";
			if (v === "original") return "wait";
			if (v === "missing" || v === "n/a" || !v) return "miss";
			return "bad";
		}

		// 「隐藏黑框」开没开：看 dsh.ps1 / dsh 这两个真正会被注入的启动器。
		// dsh.cmd 插件**刻意不注入**（.cmd 由 cmd.exe 起，必定闪窗，注入了也没用），
		// 所以它一直是 original —— 拿它判断会永远显示"未隐藏"。
		function shimHidden(status) {
			if (!status) return false;
			return status.shim_ps1 === "patched" || status.shim_bin === "patched";
		}

		function noticeNode(notice) {
			if (!notice || notice.kind === "idle" || !notice.text) return null;
			return h("span", { className: "dshp-notice " + (notice.kind === "error" ? "is-bad" : "is-ok") }, notice.text);
		}

		function Btn(props) {
			const { kind, tiny, children, className, type, ...rest } = props;
			const cls = ["dshp-btn", kind ? "dshp-btn-" + kind : "dshp-btn-ghost", tiny ? "dshp-btn-tiny" : "", className || ""].filter(Boolean).join(" ");
			return h("button", Object.assign({ type: type || "button", className: cls }, rest), children);
		}

		function Pill({ value, label }) {
			const t = useT();
			return h("span", { className: "dshp-pill is-" + statusKind(value) }, label || statusLabel(value, t));
		}

		// 组名：优先走前端字典（跟界面语言走），字典里没有就退回服务端给的名字。
		function groupLabel(t, g) {
			const key = "group." + (g && g.id);
			const hit = t(key);
			return hit && hit !== key ? hit : ((g && (g.label || g.id)) || "");
		}

		function TabHint({ children }) {
			return h("p", { className: "dshp-note" }, children);
		}

		function KeyValue({ rows }) {
			return h("div", { className: "dshp-kv" }, rows.filter(Boolean).map((r, i) => [
				h("b", { key: "k" + i }, r[0]),
				h("code", { key: "v" + i }, r[1] || "—"),
			]));
		}

		function Modal(props) {
			const { title, children, onClose, footer } = props;
			useEffect(() => {
				const onKey = (e) => { if (e.key === "Escape") onClose(); };
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [onClose]);
			return h("div", { className: "dshp-overlay", onMouseDown: (e) => { if (e.target === e.currentTarget) onClose(); } },
				h("div", { className: "dshp-modal", role: "dialog", "aria-modal": "true" },
					h("h4", null, title),
					children,
					h("div", { className: "dshp-row", style: { justifyContent: "flex-end", margin: 0 } }, footer),
				),
			);
		}

		function NameDialog({ title, initial, placeholder, onOk, onClose, busy, multiline }) {
			const t = useT();
			const [value, setValue] = useState(initial || "");
			const ok = () => { const v = value.trim(); if (!v) return; onOk(v); };
			return h(Modal, { title, onClose,
				footer: [
					h(Btn, { key: "c", tiny: true, onClick: onClose }, t("btn.cancel")),
					h(Btn, { key: "o", tiny: true, kind: "primary", disabled: busy || !value.trim(), onClick: ok }, t("btn.ok")),
				] },
				h("input", {
					className: "dshp-field", style: { width: "100%" }, value, placeholder: placeholder || "",
					autoFocus: true,
					onChange: (e) => setValue(e.target.value),
					onKeyDown: (e) => { if (e.key === "Enter") ok(); },
				}),
			);
		}

		// 一排开关（高级页 / 沙箱页用）
		function SwitchRow({ title, desc, value, onLabel, offLabel, onToggle, busy, tag, extra }) {
			return h("div", { className: "dshp-switchrow" },
				h("div", { className: "dshp-switchrow-main" },
					h("strong", null, title, tag ? h("span", { className: "dshp-tag" }, tag) : null),
					desc ? h("em", null, desc) : null,
					extra || null,
				),
				h("button", {
					type: "button",
					disabled: busy,
					onClick: () => onToggle(!value),
					style: {
						appearance: "none",
						cursor: busy ? "default" : "pointer",
						border: "1px solid var(--dshp-line)",
						borderRadius: 999,
						padding: "5px 18px",
						font: "12px/1 var(--dshp-sans)",
						background: value ? "var(--dshp-accent-soft)" : "transparent",
						color: value ? "var(--dshp-ink)" : "var(--dshp-mute)",
						minWidth: 62,
						flex: "0 0 auto",
					},
				}, value ? (onLabel || "on") : (offLabel || "off")),
			);
		}

		// 分组开关。sandbox / approval 由服务端联动（dsh 会校验这两个默认值的组合）。
		function GroupSwitches({ state, busy, onToggle, only }) {
			const t = useT();
			const all = (state && state.groups) || [];
			const groups = only ? all.filter((g) => only.includes(g.id)) : all;
			if (!groups.length) return null;
			const off = groups.filter((g) => !g.enabled).map((g) => groupLabel(t, g));
			const labelOf = (id) => {
				const g = all.find((x) => x.id === id);
				return g ? groupLabel(t, g) : id;
			};
			return h("div", null,
				h("div", { className: "dshp-sub" },
					h("h4", null, t("switch.title")),
					h("span", { className: "dshp-count" }, off.length ? t("switch.off") + ": " + off.join(", ") : t("switch.on")),
				),
				h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
					groups.map((g) => h("div", {
						key: g.id,
						style: { display: "flex", alignItems: "center", gap: 10, border: "1px solid var(--dshp-line)", background: "var(--dshp-bg)", borderRadius: 8, padding: "8px 12px" },
					},
						h("div", { style: { flex: "1 1 auto", minWidth: 0 } },
							h("strong", { style: { fontSize: 13 } }, labelOf(g.id) + (g.coupled ? " ↔ " + g.coupled.filter((x) => x !== g.id).map(labelOf).join(", ") : "")),
							h("div", { style: { fontSize: 11, color: "var(--dshp-mute)", marginTop: 2 } }, t("switch.desc." + g.id) || ""),
						),
						h("button", {
							type: "button",
							disabled: busy || !!g.locked,
							title: g.locked ? t("switch.locked") : "",
							onClick: () => onToggle(g.id, !g.enabled),
							style: {
								appearance: "none",
								cursor: busy || g.locked ? "default" : "pointer",
								border: "1px solid var(--dshp-line)",
								borderRadius: 999,
								padding: "5px 18px",
								font: "12px/1 var(--dshp-sans)",
								background: g.enabled ? "var(--dshp-accent-soft)" : "transparent",
								color: g.enabled ? "var(--dshp-ink)" : "var(--dshp-mute)",
								opacity: g.locked ? 0.45 : 1,
								minWidth: 56,
							},
						}, g.locked ? t("switch.locked") : g.enabled ? t("switch.on") : t("switch.off")),
					)),
				),
				h("p", { style: { fontSize: 11, color: "var(--dshp-mute)", margin: "8px 0 0", lineHeight: 1.6 } },
					t("switch.hint") + "  ·  " + t("switch.coupled"),
				),
			);
		}

		// 补丁表。分组直接读服务端 state.groups —— 和上面的分组开关是同一份数据，
		// 所以拨开关时这里的归属和计数一定对得上（以前这里写死了一份另一套分类法）。
		function PatchGroups({ state, only }) {
			const t = useT();
			const all = (state && state.groups) || [];
			const groups = only ? all.filter((g) => only.includes(g.id)) : all;
			const [open, setOpen] = useState({});
			if (!state || !state.patch_status) return h("div", { className: "dshp-skel", style: { height: 120 } });
			if (!groups.length) return null;
			const names = state.patch_names || {};
			return groups.map((group) => {
				const rows = (group.ids || []).map((id) => {
					const st = state.patch_status[id] || state.patch_status[String(id)] || "missing_file";
					return { id, st, label: t("patch." + id), code: names[id] || names[String(id)] || "" };
				});
				const done = rows.filter((r) => r.st === "applied" || r.st === "already").length;
				const expanded = open[group.id] !== undefined ? !!open[group.id] : group.id !== "tools";
				return h("div", { key: group.id, className: "dshp-group" },
					h("button", {
						type: "button",
						className: "dshp-group-h",
						"aria-expanded": expanded ? "true" : "false",
						onClick: () => setOpen((prev) => Object.assign({}, prev, { [group.id]: !expanded })),
					},
						h("strong", null, groupLabel(t, group)),
						group.enabled ? null : h("span", { className: "dshp-count" }, t("status.disabled")),
						h("span", { className: "dshp-count" }, done + "/" + rows.length),
					),
					expanded ? h("table", { className: "dshp-table" },
						h("thead", null, h("tr", null,
							h("th", null, "#"),
							h("th", null, t("table.patch")),
							h("th", null, t("table.status")),
						)),
						h("tbody", null, rows.map((r) => h("tr", { key: r.id },
							h("td", { className: "dshp-id" }, "#" + r.id),
							h("td", null,
								r.label,
								r.code ? h("span", { style: { color: "var(--dshp-mute)", fontSize: 11, marginLeft: 8 } }, r.code) : null,
							),
							h("td", null, h(Pill, { value: r.st })),
						))),
					) : null,
				);
			});
		}

		// 带行号 + 查找的编辑器。行号能对齐靠的是 textarea 不折行（white-space:pre）
		// 且两边行高都写死 20px（CODE_LINE_H）。
		function CodeEditor({ value, onChange }) {
			const t = useT();
			const taRef = useRef(null);
			const gutterRef = useRef(null);
			const [find, setFind] = useState("");
			const [hit, setHit] = useState(0);
			const lines = useMemo(() => (value.length === 0 ? 1 : value.split("\n").length), [value]);
			const hits = useMemo(() => {
				const needle = find.trim().toLowerCase();
				if (!needle) return [];
				const hay = value.toLowerCase();
				const out = [];
				let i = hay.indexOf(needle);
				while (i >= 0 && out.length < 20000) {
					out.push(i);
					i = hay.indexOf(needle, i + Math.max(1, needle.length));
				}
				return out;
			}, [value, find]);

			const syncScroll = useCallback(() => {
				if (gutterRef.current && taRef.current) gutterRef.current.scrollTop = taRef.current.scrollTop;
			}, []);

			const jump = useCallback((dir) => {
				const ta = taRef.current;
				if (!ta || !hits.length) return;
				const next = (hit + dir + hits.length) % hits.length;
				setHit(next);
				const start = hits[next];
				const line = value.slice(0, start).split("\n").length - 1;
				ta.focus();
				ta.setSelectionRange(start, start + find.trim().length);
				ta.scrollTop = Math.max(0, line * CODE_LINE_H - ta.clientHeight / 3);
				syncScroll();
			}, [hits, hit, value, find, syncScroll]);

			// 查找词变了就跳到第一处（只滚动 + 选中，不抢输入框焦点）
			useEffect(() => {
				setHit(0);
				if (!find.trim() || !hits.length) return;
				const ta = taRef.current;
				if (!ta) return;
				const line = value.slice(0, hits[0]).split("\n").length - 1;
				ta.scrollTop = Math.max(0, line * CODE_LINE_H - ta.clientHeight / 3);
				ta.setSelectionRange(hits[0], hits[0] + find.trim().length);
				syncScroll();
				// 只跟 find 走；值一变不重跳（否则每敲一个字都跳一次）
				// eslint-disable-next-line react-hooks/exhaustive-deps
			}, [find]);

			return h("div", null,
				h("div", { className: "dshp-find", style: { marginBottom: 8 } },
					h("input", {
						className: "dshp-field", value: find, placeholder: t("ed.find"), spellCheck: false,
						onChange: (e) => setFind(e.target.value),
						onKeyDown: (e) => { if (e.key === "Enter") { e.preventDefault(); jump(e.shiftKey ? -1 : 1); } },
					}),
					h(Btn, { tiny: true, disabled: !hits.length, onClick: () => jump(1) }, t("ed.next")),
					h(Btn, { tiny: true, disabled: !hits.length, onClick: () => jump(-1) }, t("ed.prev")),
					h("span", { className: "dshp-stats" },
						!find.trim() ? "" : hits.length === 0
							? t("ed.noMatch")
							: t("ed.matches", { n: formatNum(hits.length) }) + " · " + (hit + 1) + "/" + hits.length),
				),
				h("div", { className: "dshp-code" },
					h("div", { className: "dshp-gutter", ref: gutterRef, "aria-hidden": "true" },
						h("pre", null, Array.from({ length: lines }, (_, i) => String(i + 1)).join("\n")),
					),
					h("textarea", {
						ref: taRef,
						className: "dshp-code-area",
						wrap: "off",
						spellCheck: false,
						value,
						onChange: (e) => onChange(e.target.value),
						onScroll: syncScroll,
					}),
				),
			);
		}





		// ── 概览 ──────────────────────────────────────────────────────
		function OverviewTab({ onGoto }) {
			const t = useT();
			const tRef = useRef(t);
			tRef.current = t;
			const [state, setState] = useState(null);
			const [busy, setBusy] = useState(false);
			const [askRestart, setAskRestart] = useState(false);
			const [notice, setNotice] = useState({ kind: "idle", text: "" });

			const loadAll = useCallback(() => {
				const tr = tRef.current;
				apiJson("/dsh-purge/status")
					.then((d) => {
						if (d && d.ok) setState(d);
						else {
							setState({ ok: false, patches_total: 0, patches_applied: 0, patch_status: {}, shim_cmd: "n/a", shim_ps1: "n/a", shim_bin: "n/a", has_backup: false });
							setNotice({ kind: "error", text: tr("err.status", { error: (d && d.error) || "bad response" }) });
						}
					})
					.catch((e) => {
						setState({ ok: false, patches_total: 0, patches_applied: 0, patch_status: {}, shim_cmd: "n/a", shim_ps1: "n/a", shim_bin: "n/a", has_backup: false });
						setNotice({ kind: "error", text: tr("err.status", { error: e.message }) });
					});
			}, []);

			useEffect(() => { loadAll(); }, [loadAll]);

			const doAction = useCallback((action, actionKey) => {
				setBusy(true);
				setAskRestart(false);
				setNotice({ kind: "idle", text: "" });
				const tr = tRef.current;
				const label = tr(actionKey);
				apiPost("/dsh-purge/" + action)
					.then((d) => {
						if (d && d.ok) {
							if (action === "apply" && d.complete === false) {
								const parts = [];
								if (d.failed > 0) {
									const ids = (d.failed_items || []).map((x) => x.id).filter((id) => id != null).join(",");
									parts.push(tr("restart.incomplete.patches", { failed: String(d.failed || 0), ids: ids || "?" }));
								}
								if (d.cmd_flash && d.cmd_flash.ok === false) {
									parts.push(tr("restart.incomplete.flash", { entry: String(d.cmd_flash.entry || "fail") }));
								}
								if (parts.length === 0) parts.push(tr("restart.incomplete.flash", { entry: "unknown" }));
								setNotice({ kind: "error", text: tr("restart.incomplete", { detail: parts.join("；") }) });
								loadAll();
								return;
							}
							setNotice({ kind: "ok", text: tr("ok.done") });
							loadAll();
							// 只在 apply 干净跑完之后才提示重启，别在清洗中途重启。
							if (action === "apply") setAskRestart(true);
						} else {
							setNotice({ kind: "error", text: tr("err.action", { action: label, error: (d && d.error) || "" }) });
						}
					})
					.catch((e) => setNotice({ kind: "error", text: tr("err.action", { action: label, error: e.message }) }))
					.finally(() => setBusy(false));
			}, [loadAll]);

			// 分组开关：服务端会联动 sandbox/approval，并自动「还原 → 重打」。
			const toggleGroup = useCallback((name, enabled) => {
				setBusy(true);
				setNotice({ kind: "idle", text: "" });
				apiPost("/dsh-purge/group", { name, enabled })
					.then((d) => {
						if (d && d.ok) {
							loadAll();
							setAskRestart(true);
							setNotice({ kind: "ok", text: tRef.current("ok.done") });
						} else {
							setNotice({ kind: "error", text: (d && d.error) || "toggle failed" });
						}
					})
					.catch((e) => setNotice({ kind: "error", text: e.message }))
					.finally(() => setBusy(false));
			}, [loadAll]);

			const s = state;
			const total = s && s.patches_total ? s.patches_total : 26;
			const applied = s && typeof s.patches_applied === "number" ? s.patches_applied : 0;
			const pct = total ? Math.round((applied / total) * 100) : 0;

			return h("section", { className: "dshp-panel", "aria-label": t("purge.title") },
				h("h3", { className: "dshp-title", style: { marginBottom: 14 } }, t("purge.title")),
				s ? h("div", { className: "dshp-metrics" },
					h("div", { className: "dshp-metric" },
						h("b", null, applied + " / " + total),
						h("span", null, t("metric.purged")),
					),
					h("div", { className: "dshp-metric" },
						h("b", { style: { fontSize: 13, fontFamily: "var(--dshp-mono)", fontWeight: 500 } },
							h("span", { className: "dshp-pill is-" + shimKind(s.shim_cmd) }, "cmd"),
							" ",
							h("span", { className: "dshp-pill is-" + shimKind(s.shim_ps1) }, "ps1"),
							" ",
							h("span", { className: "dshp-pill is-" + shimKind(s.shim_bin || "missing") }, "unix"),
						),
						h("span", null, t("metric.shim")),
					),
					h("div", { className: "dshp-metric" },
						h("b", null, s.has_backup ? t("metric.bak.yes") : t("metric.bak.no")),
						h("span", null, t("metric.bak.hint")),
					),
				) : h("div", { className: "dshp-metrics" },
					h("div", { className: "dshp-metric" }, h("div", { className: "dshp-skel" }), h("div", { className: "dshp-skel", style: { width: "40%" } })),
					h("div", { className: "dshp-metric" }, h("div", { className: "dshp-skel" }), h("div", { className: "dshp-skel", style: { width: "40%" } })),
					h("div", { className: "dshp-metric" }, h("div", { className: "dshp-skel" }), h("div", { className: "dshp-skel", style: { width: "40%" } })),
				),
				h("div", { className: "dshp-bar", "aria-hidden": "true" }, h("i", { style: { width: pct + "%" } })),
				h(GroupSwitches, { state: s, busy, onToggle: toggleGroup, only: ["prompt", "tools", "compat"] }),
				h("p", { className: "dshp-note", style: { marginBottom: 14 } },
					t("switch.moved"),
					onGoto ? h("button", {
						type: "button",
						onClick: () => onGoto("sandbox"),
						style: { appearance: "none", border: 0, background: "transparent", color: "var(--dshp-accent)", cursor: "pointer", font: "inherit", textDecoration: "underline", padding: 0 },
					}, t("tab.sandbox")) : null,
				),
				h(PatchGroups, { state: s }),
				h("div", { className: "dshp-row", style: { marginTop: 14 } },
					h(Btn, { kind: "primary", disabled: busy, onClick: () => doAction("apply", "action.apply") }, busy ? t("btn.apply.busy") : t("btn.apply")),
					h(Btn, { kind: "danger", disabled: busy, onClick: () => doAction("revert", "action.revert") }, t("btn.revert")),
					noticeNode(notice),
				),
				askRestart ? h("div", { className: "dshp-ask" },
					h("span", null, t("restart.confirm")),
					h(Btn, { tiny: true, onClick: () => setAskRestart(false) }, t("restart.later")),
					h(Btn, {
						tiny: true, kind: "primary",
						onClick: () => {
							setAskRestart(false);
							restartDsh(setNotice, function () {}, t);
						},
					}, t("btn.restart")),
				) : null,
			);
		}

		// ── 提示词（B4）─────────────────────────────────────────────
		function PromptsTab() {
			const t = useT();
			const tRef = useRef(t);
			tRef.current = t;
			const [st, setSt] = useState(null);
			const [filter, setFilter] = useState("");
			const [editId, setEditId] = useState(null);
			const [content, setContent] = useState("");
			const [original, setOriginal] = useState("");
			const [busy, setBusy] = useState(false);
			const [notice, setNotice] = useState({ kind: "idle", text: "" });
			const [dialog, setDialog] = useState(null); // {kind, id}
			const [preview, setPreview] = useState(null); // {id, content}
			const fileRef = useRef(null);

			const dirty = editId !== null && content !== original;

			const load = useCallback(() => {
				const tr = tRef.current;
				apiJson("/dsh-purge/prompts/status")
					.then((d) => {
						if (d && d.ok) setSt(d);
						else setNotice({ kind: "error", text: tr("err.status", { error: (d && d.error) || "bad response" }) });
					})
					.catch((e) => setNotice({ kind: "error", text: tr("err.status", { error: e.message }) }));
			}, []);

			useEffect(() => { load(); }, [load]);

			// 有未保存内容时，关页面/刷新要拦一下
			useEffect(() => {
				if (!dirty) return undefined;
				const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ""; };
				window.addEventListener("beforeunload", onBeforeUnload);
				return () => window.removeEventListener("beforeunload", onBeforeUnload);
			}, [dirty]);

			const ok = useCallback((text) => setNotice({ kind: "ok", text }), []);
			const err = useCallback((text) => setNotice({ kind: "error", text }), []);

			const run = useCallback((promise, onDone) => {
				setBusy(true);
				setNotice({ kind: "idle", text: "" });
				promise
					.then((d) => {
						if (d && d.ok) {
							load();
							if (onDone) onDone(d);
						} else err((d && d.error) || "failed");
					})
					.catch((e) => err(e.message))
					.finally(() => setBusy(false));
			}, [load, err]);

			// 有未保存改动时的三选一：保存 / 丢弃 / 别动
			const askDirty = useCallback(() => {
				const tr = tRef.current;
				if (!dirty) return "go";
				if (window.confirm(tr("prompts.dirty.confirm", { id: editId }))) return "save";
				if (window.confirm(tr("prompts.dirty.drop"))) return "drop";
				return "cancel";
			}, [dirty, editId]);

			const saveEditor = useCallback((silent) => {
				if (editId === null) return null;
				return apiPost("/dsh-purge/prompts/write", { id: editId, content })
					.then((d) => {
						if (d && d.ok) {
							setOriginal(content);
							if (!silent) ok(tRef.current("ed.saved", { id: editId }));
						} else err((d && d.error) || "failed");
						return d;
					})
					.catch((e) => { err(e.message); return null; });
			}, [editId, content, ok, err]);

			// 所有「会动到编辑器/删东西/开对话框」的动作都先过这道闸 ——
			// 尤其是新建空套：它会把编辑器换成新那套，不问一句就吞掉没保存的内容。
			const guard = useCallback((then) => {
				const verdict = askDirty();
				if (verdict === "cancel") return;
				if (verdict === "save") run(saveEditor(true), () => then());
				else then();
			}, [askDirty, run, saveEditor]);

			const openSet = useCallback((id) => {
				const verdict = askDirty();
				if (verdict === "cancel") return;
				const proceed = () => {
					setBusy(true);
					setNotice({ kind: "idle", text: "" });
					apiJson("/dsh-purge/prompts/read?id=" + encodeURIComponent(id))
						.then((d) => {
							if (d && d.ok) {
								setEditId(id);
								setContent(d.content || "");
								setOriginal(d.content || "");
							} else err((d && d.error) || "failed");
						})
						.catch((e) => err(e.message))
						.finally(() => setBusy(false));
				};
				if (verdict === "save") run(saveEditor(true), proceed);
				else proceed();
			}, [askDirty, run, saveEditor, err]);

			const useSet = useCallback((id) => {
				if (editId === id) return;
				const verdict = askDirty();
				if (verdict === "cancel") return;
				const proceed = () => run(apiPost("/dsh-purge/prompts/use", { id }), (d) => {
					ok(tRef.current("ok.done") + (d && d.flushed ? "（原来那套的改动已自动存回）" : ""));
					// 切过去以后编辑器跟着换成新那套的内容
					apiJson("/dsh-purge/prompts/read?id=" + encodeURIComponent(id))
						.then((r) => { if (r && r.ok) { setEditId(id); setContent(r.content || ""); setOriginal(r.content || ""); } })
						.catch(() => {});
				});
				if (verdict === "save") run(saveEditor(true), proceed);
				else proceed();
			}, [editId, askDirty, run, saveEditor, ok]);

			const doDelete = useCallback((row) => {
				const tr = tRef.current;
				const isActive = st && st.active === row.id;
				const msg = tr("prompts.confirmDelete", { id: row.id }) + (isActive ? "\n\n" + tr("prompts.confirmDelete.active") : "");
				guard(() => {
					if (!window.confirm(msg)) return;
					run(apiPost("/dsh-purge/prompts/delete", { id: row.id }), () => {
						ok(tr("prompts.deleted", { id: row.id }));
						if (editId === row.id) { setEditId(null); setContent(""); setOriginal(""); }
					});
				});
			}, [st, editId, guard, run, ok]);

			const doExport = useCallback((id) => {
				apiJson("/dsh-purge/prompts/read?id=" + encodeURIComponent(id))
					.then((d) => {
						if (!d || !d.ok) throw new Error((d && d.error) || "failed");
						const blob = new Blob([d.content || ""], { type: "text/markdown;charset=utf-8" });
						const url = URL.createObjectURL(blob);
						const a = document.createElement("a");
						a.href = url;
						a.download = id + ".md";
						document.body.appendChild(a);
						a.click();
						document.body.removeChild(a);
						setTimeout(() => URL.revokeObjectURL(url), 4000);
						ok(tRef.current("prompts.exported", { id }));
					})
					.catch((e) => err(e.message));
			}, [ok, err]);

			const doPreview = useCallback((id) => {
				apiJson("/dsh-purge/prompts/read?id=" + encodeURIComponent(id))
					.then((d) => {
						if (d && d.ok) setPreview({ id, content: d.content || "" });
						else err((d && d.error) || "failed");
					})
					.catch((e) => err(e.message));
			}, [err]);

			const onPickFile = useCallback((e) => {
				const file = e.target.files && e.target.files[0];
				e.target.value = "";
				if (!file) return;
				const guessed = (file.name || "imported").replace(/\.(md|markdown|txt)$/i, "").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 64) || "imported";
				const reader = new FileReader();
				reader.onload = () => guard(() => setDialog({ kind: "import", id: guessed, content: String(reader.result || "") }));
				reader.onerror = () => err("read failed");
				reader.readAsText(file, "utf-8");
			}, [err, guard]);

			const sets = (st && st.prompts) || [];
			const needle = filter.trim().toLowerCase();
			const shown = needle
				? sets.filter((s) => s.id.toLowerCase().includes(needle) || String(s.preview || "").toLowerCase().includes(needle))
				: sets;
			const totalTokens = sets.reduce((n, s) => n + (s.tokens || 0), 0);

			return h("section", { className: "dshp-panel", "aria-label": t("prompts.title") },
				h("div", { className: "dshp-head" },
					h("h3", { className: "dshp-title" }, t("prompts.title")),
					h("div", { className: "dshp-row", style: { margin: 0 } },
						noticeNode(notice),
						h(Btn, { tiny: true, kind: "danger", disabled: busy || !(st && st.attached), onClick: () => run(apiPost("/dsh-purge/prompts/off"), () => ok(tRef.current("ok.done"))) }, t("prompts.turnOff")),
					),
				),
				h("div", { className: "dshp-row", style: { marginBottom: 10 } },
					st ? h("span", { className: "dshp-pill " + (st.attached ? "is-ok" : "is-miss") },
						st.attached ? t("prompts.attached") : t("prompts.detached")) : null,
					st && st.attached && st.active && !st.synced ? h("span", { className: "dshp-pill is-wait" }, t("prompts.unsynced")) : null,
					st ? h("span", { className: "dshp-count" }, t("prompts.count", { n: sets.length }) + " · " + t("prompts.totalTokens", { n: formatNum(totalTokens) })) : null,
				),
				h("div", { className: "dshp-row", style: { marginBottom: 10 } },
					h("input", {
						className: "dshp-field", value: filter, placeholder: t("prompts.search"), spellCheck: false,
						style: { minWidth: 200, flex: "1 1 200px" },
						onChange: (e) => setFilter(e.target.value),
					}),
					h(Btn, { tiny: true, kind: "primary", disabled: busy, onClick: () => guard(() => setDialog({ kind: "create", id: "" })) }, t("prompts.new")),
					h(Btn, { tiny: true, disabled: busy, onClick: () => fileRef.current && fileRef.current.click() }, t("prompts.import")),
					h("input", { ref: fileRef, type: "file", accept: ".md,.markdown,.txt,text/markdown,text/plain", style: { display: "none" }, onChange: onPickFile }),
				),
				!st ? h("div", { className: "dshp-skel", style: { height: 90 } }) : null,
				st && shown.length === 0 ? h("p", { className: "dshp-empty" }, sets.length === 0 ? t("prompts.none") : t("prompts.noMatch")) : null,
				st && shown.length > 0 ? h("div", { className: "dshp-plist" },
					shown.map((row) => {
						const isActive = st.active === row.id;
						const isEdit = editId === row.id;
						return h("div", {
							key: row.id,
							className: "dshp-pitem" + (isEdit ? " is-edit" : ""),
							role: "button", tabIndex: 0,
							onClick: () => openSet(row.id),
							onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSet(row.id); } },
						},
							h("div", { className: "dshp-pitem-main" },
								h("span", { className: "dshp-pitem-name" },
									isActive ? h("span", { title: t("prompts.inUse"), style: { color: "var(--dshp-accent)" } }, "★") : null,
									row.id,
									isActive ? h("span", { className: "dshp-pill is-ok" }, t("prompts.inUse")) : null,
									isEdit && dirty ? h("span", { className: "dshp-pill is-wait" }, t("prompts.unsaved")) : null,
								),
								h("span", { className: "dshp-pitem-meta" }, t("prompts.stats", {
									size: formatSize(row.bytes != null ? row.bytes : row.size),
									tok: formatNum(row.tokens || 0),
									lines: formatNum(row.lines || 0),
								})),
								row.preview ? h("span", { className: "dshp-pitem-prev", title: row.preview }, row.preview) : null,
							),
							h("div", { className: "dshp-pitem-ops" },
								h(Btn, {
									tiny: true, kind: isActive ? undefined : "primary", disabled: busy || isActive,
									onClick: (e) => { e.stopPropagation(); if (!isActive) useSet(row.id); },
								}, isActive ? t("prompts.inUse") : t("prompts.use")),
								h(Btn, { tiny: true, disabled: busy, onClick: (e) => { e.stopPropagation(); doPreview(row.id); } }, t("prompts.preview")),
								h(Btn, { tiny: true, disabled: busy, onClick: (e) => { e.stopPropagation(); guard(() => setDialog({ kind: "copy", id: row.id, value: row.id + "-copy" })); } }, t("prompts.copy")),
								h(Btn, { tiny: true, disabled: busy, onClick: (e) => { e.stopPropagation(); guard(() => setDialog({ kind: "rename", id: row.id, value: row.id })); } }, t("prompts.rename")),
								h(Btn, { tiny: true, disabled: busy, onClick: (e) => { e.stopPropagation(); doExport(row.id); } }, t("prompts.export")),
								h(Btn, { tiny: true, kind: "danger", disabled: busy, onClick: (e) => { e.stopPropagation(); doDelete(row); } }, t("prompts.delete")),
							),
						);
					}),
				) : null,
				h(TabHint, null, t("prompts.hint")),
				st ? h("p", { className: "dshp-note" }, t("prompts.pathLabel") + " " + (st.dir || "") + "（生效文件 " + (st.inject_path || "") + "）") : null,

				h("div", { className: "dshp-sub" },
					h("h4", null, editId ? t("ed.title", { id: editId }) : t("tab.prompts")),
					h("div", { className: "dshp-row", style: { margin: 0 } },
						h("span", { className: "dshp-stats" },
							editId === null ? "" : textMeta(t, content) + " · " + (dirty ? t("ed.dirty") : t("ed.clean"))),
						h(Btn, { tiny: true, kind: "primary", disabled: busy || !dirty, onClick: () => run(saveEditor(false)) }, t("ed.save")),
						h(Btn, {
							tiny: true, disabled: busy || !dirty,
							onClick: () => { if (window.confirm(tRef.current("ed.discard.confirm", { id: editId }))) setContent(original); },
						}, t("ed.discard")),
					),
				),
				editId ? h(CodeEditor, { value: content, onChange: setContent }) : h("div", { className: "dshp-editor-empty" }, t("ed.pick")),

				dialog ? h(NameDialog, {
					title: dialog.kind === "create" ? t("prompts.new")
						: dialog.kind === "copy" ? t("prompts.copyLabel")
						: dialog.kind === "rename" ? t("prompts.renameLabel")
						: t("prompts.importLabel"),
					initial: dialog.value || dialog.id || "",
					placeholder: dialog.kind === "create" ? t("prompts.nameLabel") : "",
					busy,
					onClose: () => setDialog(null),
					onOk: (value) => {
						const kind = dialog.kind;

						const done = () => setDialog(null);
						if (kind === "create") run(apiPost("/dsh-purge/prompts/create", { id: value }), (d) => { done(); setEditId(value); setContent(""); setOriginal(""); ok(tRef.current("ok.done")); });
						else if (kind === "copy") run(apiPost("/dsh-purge/prompts/duplicate", { id: dialog.id, newId: value }), (d) => { done(); ok(tRef.current("ok.done")); });
						else if (kind === "rename") run(apiPost("/dsh-purge/prompts/rename", { id: dialog.id, newId: value }), (d) => {
							done();
							ok(tRef.current("ok.done"));
							if (editId === dialog.id) { setEditId(value); }
						});
						else run(apiPost("/dsh-purge/prompts/import", { id: value, content: dialog.content }), (d) => { done(); ok(tRef.current("prompts.imported", { id: value })); });

					},
				}) : null,
				preview ? h(Modal, {
					title: preview.id,
					onClose: () => setPreview(null),
					footer: h(Btn, { tiny: true, onClick: () => setPreview(null) }, t("btn.close")),
				},
					h("div", { className: "dshp-stats" }, textMeta(t, preview.content)),
					h("pre", null, preview.content),
				) : null,
			);
		}

		// ── 规则 ──────────────────────────────────────────────────────
		function ruleLabel(r) {
			if (!r) return "";
			if (r.name !== r.id) return r.name + " (" + r.id + ")";
			return r.id;
		}

		function RulesTab() {
			const t = useT();
			const tRef = useRef(t);
			tRef.current = t;
			const [st, setSt] = useState(null);
			const [editId, setEditId] = useState(null);
			const [editName, setEditName] = useState("");
			const [editTarget, setEditTarget] = useState("AGENTS.md");
			const [content, setContent] = useState("");
			const [newId, setNewId] = useState("");
			const [newName, setNewName] = useState("");
			const [newTarget, setNewTarget] = useState("AGENTS.md");
			const [busy, setBusy] = useState(false);
			const [notice, setNotice] = useState({ kind: "idle", text: "" });

			const loadStatus = useCallback(() => {
				const tr = tRef.current;
				apiJson("/dsh-purge/rules/status")
					.then((d) => {
						if (d && d.ok) setSt(d);
						else {
							setSt({ ok: false, rules: [], active: null });
							setNotice({ kind: "error", text: tr("err.rules", { error: (d && d.error) || "bad response" }) });
						}
					})
					.catch((e) => {
						setSt({ ok: false, rules: [], active: null });
						setNotice({ kind: "error", text: tr("err.rules", { error: e.message }) });
					});
			}, []);

			useEffect(() => { loadStatus(); }, [loadStatus]);

			const doPost = useCallback((action, payload, after) => {
				setBusy(true);
				setNotice({ kind: "idle", text: "" });
				apiPost("/dsh-purge/rules/" + action, payload)
					.then((d) => {
						if (d && d.ok) {
							setNotice({ kind: "ok", text: tRef.current("ok.done") });
							loadStatus();
							if (after) after();
						} else {
							setNotice({ kind: "error", text: tRef.current("err.action", { error: (d && d.error) || "" }) });
						}
					})
					.catch((e) => setNotice({ kind: "error", text: tRef.current("err.action", { error: e.message }) }))
					.finally(() => setBusy(false));
			}, [loadStatus]);

			const openRule = useCallback((id) => {
				setBusy(true);
				apiJson("/dsh-purge/rules/read?id=" + encodeURIComponent(id))
					.then((d) => {
						if (d && d.ok) {
							setEditId(id);
							setEditName(d.name || id);
							setEditTarget(d.target || "AGENTS.md");
							setContent(d.content || "");
						} else setNotice({ kind: "error", text: tRef.current("err.read", { error: (d && d.error) || "" }) });
					})
					.catch((e) => setNotice({ kind: "error", text: tRef.current("err.read", { error: e.message }) }))
					.finally(() => setBusy(false));
			}, []);

			const clearEditor = () => {
				setEditId(null);
				setEditName("");
				setEditTarget("AGENTS.md");
				setContent("");
			};

			let list;
			if (!st) {
				list = h("div", { className: "dshp-skel", style: { height: 80, margin: 12 } });
			} else if (!st.rules || st.rules.length === 0) {
				list = h("p", { className: "dshp-empty" }, t("rules.empty"));
			} else {
				list = st.rules.map((r) => {
					const isActive = r.id === st.active;
					const isEdit = r.id === editId;
					return h("div", {
						key: r.id,
						className: "dshp-ruleitem" + (isEdit ? " is-edit" : ""),
						role: "button",
						tabIndex: 0,
						onClick: () => openRule(r.id),
						onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openRule(r.id); } },
					},
						h("div", { className: "dshp-rule-main" },
							h("span", { className: "dshp-rule-name" },
								ruleLabel(r),
								isActive ? h("span", { className: "dshp-pill is-ok" }, t("pill.current")) : null,
							),
							h("span", { className: "dshp-rule-meta" }, r.target + " · " + formatSize(r.size)),
						),
						h("div", { className: "dshp-rule-ops" },
							h(Btn, {
								tiny: true,
								kind: isActive ? undefined : "primary",
								disabled: busy || isActive,
								onClick: (e) => {
									e.stopPropagation();
									if (!isActive) doPost("activate", { id: r.id });
								},
							}, isActive ? t("btn.inUse") : t("btn.use")),
							h(Btn, {
								tiny: true,
								kind: "danger",
								disabled: busy,
								onClick: (e) => {
									e.stopPropagation();
									if (!window.confirm(t("confirm.delete", { id: r.id }))) return;
									if (editId === r.id) clearEditor();
									doPost("delete", { id: r.id });
								},
							}, t("delete")),
						),
					);
				});
			}

			return h("section", { className: "dshp-panel", "aria-label": t("rules.title") },
				h("div", { className: "dshp-head" },
					h("h3", { className: "dshp-title" }, t("rules.title")),
					h("div", { className: "dshp-row", style: { margin: 0 } },
						noticeNode(notice),
						h(Btn, {
							tiny: true,
							kind: "danger",
							disabled: busy,
							onClick: () => {
								if (!window.confirm(t("rules.reset.confirm"))) return;
								clearEditor();
								doPost("reset", {});
							},
						}, t("rules.reset")),
					),
				),
				h(TabHint, null, t("rules.hint")),
				h("div", { className: "dshp-split", style: { marginTop: 12 } },
					h("div", { className: "dshp-rulelist" },
						h("div", { className: "dshp-rulebody" }, list),
						h("div", { className: "dshp-create" },
							h("div", { className: "dshp-create-row" },
								h("input", { className: "dshp-field", placeholder: t("ph.id"), value: newId, onChange: (e) => setNewId(e.target.value) }),
								h("input", { className: "dshp-field", placeholder: t("ph.alias"), value: newName, onChange: (e) => setNewName(e.target.value) }),
								h("select", { className: "dshp-field", style: { minWidth: 120, flex: "0 0 auto" }, value: newTarget, onChange: (e) => setNewTarget(e.target.value) },
									TARGETS.map((x) => h("option", { key: x, value: x }, x))),
								h(Btn, {
									kind: "primary",
									tiny: true,
									disabled: busy,
									onClick: () => {
										const id = newId.trim();
										if (!id) { setNotice({ kind: "error", text: t("need.id") }); return; }
										const nm = newName.trim() || id;
										const target = newTarget;
										doPost("save", { id, content: "", name: nm, target }, () => {
											setEditId(id);
											setEditName(nm);
											setEditTarget(target);
											setContent("");
										});
										setNewId(""); setNewName(""); setNewTarget("AGENTS.md");
									},
								}, t("btn.create")),
							),
						),
					),
					h("div", { className: "dshp-editor" },
						editId ? [
							h("div", { key: "meta", className: "dshp-row" },
								h("input", {
									className: "dshp-field", placeholder: t("ph.alias.short"), value: editName,
									onChange: (e) => setEditName(e.target.value),
								}),
								h("select", {
									className: "dshp-field", style: { minWidth: 120 }, value: editTarget,
									onChange: (e) => setEditTarget(e.target.value),
								}, TARGETS.map((x) => h("option", { key: x, value: x }, x))),
							),
							h("textarea", {
								key: "body",
								className: "dshp-area", value: content,
								onChange: (e) => setContent(e.target.value),
								placeholder: "",
							}),
							h("div", { key: "save", className: "dshp-row" },
								h(Btn, {
									kind: "primary",
									disabled: busy,
									onClick: () => doPost("save", { id: editId, content, name: editName, target: editTarget }),
								}, t("btn.saveRule")),
								noticeNode(notice),
							),
						] : h("div", { className: "dshp-editor-empty" }, t("rules.pick")),
					),
				),
			);
		}

		// ── 沙箱 & 门禁 ───────────────────────────────────────────────
		function SandboxTab() {
			const t = useT();
			const tRef = useRef(t);
			tRef.current = t;
			const [state, setState] = useState(null);
			const [rulesSt, setRulesSt] = useState(null);
			const [busy, setBusy] = useState(false);
			const [notice, setNotice] = useState({ kind: "idle", text: "" });

			const load = useCallback(() => {
				const tr = tRef.current;
				apiJson("/dsh-purge/status")
					.then((d) => { if (d && d.ok) setState(d); else setNotice({ kind: "error", text: tr("err.status", { error: (d && d.error) || "" }) }); })
					.catch((e) => setNotice({ kind: "error", text: tr("err.status", { error: e.message }) }));
				apiJson("/dsh-purge/rules/status")
					.then((d) => { if (d && d.ok) setRulesSt(d); })
					.catch(() => {});
			}, []);

			useEffect(() => { load(); }, [load]);

			const toggleGroup = useCallback((groupName, enabled) => {
				setBusy(true);
				setNotice({ kind: "idle", text: "" });
				apiPost("/dsh-purge/group", { name: groupName, enabled })
					.then((d) => {
						if (d && d.ok) {
							load();
							setNotice({ kind: "ok", text: tRef.current("ok.done") + " · " + tRef.current("err.needRestart") });
						} else setNotice({ kind: "error", text: (d && d.error) || "failed" });
					})
					.catch((e) => setNotice({ kind: "error", text: e.message }))
					.finally(() => setBusy(false));
			}, [load]);

			return h("section", { className: "dshp-panel", "aria-label": t("sandbox.title") },
				h("h3", { className: "dshp-title", style: { marginBottom: 12 } }, t("sandbox.title")),
				h(GroupSwitches, { state, busy, onToggle: toggleGroup, only: ["sandbox", "approval"] }),
				h("div", { className: "dshp-card" },
					h("p", { className: "dshp-body" }, t("sandbox.desc")),
					h("p", { className: "dshp-note", style: { color: "var(--dshp-warn)" } }, t("sandbox.warn")),
				),
				h("div", { className: "dshp-sub" }, h("h4", null, t("sandbox.patches"))),
				h(PatchGroups, { state, only: ["sandbox", "approval"] }),
				h("div", { className: "dshp-sub" }, h("h4", null, t("gate.title"))),
				h("div", { className: "dshp-card" },
					h(KeyValue, { rows: [
						[t("gate.rules"), rulesSt && rulesSt.active ? rulesSt.active : t("rules.none")],
						[t("gate.target"), rulesSt ? rulesSt.agents_path : "—"],
						[t("gate.state"), rulesSt
							? (rulesSt.agents_exists ? (rulesSt.agents_synced ? t("gate.yes") : t("gate.skipped")) : t("gate.no"))
							: "—"],
						[t("gate.where"), rulesSt ? rulesSt.rules_dir : "—"],
						[t("gate.pending"), t("skip")],
					] }),
					h("p", { className: "dshp-note" }, t("gate.desc")),
					noticeNode(notice),
				),
			);
		}

		// ── 插件管理器（D1-D3）───────────────────────────────────────

		const KIND_KEY = { official: "plugins.kind.official", junction: "plugins.kind.junction", npm: "plugins.kind.npm", missing: "plugins.kind.missing" };

		function copyText(text) {
			try {
				if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(text); return true; }
			} catch { /* 不行就算了 */ }
			return false;
		}

		/** 服务器给的是 Windows 绝对路径；浏览器里没有 path.sep，自己劈。 */
		function relTail(base, fp) {
			const rel = String(fp || "").slice(String(base || "").length).replace(/^[\\/]+/, "");
			return rel.split(/[\\/]/).join("/");
		}

		// 文件树（插件自己的目录 / 只读）
		function TreeNodeView({ nodes, pad }) {
			const t = useT();
			return nodes.map((n, i) => h("div", { key: (n.rel || n.name) + i },
				h("div", { className: "dshp-tnode" },
					h("span", { className: "dshp-tmark" }, n.type === "dir" ? "▸" : n.type === "link" ? "↗" : " "),
					h("span", { className: n.type === "dir" ? "dshp-tname is-dir" : "dshp-tname" }, n.name),
					n.type === "file" ? h("span", { className: "dshp-tsize" }, formatSize(n.size)) : null,
					n.collapsed ? h("span", { className: "dshp-tsize" }, t("plugins.treeCollapsed", { n: n.children_count })) : null,
				),
				n.children && n.children.length ? h("div", { style: { marginLeft: 12 } }, h(TreeNodeView, { nodes: n.children, pad: pad + 1 })) : null,
			));
		}

		function DiffView({ data }) {
			const t = useT();
			if (!data) return h("div", { className: "dshp-skel", style: { height: 120 } });
			if (data.identical) return h("p", { className: "dshp-body" }, t("plugins.diff.identical"));
			return h("div", null,
				h("div", { className: "dshp-stats", style: { marginBottom: 8 } },
					t("plugins.diff.stats", {
						before: formatSize(data.before_bytes),
						after: formatSize(data.after_bytes),
						add: String(data.added),
						del: String(data.removed),
					})),
				data.hunks.map((hk, i) => h("div", { key: i, className: "dshp-hunk" },
					h("div", { className: "dshp-hunk-h" }, "@@ -" + hk.old_start + " +" + hk.new_start + " @@"),
					hk.rows.map((r, j) => h("div", { key: j, className: "dshp-drow is-" + r.type },
						h("span", { className: "dshp-dln" }, (r.old === null ? "" : r.old) + "\u2007"),
						h("span", { className: "dshp-dln" }, (r.new === null ? "" : r.new) + "\u2007"),
						h("span", { className: "dshp-dmark" }, r.type === "add" ? "+" : r.type === "del" ? "-" : " "),
						h("span", { className: "dshp-dtext" }, r.text || " "),
					)),
				)),
			);
		}

		function PluginCard({ plugin, tree, treeLoading, changed, onClose, onDiff }) {
			const t = useT();
			const rows = [
				[t("plugins.kind"), t(KIND_KEY[plugin.kind] || plugin.kind)],
				[t("plugins.card.location"), plugin.path],
				[t("plugins.card.realPath"), plugin.real_path],
				[t("plugins.card.version"), plugin.version || "—"],
				[t("plugins.card.target"), plugin.dsh_target || "—"],
				[t("plugins.card.client"), plugin.has_client ? t("yes") : t("no")],
				plugin.bundle_patch ? [t("plugins.card.bundle"), plugin.bundle_patch] : null,
				plugin.description ? [t("plugins.card.desc"), plugin.description] : null,
			].filter(Boolean);
			return h(Modal, {
				title: plugin.name,
				onClose,
				footer: h(Btn, { tiny: true, onClick: onClose }, t("btn.close")),
			},
				h("div", { className: "dshp-kv-tree" }, h(KeyValue, { rows })),
				h("div", { className: "dshp-row", style: { marginTop: 0 } },
					h(Btn, { tiny: true, onClick: (e) => { e.stopPropagation(); if (copyText(plugin.real_path || plugin.path)) { /* 静默成功 */ } } }, t("plugins.copyPath")),
				),
				h("div", { className: "dshp-sub", style: { marginTop: 4 } },
					h("h4", null, t("plugins.card.tree")),
					h("span", { className: "dshp-count" }, tree ? t("plugins.card.treeMeta", { n: tree.entries }) + (tree.truncated ? " · " + t("plugins.truncated") : "") : ""),
				),
				treeLoading ? h("div", { className: "dshp-skel", style: { height: 90 } })
					: tree ? h("div", { className: "dshp-tree" }, h(TreeNodeView, { nodes: tree.nodes, pad: 0 }))
						: h("p", { className: "dshp-note" }, t("plugins.treeMissing")),
				h("p", { className: "dshp-note" }, t("plugins.card.treeHint")),
				h("div", { className: "dshp-sub", style: { marginTop: 4 } },
					h("h4", null, t("plugins.card.changed")),
					h("span", { className: "dshp-count" }, changed.length ? String(changed.length) : t("plugins.noChanges")),
				),
				changed.length === 0 ? h("p", { className: "dshp-note" }, t("plugins.noChangesHint"))
					: h("div", { className: "dshp-tree" }, changed.map((f, i) => h("div", { key: i, className: "dshp-tnode" },
						h("span", { className: "dshp-tmark" }, "✎"),
						h("span", { className: "dshp-tname" }, f.pkg + (f.pkg_version ? "@" + f.pkg_version : "") + " / " + f.rel),
						h(Btn, { tiny: true, onClick: () => onDiff(f.path) }, t("plugins.diff")),
					))),
			);
		}

		function PluginsTab() {
			const t = useT();
			const tRef = useRef(t);
			tRef.current = t;
			const [ov, setOv] = useState(null);
			const [err0, setErr0] = useState("");
			const [busy, setBusy] = useState(false);
			const [card, setCard] = useState(null); // {plugin, tree, loading}
			const [diff, setDiff] = useState(null); // {path, data, error}
			const [openPkg, setOpenPkg] = useState({});

			const load = useCallback((force) => {
				const tr = tRef.current;
				setBusy(true);
				setErr0("");
				apiJson("/dsh-purge/plugins" + (force ? "?force=1" : ""))
					.then((d) => { if (d && d.ok) setOv(d); else setErr0(tr("err.status", { error: (d && d.error) || "" })); })
					.catch((e) => setErr0(tr("err.status", { error: e.message })))
					.finally(() => setBusy(false));
			}, []);

			useEffect(() => { load(false); }, [load]);

			const openCard = useCallback((plugin) => {
				setCard({ plugin, tree: null, loading: true });
				apiJson("/dsh-purge/plugins/tree?name=" + encodeURIComponent(plugin.name) + "&depth=3")
					.then((d) => {
						if (d && d.ok) setCard((prev) => (prev && prev.plugin.name === plugin.name ? { plugin, tree: d, loading: false } : prev));
						else setCard((prev) => (prev && prev.plugin.name === plugin.name ? { plugin, tree: null, loading: false, error: (d && d.error) || "" } : prev));
					})
					.catch(() => setCard((prev) => (prev ? { ...prev, loading: false } : prev)));
			}, []);

			const openDiff = useCallback((path) => {
				setDiff({ path, data: null, error: "" });
				apiJson("/dsh-purge/plugins/diff?path=" + encodeURIComponent(path))
					.then((d) => { if (d && d.ok) setDiff({ path, data: d, error: "" }); else setDiff({ path, data: null, error: (d && d.error) || "" }); })
					.catch((e) => setDiff({ path, data: null, error: e.message }));
			}, []);

			const plugins = (ov && ov.plugins) || [];
			// 卡片里"它改了哪些"要扁平成一行行文件
			const changedRows = useMemo(() => {
				if (!card || !ov) return [];
				const byOwner = (ov.plugins.find((p) => p.name === card.plugin.name) || {}).changed_by_it || 0;
				if (!byOwner) return [];
				return ov.changed.packages.flatMap((g) => g.paths.map((p) => ({ pkg: g.name, pkg_version: g.version, path: p, rel: relTail(g.dir, p) })));
			}, [card, ov]);

			return h("section", { className: "dshp-panel", "aria-label": t("plugins.title") },
				h("div", { className: "dshp-head" },
					h("h3", { className: "dshp-title" }, t("plugins.title")),
					h("div", { className: "dshp-row", style: { margin: 0 } },
						ov ? h("span", { className: "dshp-count" }, t("plugins.scanMeta", {
							files: String(ov.changed.total),
							pkgs: String(ov.changed.packages.length),
							dirs: String(ov.scanned_dirs),
						})) : null,
						h(Btn, { tiny: true, disabled: busy, onClick: () => load(true) }, busy ? t("plugins.scanning") : t("plugins.rescan")),
					),
				),
				h(TabHint, null, t("plugins.hint")),
				err0 ? h("div", { className: "dshp-notice is-bad", style: { marginTop: 8 } }, err0) : null,
				!ov && !err0 ? h("div", { className: "dshp-skel", style: { height: 130 } }) : null,

				ov ? h("div", { style: { marginTop: 12 } },
					h("div", { className: "dshp-sub", style: { marginTop: 0 } },
						h("h4", null, t("plugins.list")),
						h("span", { className: "dshp-count" }, t("plugins.profile", { name: ov.profile.name || "?" }) + (ov.truncated ? " · " + t("plugins.truncated") : "")),
					),
					h("div", { className: "dshp-plist" }, plugins.map((p) => h("div", {
						key: p.name, className: "dshp-pitem", role: "button", tabIndex: 0,
						onClick: () => openCard(p),
						onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCard(p); } },
					},
						h("div", { className: "dshp-pitem-main" },
							h("span", { className: "dshp-pitem-name" }, p.name,
								h("span", { className: "dshp-tag" }, t(KIND_KEY[p.kind] || p.kind)),
								p.in_bundles ? null : h("span", { className: "dshp-tag" }, t("plugins.depOnly")),
							),
							h("span", { className: "dshp-pitem-meta" }, (p.version || "—") + " · " + t(KIND_KEY[p.kind] || p.kind) + " · " + (p.real_path || p.path || "—")),
						),
						h("div", { className: "dshp-pitem-ops" },
							p.changed_by_it
								? h("span", { className: "dshp-pill is-ok", title: t("plugins.changedBy", { n: p.changed_by_it }) }, t("plugins.changedByShort", { n: p.changed_by_it }))
								: p.changed_in_it
									? h("span", { className: "dshp-pill is-wait", title: t("plugins.changedIn", { n: p.changed_in_it }) }, t("plugins.changedInShort", { n: p.changed_in_it }))
									: h("span", { className: "dshp-pill is-miss" }, t("plugins.noChangesShort")),
						),
					))),

					h("div", { className: "dshp-sub" }, h("h4", null, t("plugins.changed.title"))),
					h("p", { className: "dshp-note", style: { marginBottom: 8 } },
						ov.changed.total
							? t("plugins.changed.summary", { files: String(ov.changed.total), pkgs: String(ov.changed.packages.length), owner: Object.keys(ov.changed.by_owner).join(", ") })
							: t("plugins.changed.none")),
					h("div", null, ov.changed.packages.map((g) => {
						const open = openPkg[g.dir] !== undefined ? !!openPkg[g.dir] : g.files > 1;
						return h("div", { key: g.dir, className: "dshp-group" },
							h("button", {
								type: "button", className: "dshp-group-h", "aria-expanded": open ? "true" : "false",
								onClick: () => setOpenPkg((prev) => Object.assign({}, prev, { [g.dir]: !open })),
							},
								h("strong", null, g.name + (g.version ? "@" + g.version : "")),
								h("span", { className: "dshp-count" }, t("plugins.files", { n: g.files })),
							),
							open ? h("div", { className: "dshp-tree" }, g.paths.map((fp, i) => h("div", { key: i, className: "dshp-tnode" },
								h("span", { className: "dshp-tmark" }, "✎"),
								h("span", { className: "dshp-tname" }, relTail(g.dir, fp)),
								h(Btn, { tiny: true, onClick: () => openDiff(fp) }, t("plugins.diff")),
							))) : null,
						);
					})),

					h("div", { className: "dshp-sub" }, h("h4", null, t("plugins.self.title"))),
					h("div", { className: "dshp-card", style: { marginTop: 0 } },
						ov.self_report.error ? h("p", { className: "dshp-note" }, ov.self_report.error) : null,
						h(KeyValue, { rows: [
							[t("plugins.self.reported"), t("plugins.self.reportedValue", { patches: String(ov.self_report.patch_count), files: String(ov.self_report.reported_files) })],
							[t("plugins.self.scanned"), t("plugins.self.scannedValue", { n: String(ov.self_report.scanned_files) })],
							[t("plugins.self.onlyReported"), ov.self_report.only_reported.length ? String(ov.self_report.only_reported.length) : t("plugins.self.none")],
							[t("plugins.self.onlyScanned"), ov.self_report.only_scanned.length ? String(ov.self_report.only_scanned.length) : t("plugins.self.none")],
						] }),
						ov.self_report.only_scanned.length ? h("div", null,
							h("p", { className: "dshp-note" }, t("plugins.self.onlyScannedHint")),
							ov.self_report.only_scanned.map((fp, i) => h("div", { key: i, className: "dshp-tnode" },
								h("span", { className: "dshp-tmark" }, "!"),
								h("span", { className: "dshp-tname" }, fp),
							)),
						) : null,
					),
				) : null,

				card ? h(PluginCard, {
					plugin: card.plugin,
					tree: card.tree,
					treeLoading: card.loading,
					changed: changedRows,
					onClose: () => setCard(null),
					onDiff: openDiff,
				}) : null,
				diff ? h(Modal, {
					title: t("plugins.diff.title") + (ov ? "" : ""),
					onClose: () => setDiff(null),
					footer: h(Btn, { tiny: true, onClick: () => setDiff(null) }, t("btn.close")),
				},
					h("div", { className: "dshp-stats" }, diff.path),
					diff.error ? h("div", { className: "dshp-notice is-bad" }, diff.error) : h(DiffView, { data: diff.data }),
				) : null,
			);
		}

		// ── 高级（B3 / B7）───────────────────────────────────────────
		function AdvancedTab() {
			const t = useT();
			const tRef = useRef(t);
			tRef.current = t;
			const [cfg, setCfg] = useState(null);
			const [status, setStatus] = useState(null);
			const [busy, setBusy] = useState(false);
			const [notice, setNotice] = useState({ kind: "idle", text: "" });

			const load = useCallback(() => {
				const tr = tRef.current;
				apiJson("/dsh-purge/config")
					.then((d) => { if (d && d.ok) setCfg(d); else setNotice({ kind: "error", text: tr("err.config", { error: (d && d.error) || "" }) }); })
					.catch((e) => setNotice({ kind: "error", text: tr("err.config", { error: e.message }) }));
				apiJson("/dsh-purge/status")
					.then((d) => { if (d && d.ok) setStatus(d); })
					.catch(() => {});
			}, []);

			useEffect(() => { load(); }, [load]);

			const setSwitch = useCallback((key, value) => {
				setBusy(true);
				setNotice({ kind: "idle", text: "" });
				const payload = {};
				payload[key] = value;
				apiPost("/dsh-purge/config", payload)
					.then((d) => {
						if (d && d.ok) {
							setCfg(d);
							setNotice({ kind: "ok", text: tRef.current("adv.saved") + (key === "autoApplyOnStart" ? " · " + tRef.current("err.needRestart") : "") });
						} else setNotice({ kind: "error", text: (d && d.error) || "failed" });
					})
					.catch((e) => setNotice({ kind: "error", text: e.message }))
					.finally(() => setBusy(false));
			}, []);

			const shimOn = shimHidden(status);
			const toggleShim = useCallback((next) => {
				setBusy(true);
				setNotice({ kind: "idle", text: "" });
				apiPost("/dsh-purge/shim", { enabled: next })
					.then((d) => {
						if (d && d.ok) {
							setStatus((prev) => Object.assign({}, prev, { shim_cmd: d.shim_cmd, shim_ps1: d.shim_ps1, shim_bin: d.shim_bin }));
							setNotice({ kind: "ok", text: (d.note || tRef.current("ok.done")) });
						} else setNotice({ kind: "error", text: (d && d.error) || "failed" });
					})
					.catch((e) => setNotice({ kind: "error", text: e.message }))
					.finally(() => setBusy(false));
			}, []);

			const setIdentity = useCallback((mode) => {
				const tr = tRef.current;
				if (!cfg || !cfg.identity || cfg.identity.mode === mode) return;
				if (!window.confirm(tr("adv.identity.confirm", { mode: tr("adv.identity." + mode) }))) return;
				setBusy(true);
				setNotice({ kind: "idle", text: "" });
				apiPost("/dsh-purge/identity", { mode })
					.then((d) => {
						if (d && d.ok) {
							load();
							setNotice({ kind: "ok", text: tr("adv.identity.done", { mode: tr("adv.identity." + mode) }) });
						} else setNotice({ kind: "error", text: (d && d.error) || "failed" });
					})
					.catch((e) => setNotice({ kind: "error", text: e.message }))
					.finally(() => setBusy(false));
			}, [cfg, load]);

			const mode = (cfg && cfg.identity && cfg.identity.mode) || "purge";
			const srcTag = (key) => (cfg && cfg.source && cfg.source[key] === "saved" ? t("adv.source.saved") : t("adv.source.yml"));

			return h("section", { className: "dshp-panel", "aria-label": t("tab.advanced") },
				h("div", { className: "dshp-head" },
					h("h3", { className: "dshp-title" }, t("adv.config")),
					h("div", { className: "dshp-row", style: { margin: 0 } }, noticeNode(notice)),
				),
				!cfg ? h("div", { className: "dshp-skel", style: { height: 120 } }) : [
					h(SwitchRow, {
						key: "enabled",
						title: t("adv.enabled"), desc: t("adv.enabled.desc"), tag: srcTag("enabled"),
						value: !!cfg.enabled, onLabel: t("switch.on"), offLabel: t("switch.off"),
						busy, onToggle: (v) => setSwitch("enabled", v),
						extra: h("p", { className: "dshp-note" }, t("adv.enabled.hard")),
					}),
					h(SwitchRow, {
						key: "auto",
						title: t("adv.autoApply"), desc: t("adv.autoApply.desc"), tag: srcTag("autoApplyOnStart"),
						value: !!cfg.autoApplyOnStart, onLabel: t("switch.on"), offLabel: t("switch.off"),
						busy, onToggle: (v) => setSwitch("autoApplyOnStart", v),
					}),
					h(SwitchRow, {
						key: "verbose",
						title: t("adv.verbose"), desc: t("adv.verbose.desc"), tag: srcTag("verbose"),
						value: !!cfg.verbose, onLabel: t("switch.on"), offLabel: t("switch.off"),
						busy, onToggle: (v) => setSwitch("verbose", v),
					}),
					h(SwitchRow, {
						key: "shim",
						title: t("adv.shim"), desc: t("adv.shim.desc"),
						tag: status ? (shimOn ? t("adv.shim.on") : t("adv.shim.off")) : "",
						value: shimOn, onLabel: t("adv.shim.on"), offLabel: t("adv.shim.off"),
						busy: busy || !status,
						onToggle: (v) => toggleShim(v),
						extra: status ? h("div", null,
							h("div", { className: "dshp-row", style: { marginTop: 6 } },
								h("span", { className: "dshp-pill is-" + shimKind(status.shim_cmd) }, "cmd"),
								h("span", { className: "dshp-pill is-" + shimKind(status.shim_ps1) }, "ps1"),
								h("span", { className: "dshp-pill is-" + shimKind(status.shim_bin || "missing") }, "unix"),
							),
							h("p", { className: "dshp-note" }, t("adv.shim.cmdNote")),
						) : null,
					}),
					h("div", { className: "dshp-sub" }, h("h4", null, t("adv.identity"))),
					h("div", { className: "dshp-switchrow", style: { alignItems: "flex-start", flexDirection: "column" } },
						h("div", { className: "dshp-row", style: { margin: 0 } },
							h("div", { className: "dshp-seg", role: "group" },
								["purge", "official", "none"].map((m) => h("button", {
									key: m, type: "button", className: mode === m ? "is-on" : "",
									disabled: busy, onClick: () => setIdentity(m),
								}, t("adv.identity." + m))),
							),
							h("span", { className: "dshp-count" }, t("adv.identity.current", { mode: t("adv.identity." + mode) })),
						),
						h("em", null, t("adv.identity.desc." + mode)),
						h("p", { className: "dshp-note" }, t("adv.identity.hint")),
					),
					h("div", { className: "dshp-sub" }, h("h4", null, t("adv.paths"))),
					h("div", { className: "dshp-card" },
						h(KeyValue, { rows: [
							[t("plugins.config"), cfg.config_path],
							[t("plugins.yml"), cfg.patch_yml],
							[t("plugins.root"), cfg.plugin_root],
							[t("plugins.home"), status && status.dsh_home],
							[t("plugins.inject"), status && status.override_path],
						] }),
					),
					h("p", { className: "dshp-note" }, t("adv.config.hint", { path: cfg.config_path || "" })),
				],
			);
		}

		function waitForRestart(setNotice, setBusy, t) {
			const started = Date.now();
			const ping = () => {
				fetch("/dsh-purge/status", { cache: "no-store" })
					.then((r) => { if (r.ok) window.location.reload(); else retry(); })
					.catch(retry);
			};
			const retry = () => {
				if (Date.now() - started > 25000) {
					setNotice({ kind: "error", text: t("restart.timeout") });
					setBusy(false);
					return;
				}
				setTimeout(ping, 400);
			};
			setTimeout(ping, 700);
		}

		function restartDsh(setNotice, setBusy, t) {
			setBusy(true);
			setNotice({ kind: "ok", text: t("restarting") });
			fetch("/dsh-purge/restart", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
				.then((r) => r.json())
				.then((d) => {
					if (!d.ok) throw new Error(d.error || "restart failed");
					waitForRestart(setNotice, setBusy, t);
				})
				.catch((e) => {
					if (String(e.message || e).includes("Failed to fetch") || e.name === "TypeError") {
						waitForRestart(setNotice, setBusy, t);
						return;
					}
					setNotice({ kind: "error", text: t("restart.fail", { error: e.message }) });
					setBusy(false);
				});
		}

		function detectHostTheme() {
			try {
				if (typeof document !== "undefined") {
					if (document.body?.hasAttribute("data-ds-dark-theme")) return "dusk";
					const root = document.documentElement;
					const scheme = (root.style.colorScheme || getComputedStyle(root).getPropertyValue("color-scheme") || "").toLowerCase();
					if (scheme.includes("dark")) return "dusk";
					if (scheme.includes("light")) return "white";
				}
				if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
					return "dusk";
				}
			} catch { /* ignore */ }
			return "white";
		}

		function readTheme() {
			try {
				if (window.localStorage.getItem(THEME_MODE_KEY) === "manual") {
					const v = window.localStorage.getItem(THEME_KEY);
					if (v === "dusk" || v === "white") return v;
				}
			} catch { /* ignore */ }
			return detectHostTheme();
		}

		function readTab() {
			try {
				const v = window.localStorage.getItem(TAB_KEY);
				if (TABS.some((x) => x.id === v)) return v;
			} catch { /* ignore */ }
			return "overview";
		}

		function SettingsRoot(props) {
			const t = typeof props.t === "function" ? props.t : ((key) => key);
			const [theme, setTheme] = useState(readTheme);
			const [tab, setTab] = useState(readTab);
			// 懒挂载：点开过的页留着（切标签不丢未保存的编辑），没点过的不发请求。
			const [seen, setSeen] = useState(() => ({ [readTab()]: true }));
			const setAndStore = useCallback((next) => {
				setTheme(next);
				try {
					window.localStorage.setItem(THEME_MODE_KEY, "manual");
					window.localStorage.setItem(THEME_KEY, next);
				} catch { /* ignore */ }
			}, []);
			const goto = useCallback((next) => {
				setTab(next);
				setSeen((prev) => (prev[next] ? prev : Object.assign({}, prev, { [next]: true })));
				try { window.localStorage.setItem(TAB_KEY, next); } catch { /* ignore */ }
			}, []);
			useEffect(() => {
				let cancelled = false;
				let timer = 0;
				const syncFromHost = () => {
					try {
						if (window.localStorage.getItem(THEME_MODE_KEY) === "manual") return;
					} catch { /* ignore */ }
					if (!cancelled) setTheme(detectHostTheme());
				};
				// Debounce attribute churn so layout style writes don't thrash React state.
				const syncSoon = () => {
					if (timer) window.clearTimeout(timer);
					timer = window.setTimeout(syncFromHost, 50);
				};
				syncFromHost();
				let mq;
				try {
					mq = window.matchMedia?.("(prefers-color-scheme: dark)");
					mq?.addEventListener?.("change", syncFromHost);
				} catch { /* ignore */ }
				let obs;
				try {
					if (document.body) {
						obs = new MutationObserver(syncSoon);
						// Host dark mode is projected onto body; ignore documentElement style noise.
						obs.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
					}
				} catch { /* ignore */ }
				return () => {
					cancelled = true;
					if (timer) window.clearTimeout(timer);
					try { mq?.removeEventListener?.("change", syncFromHost); } catch { /* ignore */ }
					try { obs?.disconnect(); } catch { /* ignore */ }
				};
			}, []);
			translate = t;
			const panes = [
				["overview", h(OverviewTab, { key: "overview", onGoto: goto })],
				["prompts", h(PromptsTab, { key: "prompts" })],
				["rules", h(RulesTab, { key: "rules" })],
				["sandbox", h(SandboxTab, { key: "sandbox" })],
				["plugins", h(PluginsTab, { key: "plugins" })],
				["advanced", h(AdvancedTab, { key: "advanced" })],
			];
			return h("div", { className: "dshp-root", "data-theme": theme },
				h("style", null, PURGE_CSS),
				h("div", { className: "dshp-toolbar" },
					h("div", { className: "dshp-tabs", role: "tablist" },
						TABS.map((x) => h("button", {
							key: x.id,
							type: "button",
							role: "tab",
							"aria-selected": tab === x.id ? "true" : "false",
							className: "dshp-tab" + (tab === x.id ? " is-on" : ""),
							onClick: () => goto(x.id),
						}, t(x.label))),
					),
					h("div", { className: "dshp-switch", role: "group", "aria-label": t("theme.aria") },
						h("button", {
							type: "button",
							className: theme === "white" ? "is-on" : "",
							onClick: () => setAndStore("white"),
						}, t("theme.white")),
						h("button", {
							type: "button",
							className: theme === "dusk" ? "is-on" : "",
							onClick: () => setAndStore("dusk"),
						}, t("theme.ink")),
					),
				),
				panes.filter(([id]) => seen[id]).map(([id, node]) =>
					h("div", { key: id, role: "tabpanel", hidden: tab !== id ? true : undefined, style: { display: tab === id ? "flex" : "none", flexDirection: "column", gap: 16 } }, node),
				),
			);
		}

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-purge: dictionaries");
			const t = ctx.locale.bind(NS);
			translate = t;
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "dsh-purge",
				order: 40,
				label: () => t("nav"),
				locale: NS,
				inject: () => ({ t }),
			}, SettingsRoot));
		}

		exports.name = name;
		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	}
});
