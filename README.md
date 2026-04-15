# easy-project

Deploy CLI - 一键部署前后端到 VPS

## 安装

```bash
npm install -g easy-project
```

## 快速开始

```bash
# 1. 初始化项目
deploy init

# 2. 添加 VPS 配置
deploy vps add

# 3. 部署
deploy deploy --env prod
```

## 命令

| 命令 | 说明 |
|------|------|
| `deploy init` | 初始化项目 |
| `deploy vps <action>` | VPS 管理 (add/list/test/init) |
| `deploy build` | 构建镜像 |
| `deploy deploy` | 部署到 VPS |
| `deploy logs [service]` | 查看日志 |
| `deploy status` | 查看服务状态 |
| `deploy rollback` | 回滚到上一版本 |
| `deploy env <action>` | 环境管理 |

## 技术栈

- TypeScript
- Commander.js (CLI 框架)
- Inquirer.js (交互式提示)
- SSH2 (远程执行)
- Docker API

## License

MIT
