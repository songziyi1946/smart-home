# smart-home

#### 介绍
智能家居中控台

#### 软件架构
软件架构说明


#### 安装教程

需要 Node.js 22 或更新版本。分别安装前后端依赖：

```sh
cd backend
npm ci
cd ../frontend
npm install
```

#### 使用说明

在两个终端中分别启动后端和前端（从项目根目录执行）：

```sh
cd backend
npm run dev
```

```sh
cd frontend
npm run dev
```

浏览器打开 http://localhost:8000。前端将 `/api` 请求转发到端口 3101 的后端，因此两个服务都需要运行。若该端口被占用，在两个启动终端中设置同一个 `SMART_HOME_API_PORT` 后重启前后端。后端状态保存在 `backend/data/state.json`。

前端构建检查：在 `frontend` 目录执行 `npm run build`。

#### 登录与鉴权

本地运行 `npm run dev --prefix backend` 时临时跳过登录。要恢复验证，停止该进程并运行 `npm start --prefix backend`。

首次打开页面时创建家庭，设置家庭名称、管理员用户名、显示名称和 12–128 位密码，创建后自动登录。没有默认密码，也不开放自行注册。

家庭管理员可在“我的”页面生成一次性邀请码（15 分钟内有效）。家人从登录页选择“加入家庭”，输入邀请码并创建自己的账户，无需共享管理员密码。

| 家庭身份 | 权限 |
| --- | --- |
| 家庭管理员 | 全部功能，管理自动化、邀请和移除成员 |
| 家庭成员 | 设备、场景、缴费；查看自动化配置 |
| 限时访客 | 设备和场景控制；无法读取缴费及自动化数据 |

访客访问期限可设为 1 小时、24 小时或 7 天，从接受邀请时开始计算；到期自动失效。管理员移除成员后，其已有会话立即失效。当前为单家庭模式。

所有业务 API 均校验身份和权限。会话通过 HttpOnly、SameSite=Strict Cookie 保存，有效期最多 8 小时（不超过访客访问期限），退出登录后立即失效。服务重启后需重新登录，家庭账户与未过期邀请码仍然保留。

密码使用随机盐和 scrypt 哈希保存到 `backend/data/auth.json`，该文件及临时文件已加入 Git 忽略规则。首次创建家庭前，请保持服务仅供自己访问。

在 `backend` 目录执行 `npm test` 可运行鉴权测试。

#### 参与贡献

1.  Fork 本仓库
2.  新建 Feat_xxx 分支
3.  提交代码
4.  新建 Pull Request


#### 特技

1.  使用 Readme\_XXX.md 来支持不同的语言，例如 Readme\_en.md, Readme\_zh.md
2.  Gitee 官方博客 [blog.gitee.com](https://blog.gitee.com)
3.  你可以 [https://gitee.com/explore](https://gitee.com/explore) 这个地址来了解 Gitee 上的优秀开源项目
4.  [GVP](https://gitee.com/gvp) 全称是 Gitee 最有价值开源项目，是综合评定出的优秀开源项目
5.  Gitee 官方提供的使用手册 [https://gitee.com/help](https://gitee.com/help)
6.  Gitee 封面人物是一档用来展示 Gitee 会员风采的栏目 [https://gitee.com/gitee-stars/](https://gitee.com/gitee-stars/)
