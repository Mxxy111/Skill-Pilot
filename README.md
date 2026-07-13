# SkillPilot

一个本地优先、跨 Agent 的 Skills 管理中心。SkillPilot 将散落在 Claude Code、OpenAI Codex、`.agents`、OpenClaw、Gemini CLI、Cursor 和自定义目录中的 `SKILL.md` 包汇总到一个界面，帮助你减少上下文冗余，并持续维护自己的能力库。

> 本项目基于 Sam Blakeman 的 MIT 开源项目 [Quiver](https://github.com/sam-blakeman/quiver) 扩展而来，复用其 CLI、导入导出、插件市场与 Git 同步基础，并升级为 Windows 桌面应用。

## 主要能力

- 多 Agent 统一索引：内置 6 类扫描目录，并支持任意自定义绝对路径
- 真正启用/停用：停用项会移出 Agent 的扫描目录，从源头降低上下文负担
- 批量管理：启用、停用、分类、AI 分类、安全导出、删除前自动备份
- GitHub 发现：按热门或最近更新搜索不同领域的 Agent Skills 仓库
- 自定义 AI：兼容 OpenAI Chat Completions API 和本地 Ollama
- 自动维护：周期检查 Git 更新，可选择自动更新和 AI 分类
- 数据迁移：版本化 JSON 数据库导入导出，导出时自动移除 API 密钥
- 本地安全：仅监听 `127.0.0.1`，限制跨域来源，启用 CSP 等安全响应头
- Windows 桌面端：独立窗口、系统托盘、单实例、窗口状态记忆，不会弹出浏览器
- 原有 Quiver 能力：Skill 编辑、`.skill.zip` 导入导出、Marketplace、Git 同步与 CLI

## 快速开始

普通用户可直接运行 `release` 目录中的 Windows 安装包或便携版，无需安装 Node.js，也不会打开浏览器：

- `SkillPilot-Setup-0.4.0-x64.exe`：安装版，创建桌面和开始菜单快捷方式
- `SkillPilot-Portable-0.4.0-x64.exe`：免安装版，双击即用

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

## 默认扫描路径

| Agent | 路径 |
|---|---|
| Claude Code | `~/.claude/skills` |
| OpenAI Codex | `~/.codex/skills` |
| Agent Skills | `~/.agents/skills` |
| OpenClaw | `~/.openclaw/skills` |
| Gemini CLI | `~/.gemini/skills` |
| Cursor | `~/.cursor/skills` |

停用后的包保存在 `~/.skillpilot/disabled/<source-id>/`。批量删除前的自动备份保存在 `~/.skillpilot/backups/`。元数据数据库位于 `~/.skillpilot/database.json`。

## 开发与验证

```bash
npm test
npm run check
npm run smoke:desktop
npm audit --audit-level=high
```

测试覆盖数据库往返与密钥脱敏、桌面端安全策略、备份模式校验、AI 响应防御性解析、GitHub 查询契约和 Skill 根目录扫描。Windows 使用说明见 [docs/windows.md](docs/windows.md)，产品规格与接口边界见 [docs/spec.md](docs/spec.md) 和 [docs/api.md](docs/api.md)。

## 安全说明

- 不要将 Skill 包视为可信代码。导入或启用前请检查 `SKILL.md`、脚本和依赖。
- GitHub 与 AI 返回内容均按不可信数据处理，不会直接执行。
- 批量导出会排除 `.git`、`node_modules`、`.env*`、`.pem` 和 `.key`。
- 本项目面向单用户本地运行，不应直接暴露到局域网或公网。

## 开源许可

[MIT](LICENSE)。欢迎提交 Issue 和 Pull Request。贡献指南见 [CONTRIBUTING.md](CONTRIBUTING.md)。
