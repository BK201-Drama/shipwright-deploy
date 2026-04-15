# shipwright-deploy

Deploy CLI - 一键部署前端构建产物到 VPS（带自动体检与可达性诊断）

## 安装

```bash
npm install -g shipwright-deploy
```

## 快速开始

```bash
# 1. 初始化项目
deploy init

# 2. 添加 VPS 配置
deploy vps add

# 3. 部署
deploy deploy --env prod --port 3000
```

`deploy deploy` 默认会执行以下流程：
- 本地 `npm run build`（可用 `--skip-build` 跳过）
- 打包并上传 `dist` 到目标 VPS
- 自动创建并启动 `systemd` 服务（`python3 -m http.server`）
- 执行 VPS 本机健康检查 (`127.0.0.1:<port>`)
- 执行公网可达性检查，若失败会提示检查安全组/防火墙

## 命令

| 命令 | 说明 |
|------|------|
| `deploy init` | 初始化项目 |
| `deploy vps <action>` | VPS 管理 (add/list/test/init)，`test` 会检查 SSH/Python/Docker/sudo |
| `deploy build` | 构建镜像 |
| `deploy deploy --port <port>` | 部署到 VPS（构建 + 上传 + 启动 + 健康检查） |
| `deploy logs [service]` | 查看日志 |
| `deploy status` | 查看服务状态 |
| `deploy rollback` | 回滚到上一版本 |
| `deploy env <action>` | 环境管理 |

## 常见问题

- **公网访问超时，但本机健康检查成功**
  - 说明服务已在 VPS 内启动，通常是云安全组或防火墙未放行目标端口。
  - 放行对应 TCP 端口后重试访问。
- **部署时报 sudo 权限不足**
  - 使用 root 用户，或为部署用户授予 sudo 权限。
- **提示缺少 Python3**
  - 在 VPS 安装 `python3` 后重新部署。

## License

MIT
