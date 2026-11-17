# Smart Home · 家庭控制台

把家里的设备、房间和日常开销放在一个网页里。出门前一键切换「离家」场景，回家后看看客厅温湿度、哪些设备离线，也能顺手记下一笔水电费。

**[下载源码 ZIP](https://github.com/songziyi1946/smart-home/archive/refs/heads/master.zip)** · [在电脑上试用](#在电脑上试用) · [开发与设备接入](docs/technical-guide.md)

## 可以用来做什么？

- **看看家里的情况**：按房间查看灯、空调、窗帘和扫地机器人，把常用设备收藏起来。接入传感器后，还能查看温湿度等读数。
- **一键切换场景**：把多个设备动作存成「回家」「离家」或「睡眠」，也可以设置夜间有人经过时运行「夜灯」场景。
- **和家人一起用**：管理员可以邀请家人加入，也可以给临时来访的人发放限时访问权限。
- **记账、逛逛三维样板间**：手动记录水、电、燃气等费用，查看近几个月的支出；也可以在三维视图中浏览内置样板间。缴费入口只跳转到官方渠道。

## 在电脑上试用

不用购买智能设备。首次启动会提供模拟设备，可以先试试开关灯、调窗帘或运行场景。下载的是源码压缩包，需要在电脑上执行下面的启动步骤。

1. 点击[下载源码 ZIP](https://github.com/songziyi1946/smart-home/archive/refs/heads/master.zip)并解压。也可以在 GitHub 仓库点击 **Code → Download ZIP**。
2. 安装 [Node.js 26.13.1](https://nodejs.org/en/download)（包含运行命令所需的 npm）。
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

遇到启动问题，或需要改端口、备份数据，请查看[开发与部署指南](docs/technical-guide.md)。
