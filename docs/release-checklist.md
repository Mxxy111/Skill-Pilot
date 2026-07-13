# Windows 发布检查清单

## 发布前

- [ ] `npm test` 全部通过
- [ ] `npm run check` 全部通过
- [ ] `npm run smoke:desktop` 能打开真实 Electron 窗口
- [ ] `npm audit --audit-level=high` 无高危或严重漏洞
- [ ] `npm run dist:win` 成功生成安装版与便携版
- [ ] 在干净的 Windows 用户账户中验证安装、启动、托盘隐藏、重复启动、退出和卸载
- [ ] 验证 Skills 扫描、启停、批量导出、数据库导入导出、GitHub 搜索和 AI 配置
- [ ] 使用正式证书签名 `.exe`，再发布 SHA-256 校验值

## 回滚

1. 从 `%USERPROFILE%\.skillpilot\` 复制或导出数据库和备份目录。
2. 卸载当前版本，或停止便携版进程。
3. 安装上一稳定版本；数据格式保持版本化且导入前会校验。
4. 若数据库发生不兼容变更，使用发布前导出的 JSON 数据库恢复。
