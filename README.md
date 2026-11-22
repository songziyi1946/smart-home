# Smart Home · 家庭控制台

把家里的设备、房间和日常开销放在一个网页里。出门前一键切换「离家」场景，回家后看看客厅温湿度、哪些设备离线，也能顺手记下一笔水电费。

**[下载一键体验包](#在电脑上试用)** · [下载源码 ZIP](https://github.com/songziyi1946/smart-home/archive/refs/heads/master.zip) · [开发与设备接入](docs/technical-guide.md)

## 可以用来做什么？

- **看看家里的情况**：按房间查看灯、空调、窗帘和扫地机器人，把常用设备收藏起来。接入传感器后，还能查看温湿度等读数。
- **一键切换场景**：把多个设备动作存成「回家」「离家」或「睡眠」，也可以设置夜间有人经过时运行「夜灯」场景。
- **和家人一起用**：管理员可以邀请家人加入，也可以给临时来访的人发放限时访问权限。
- **记账、逛逛三维样板间**：手动记录水、电、燃气等费用，查看近几个月的支出；也可以在三维视图中浏览内置样板间。缴费入口只跳转到官方渠道。

## 在电脑上试用

选择与你的电脑匹配的体验包。包内已包含运行所需的文件，解压后双击启动，无需安装 Node.js。首次启动会提供模拟设备，可以先试试开关灯、调窗帘或运行场景。

| 电脑 | 下载 | 解压后双击 |
| --- | --- | --- |
| Windows 64 位（Intel / AMD） | [Windows 体验包](https://github.com/songziyi1946/smart-home/releases/latest/download/smart-home-windows-x64.zip) | `Start Smart Home.cmd` |
| Apple 芯片 Mac（M 系列） | [Apple 芯片 Mac 体验包](https://github.com/songziyi1946/smart-home/releases/latest/download/smart-home-macos-arm64.zip) | `Start Smart Home.command` |
| Intel 芯片 Mac | [Intel Mac 体验包](https://github.com/songziyi1946/smart-home/releases/latest/download/smart-home-macos-x64.zip) | `Start Smart Home.command` |

浏览器会自动打开家庭控制台，首次使用时按提示创建家庭和管理员账号。如果网页没有自动打开，可以访问 [http://127.0.0.1:3101](http://127.0.0.1:3101)。使用时请保留启动窗口，关闭它即可停止服务。家庭设置和记账数据保存在解压后的文件夹中。

Mac 体验包需要 macOS 13.5 或更新版本。首次启动时，如果系统拦截，可以按苹果的说明在「系统设置 → 隐私与安全性」中确认打开。[苹果支持](https://support.apple.com/zh-cn/102445)

[查看 GitHub Releases](https://github.com/songziyi1946/smart-home/releases)

## 从源码运行

1. 点击[下载源码 ZIP](https://github.com/songziyi1946/smart-home/archive/refs/heads/master.zip)并解压。也可以在 GitHub 仓库点击 **Code → Download ZIP**。
2. 安装 [Node.js 24.18.0](https://nodejs.org/en/download/archive/v24.18.0)（包含运行命令所需的 npm）。
3. 在解压后的项目文件夹中打开终端（Windows 可用 PowerShell，macOS 可用「终端」），依次执行：

   ```sh
   npm ci --prefix backend
   npm ci --prefix frontend
   npm run build --prefix frontend
   npm start --prefix backend
   ```

4. 保持终端窗口打开，在同一台电脑的浏览器访问 [http://127.0.0.1:3101](http://127.0.0.1:3101)。首次打开时，按提示创建家庭和管理员账号。

以后在同一文件夹里，只需再次运行 `npm start --prefix backend`。家庭设置和记账数据保存在这台电脑上，关闭页面不会清除它们。

## 接入家里的设备

如果已经在使用 Home Assistant，可以按[设备接入说明](docs/technical-guide.md#home-assistant-与虚拟设备)连接支持的设备。可用的控制和读数取决于实际设备；模拟数据会单独标明。

遇到启动问题，或需要改端口、备份数据、使用 Docker Compose 配置常驻运行与 HTTPS，请查看[开发与部署指南](docs/technical-guide.md)。

首次公开部署前请阅读 [初始化、安全 Cookie 与隔离演示](docs/technical-guide.md#首次初始化安全-cookie-与隔离演示)。HTTPS 模式默认关闭首次注册入口，须先私下初始化家庭；不要直接公开未初始化的 local/免登录服务。
