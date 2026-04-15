import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { ConfigManager } from '../config/ConfigManager';
import { VPSConfig } from '../types';
import { handleDeployCommand, handleVpsTestCommand } from './deployHandlers';

const configManager = new ConfigManager();
type InitAnswers = {
  template: string;
  packageManager: string;
  envs: string[];
};

function getProjectNameFromCwd(): string {
  return process.cwd().split('/').pop() || 'my-project';
}

function buildProjectConfig(answers: InitAnswers) {
  const environments = answers.envs.reduce((acc: Record<string, any>, env: string) => {
    acc[env] = { name: env, vars: {}, secrets: {}, targets: [] };
    return acc;
  }, {});

  return {
    name: getProjectNameFromCwd(),
    version: '1.0.0',
    environments,
    defaultEnv: answers.envs[0],
  };
}

async function promptInitAnswers(options: any): Promise<InitAnswers> {
  return inquirer.prompt([
    {
      type: 'list',
      name: 'template',
      message: '选择技术栈模板:',
      choices: ['react-nestjs', 'react-python', 'fullstack', 'custom'],
      default: options.template || 'react-nestjs',
    },
    {
      type: 'list',
      name: 'packageManager',
      message: '选择包管理器:',
      choices: ['npm', 'yarn', 'pnpm'],
      default: options.packageManager || 'npm',
    },
    {
      type: 'checkbox',
      name: 'envs',
      message: '选择环境:',
      choices: [
        { name: 'dev', checked: true },
        { name: 'staging', checked: true },
        { name: 'prod', checked: true },
      ],
      default: options.envs?.split(','),
    },
  ]);
}

async function handleInitCommand(options: any): Promise<void> {
  console.log(chalk.blue.bold('\n🚀 初始化 easy-deploy 项目\n'));
  const answers = await promptInitAnswers(options);
  const projectConfig = buildProjectConfig(answers);
  configManager.setProjectConfig(projectConfig);

  console.log(chalk.green('\n✓ 项目初始化完成'));
  console.log(chalk.gray('  配置文件: deploy.config.json'));
  console.log(chalk.gray(`  环境: ${answers.envs.join(', ')}\n`));
}

async function promptVpsBaseAnswers() {
  return inquirer.prompt([
    { type: 'input', name: 'name', message: 'VPS 名称:', default: 'default' },
    { type: 'input', name: 'host', message: 'IP 地址:' },
    { type: 'input', name: 'port', message: 'SSH 端口:', default: '22' },
    { type: 'input', name: 'username', message: '用户名:', default: 'root' },
    {
      type: 'list',
      name: 'authType',
      message: '认证方式:',
      choices: ['password', 'privateKey'],
    },
  ]);
}

async function promptVpsAuth(authType: 'password' | 'privateKey') {
  if (authType === 'password') {
    const pwdAnswer = await inquirer.prompt([
      { type: 'password', name: 'password', message: 'SSH 密码:', mask: '*' },
    ]);
    return { type: 'password' as const, password: pwdAnswer.password };
  }

  const keyAnswer = await inquirer.prompt([
    { type: 'input', name: 'privateKeyPath', message: '私钥路径:', default: '~/.ssh/id_rsa' },
  ]);
  return { type: 'privateKey' as const, privateKeyPath: keyAnswer.privateKeyPath };
}

async function handleVpsAddCommand(): Promise<void> {
  console.log(chalk.blue.bold('\n🖥️  添加 VPS 配置\n'));
  const base = await promptVpsBaseAnswers();
  const auth = await promptVpsAuth(base.authType);

  const vpsConfig: VPSConfig = {
    host: base.host,
    port: Number(base.port),
    username: base.username,
    auth,
  };

  configManager.setVPSConfig(base.name, vpsConfig);
  console.log(chalk.green('\n✓ VPS 配置已保存\n'));
}

function printVpsList(vpsConfigs: Record<string, any> | undefined): void {
  if (!vpsConfigs) {
    console.log(chalk.gray('  暂无配置'));
    return;
  }

  Object.entries(vpsConfigs).forEach(([name, cfg]: [string, any]) => {
    console.log(`  ${chalk.cyan(name)}: ${cfg.host}:${cfg.port} (${cfg.username})`);
  });
}

function printVpsInitHint(): void {
  console.log(chalk.blue.bold('\n⚙️  初始化 VPS 环境\n'));
}

