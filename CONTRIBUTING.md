# Contributing

感谢你改进 SkillPilot。

1. 从 `main` 创建短期功能分支。
2. 行为变更先添加失败测试，再实现最小修复。
3. 提交前运行 `npm test`、`npm run check` 和 `npm audit --audit-level=high`。
4. 不要提交真实 Skills、API 密钥、数据库备份或用户目录路径。
5. Pull Request 请说明用户问题、验证方式和涉及的文件系统风险。

界面变更需要同时检查 390px 与 1440px 视口、键盘焦点和浏览器控制台。
