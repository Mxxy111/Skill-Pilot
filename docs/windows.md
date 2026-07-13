# SkillPilot Windows 桌面版

## 运行方式

推荐使用安装版 `SkillPilot-Setup-0.4.0-x64.exe`。安装向导支持选择安装目录，并会创建桌面与开始菜单快捷方式。若不希望安装，可直接运行 `SkillPilot-Portable-0.4.0-x64.exe`。

桌面版启动后会显示独立窗口，不会打开系统浏览器。点击窗口关闭按钮会隐藏到系统托盘；双击托盘图标可再次打开，托盘菜单的“退出”会完整停止应用及其内置后台服务。

## 数据位置

- 元数据与设置：`%USERPROFILE%\.skillpilot\database.json`
- 停用的 Skills：`%USERPROFILE%\.skillpilot\disabled\`
- 删除前备份：`%USERPROFILE%\.skillpilot\backups\`
- 桌面窗口状态：`%APPDATA%\SkillPilot\window-state.json`

安装版和便携版共用上述数据，因此切换版本不会丢失 Skills 配置。数据库导出不会包含已保存的 API Key。

## 桌面安全边界

- 后台服务仅绑定随机分配的 `127.0.0.1` 端口，不监听局域网地址。
- Electron 渲染进程关闭 Node.js 集成，启用上下文隔离、进程沙箱和 Web 安全策略。
- 所有权限请求默认拒绝，应用导航只能留在启动时分配的本地源。
- 外部链接仅允许无内嵌凭据的 HTTPS 地址，并交由系统默认浏览器打开。
- 应用使用单实例锁，重复启动只会唤回现有窗口。

## 源码运行与打包

```powershell
npm install
npm run desktop
npm run dist:win
```

打包产物位于 `release\`。当前开源构建未附带商业代码签名证书，因此 Windows SmartScreen 可能显示“未知发布者”；公开分发时应使用受信任的代码签名证书签署安装包和便携版。
