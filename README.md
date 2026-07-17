# SkillPilot

一个本地优先、跨 Agent 的 Skills 管理中心。SkillPilot 将散落在 Claude Code、OpenAI Codex、`.agents`、OpenClaw、Gemini CLI、Cursor 和自定义目录中的 `SKILL.md` 包汇总到一个界面，帮助你减少上下文冗余，并持续维护自己的能力库。

> 本项目基于 Sam Blakeman 的 MIT 开源项目 [Quiver](https://github.com/sam-blakeman/quiver) 扩展而来，复用其 CLI、导入导出、插件市场与 Git 同步基础，并升级为 Windows 桌面应用。

## 主要能力

- 多 Agent 统一索引：内置 6 类扫描目录，并支持任意自定义绝对路径
- 真正启用/停用：停用项会移出 Agent 的扫描目录，从源头降低上下文负担
- 自定义分组：每个 Skill 可加入用户分组，支持分组筛选、单项快捷开关和整组启用/停用
- 批量管理：启用、停用、移至分组、AI 重新维护、安全导出、删除前自动备份
- GitHub 发现与安装：按热门或最近更新搜索，固定不可变 commit，扫描仓库风险，选择具体 Skills 后一键安装到 6 类 Agent
- 自定义 AI：兼容 OpenAI Chat Completions API 和本地 Ollama；AI 分类固定映射到 10 个稳定大类，具体能力保留为标签
- 自动维护：默认覆盖全部已启用本地 Skills，以 1–8 个有界并行任务防止卡死；同一条元数据原位更新，不会重复堆积
- 应用更新检查：启动后检查 Skill-Pilot 的最新 GitHub 正式 Release，设置页可手动刷新并打开可信发布页
- 数据迁移：版本化 JSON 数据库导入导出，导出时自动移除 API 密钥
- 本地安全：仅监听 `127.0.0.1`，限制跨域来源，启用 CSP 等安全响应头
- Windows 桌面端：独立窗口、系统托盘、单实例、窗口状态记忆，不会弹出浏览器
- 原有 Quiver 能力：Skill 编辑、`.skill.zip` 导入导出、Marketplace、Git 同步与 CLI

## 快速开始

普通用户可直接运行 `release` 目录中的 Windows 安装包或便携版，无需安装 Node.js，也不会打开浏览器：

- `SkillPilot-Setup-0.9.0-x64.exe`：安装版，有安装向导、桌面/开始菜单快捷方式和标准卸载入口
- `SkillPilot-Portable-0.9.0-x64.exe`：免安装版，单文件双击运行，不写入程序安装目录或创建卸载项

两种版本的功能和用户数据完全相同，并共用 `%USERPROFILE%\.skillpilot\`。免安装版的“便携”仅指程序本体无需安装，并不表示数据跟随 EXE 移动。

源码开发要求 Node.js 20 或更高版本：

```bash
npm install
npm run desktop
```

Windows 打包命令：

```bash
npm run dist:win
```

也可以安装为全局 CLI：

```bash
npm install -g .
skillpilot ui
skillpilot list
```

`quiver` 命令别名仍然保留，便于原项目用户升级。

## AI 配置

在「设置 → 自定义 AI 服务」填写 Base URL、模型和可选 API Key。Ollama 的典型配置：

```text
Base URL: http://localhost:11434/v1
Model:    qwen3:8b
API Key:  留空
```

Skill 内容只有在你手动运行 AI 分类，或明确启用计划分类后才会发送给配置的模型服务。模型返回值只用于分类、标签、摘要和风险元数据，不会被当作本地执行指令。

AI 分析仍会把模型输出收敛到 10 个稳定主题：开发与工程、数据与分析、科研与学术、写作与内容、设计与多媒体、自动化与效率、安全与审计、运维与云、产品与业务、通用工具，但这些主题不再充当资料夹。Skills 库以用户自定义分组为准。自动维护默认处理全部已启用本地 Skills，并通过可配置的 1–8 路并发控制资源占用；再次维护会覆盖同一 Skill 的旧分析元数据，不会产生重复记录。

从旧版本首次升级到 0.9.0 时，数据库会自动迁移到 schema v3，清理旧 AI 分类字段及历史分类明细，同时保留来源更新、删除备份等其他审计记录。迁移不会修改或删除任何 `SKILL.md` 文件、目录或自定义来源。

「发现」并不依赖 AI 才能工作。GitHub 搜索、commit 固定、文件树检查、静态风险扫描和安装均为确定性本地逻辑；启用 AI 后额外提供候选仓库排序与语义判断。AI 失败不会绕过静态检查，也不会阻止你审阅低风险仓库。

## 默认扫描路径

| Agent | 路径 |
|---|---|
| Claude Code | `~/.claude/skills` |
| OpenAI Codex | `~/.codex/skills` |
| Agent Skills | `~/.agents/skills` |
| OpenClaw | `~/.openclaw/skills` |
| Gemini CLI | `~/.gemini/skills` |
| Cursor | `~/.cursor/skills` |

停用后的包保存在 `~/.skillpilot/disabled/<source-id>/`。批量删除和来源更新前的自动备份保存在 `~/.skillpilot/backups/`。元数据数据库位于 `~/.skillpilot/database.json`。

## 开发与验证

```bash
npm test
npm run check
npm run smoke:desktop
npm audit --audit-level=high
```

测试覆盖数据库往返与密钥脱敏、桌面端安全策略、备份模式校验、AI 响应防御性解析、固定 commit 仓库检查、安全安装、来源跟踪、原子更新与回滚。Electron 冒烟测试会真实走完“发现 → 检查 → 选择 Agent → 安装”和自动维护页面。Windows 使用说明见 [docs/windows.md](docs/windows.md)，产品规格与接口边界见 [docs/spec.md](docs/spec.md) 和 [docs/api.md](docs/api.md)。

应用版本检查读取 [Mxxy111/Skill-Pilot Releases](https://github.com/Mxxy111/Skill-Pilot/releases) 的最新正式版本。它只提示并打开 GitHub 发布页，不会静默下载或执行安装程序。

## 安全说明

- 不要将 Skill 包视为可信代码。导入或启用前请检查 `SKILL.md`、脚本和依赖。
- GitHub 与 AI 返回内容均按不可信数据处理，不会直接执行；静态扫描是预警层，不能代替安装前人工审阅。
- 批量导出会排除 `.git`、`node_modules`、`.env*`、`.pem` 和 `.key`。
- 本项目面向单用户本地运行，不应直接暴露到局域网或公网。

## 开源许可

[MIT](LICENSE)。欢迎提交 Issue 和 Pull Request。贡献指南见 [CONTRIBUTING.md](CONTRIBUTING.md)。