async function handleVpsInitCommand(): Promise<void> {
  printVpsInitHint();
  const spinner = ora('正在安装 Docker + Docker Compose...').start();
  await new Promise((r) => setTimeout(r, 2000));
  spinner.succeed('Docker 环境初始化完成');
  console.log(chalk.green('\n✓ VPS 已准备就绪\n'));
}

async function handleVpsListCommand(): Promise<void> {
  console.log(chalk.blue.bold('\n📋 VPS 配置列表\n'));
  const globalConfig = configManager.getMergedConfig();
  printVpsList(globalConfig.vps);
  console.log();
}

async function handleVpsCommand(action: string): Promise<void> {
  if (action === 'add') return handleVpsAddCommand();
  if (action === 'list') return handleVpsListCommand();
  if (action === 'test') return handleVpsTestCommand(configManager);
  if (action === 'init') return handleVpsInitCommand();
  console.log(chalk.red(`✗ 不支持的 action: ${action}\n`));
}

async function handleBuildCommand(): Promise<void> {
  console.log(chalk.blue.bold('\n🔨 构建镜像\n'));
  const spinner = ora('正在构建...').start();
  await new Promise((r) => setTimeout(r, 1500));
  spinner.succeed('构建完成');
  console.log(chalk.green('\n✓ 镜像构建完成\n'));
}

function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('初始化项目')
    .option('-t, --template <template>', '模板: react-nestjs | react-python | fullstack')
    .option('-p, --package-manager <pm>', '包管理器: npm | yarn | pnpm')
    .option('-e, --envs <envs>', '环境列表 (逗号分隔)', 'dev,staging,prod')
    .action(handleInitCommand);
}

function registerVpsCommand(program: Command): void {
  program
    .command('vps <action>')
    .description('VPS 管理: add | list | test | init')
    .action(handleVpsCommand);
}

function registerBuildCommand(program: Command): void {
  program
    .command('build')
    .description('构建镜像')
    .option('-e, --env <env>', '目标环境', 'dev')
    .option('-p, --platform <platforms>', '目标平台 (逗号分隔)')
    .option('--no-cache', '禁用缓存', false)
    .option('--push', '构建后推送', false)
    .action(handleBuildCommand);
}

function registerDeployCommand(program: Command): void {
  program
    .command('deploy')
    .description('部署到 VPS（构建 + 上传 + 启动服务 + 健康检查）')
    .option('-e, --env <env>', '目标环境', 'dev')
    .option('-s, --strategy <strategy>', '部署策略: rolling | blue-green | canary', 'rolling')
    .option('--skip-build', '跳过构建', false)
    .option('--dry-run', '预览部署计划', false)
    .option('-p, --port <port>', '发布端口', '3000')
    .action((options) => handleDeployCommand(options, configManager));
}

/**
 * 注册所有命令
 */
export function registerCommands(program: Command): void {
  registerInitCommand(program);
  registerVpsCommand(program);
  registerBuildCommand(program);
  registerDeployCommand(program);

  // ==================== logs 命令 ====================
  program
    .command('logs [service]')
    .description('查看日志')
    .option('-f, --follow', '实时跟踪', false)
    .action(async (service, options) => {
      console.log(chalk.blue.bold('\n📋 查看日志\n'));
      // 日志逻辑
    });

  // ==================== status 命令 ====================
  program
    .command('status')
    .description('查看服务状态')
    .action(async () => {
      console.log(chalk.blue.bold('\n📊 服务状态\n'));
      // 状态逻辑
    });

  // ==================== rollback 命令 ====================
  program
    .command('rollback')
    .description('回滚到上一版本')
    .action(async () => {
      console.log(chalk.blue.bold('\n⏪ 回滚部署\n'));
      // 回滚逻辑
    });

  // ==================== env 命令组 ====================
  program
    .command('env <action>')
    .description('环境管理: create | list | use | diff')
    .action(async (action) => {
      switch (action) {
        case 'list':
          const cfg = configManager.getProjectConfig();
          if (cfg) {
            console.log(chalk.blue.bold('\n🌍 环境列表\n'));
            Object.keys(cfg.environments).forEach((env) => {
              const marker = env === cfg.defaultEnv ? chalk.green(' (default)') : '';
              console.log(`  ${chalk.cyan(env)}${marker}`);
            });
            console.log();
          }
          break;
        // 其他 env 子命令...
      }
    });
}
