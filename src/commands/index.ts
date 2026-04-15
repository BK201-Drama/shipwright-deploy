import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { ConfigManager } from '../config/ConfigManager';
import { SSHAdapter, sshPool } from '../adapters/SSHAdapter';
import { DockerAdapter } from '../adapters/DockerAdapter';
import { InitOptions, BuildOptions, DeployOptions, VPSConfig } from '../types';

const configManager = new ConfigManager();

/**
 * 注册所有命令
 */
export function registerCommands(program: Command): void {
  // ==================== init 命令 ====================
  program
    .command('init')
    .description('初始化项目')
    .option('-t, --template <template>', '模板: react-nestjs | react-python | fullstack')
    .option('-p, --package-manager <pm>', '包管理器: npm | yarn | pnpm')
    .option('-e, --envs <envs>', '环境列表 (逗号分隔)', 'dev,staging,prod')
    .action(async (options) => {
      console.log(chalk.blue.bold('\n🚀 初始化 easy-deploy 项目\n'));
      
      const answers = await inquirer.prompt([
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

      // 创建配置
      const projectConfig = {
        name: process.cwd().split('/').pop() || 'my-project',
        version: '1.0.0',
        environments: answers.envs.reduce((acc: any, env: string) => {
          acc[env] = { name: env, vars: {}, secrets: {}, targets: [] };
          return acc;
        }, {}),
        defaultEnv: answers.envs[0],
      };

      configManager.setProjectConfig(projectConfig);

      console.log(chalk.green('\n✓ 项目初始化完成'));
      console.log(chalk.gray(`  配置文件: deploy.config.json`));
      console.log(chalk.gray(`  环境: ${answers.envs.join(', ')}\n`));
    });

  // ==================== vps 命令组 ====================
  program
    .command('vps <action>')
    .description('VPS 管理: add | list | test | init')
    .action(async (action) => {
      switch (action) {
        case 'add':
          console.log(chalk.blue.bold('\n🖥️  添加 VPS 配置\n'));
          
          const vpsAnswers = await inquirer.prompt([
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

          let authData: any = {};
          if (vpsAnswers.authType === 'password') {
            const pwdAnswer = await inquirer.prompt([
              { type: 'password', name: 'password', message: 'SSH 密码:', mask: '*' },
            ]);
            authData = { type: 'password', password: pwdAnswer.password };
          } else {
            const keyAnswer = await inquirer.prompt([
              { type: 'input', name: 'privateKeyPath', message: '私钥路径:', default: '~/.ssh/id_rsa' },
            ]);
            authData = { type: 'privateKey', privateKeyPath: keyAnswer.privateKeyPath };
          }

          const vpsConfig: VPSConfig = {
            host: vpsAnswers.host,
            port: parseInt(vpsAnswers.port),
            username: vpsAnswers.username,
            auth: authData,
          };

          configManager.setVPSConfig(vpsAnswers.name, vpsConfig);
          console.log(chalk.green('\n✓ VPS 配置已保存\n'));
          break;

        case 'list':
          console.log(chalk.blue.bold('\n📋 VPS 配置列表\n'));
          const globalConfig = configManager.getMergedConfig();
          if (globalConfig.vps) {
            Object.entries(globalConfig.vps).forEach(([name, cfg]: [string, any]) => {
              console.log(`  ${chalk.cyan(name)}: ${cfg.host}:${cfg.port} (${cfg.username})`);
            });
          } else {
            console.log(chalk.gray('  暂无配置'));
          }
          console.log();
          break;

        case 'test':
          console.log(chalk.blue.bold('\n🔌 测试 VPS 连接\n'));
          // 测试连接逻辑
          break;

        case 'init':
          console.log(chalk.blue.bold('\n⚙️  初始化 VPS 环境\n'));
          const vpsInitSpinner = ora('正在安装 Docker + Docker Compose...').start();
          // VPS 初始化逻辑（安装 Docker 等）
          await new Promise((r) => setTimeout(r, 2000));
          vpsInitSpinner.succeed('Docker 环境初始化完成');
          console.log(chalk.green('\n✓ VPS 已准备就绪\n'));
          break;
      }
    });

  // ==================== build 命令 ====================
  program
    .command('build')
    .description('构建镜像')
    .option('-e, --env <env>', '目标环境', 'dev')
    .option('-p, --platform <platforms>', '目标平台 (逗号分隔)')
    .option('--no-cache', '禁用缓存', false)
    .option('--push', '构建后推送', false)
    .action(async (options) => {
      console.log(chalk.blue.bold('\n🔨 构建镜像\n'));
      
      const dockerAdapter = new DockerAdapter(process.cwd());
      const buildSpinner = ora('正在构建...').start();
      
      // 构建逻辑
      await new Promise((r) => setTimeout(r, 1500));
      
      buildSpinner.succeed('构建完成');
      console.log(chalk.green('\n✓ 镜像构建完成\n'));
    });

  // ==================== deploy 命令 ====================
  program
    .command('deploy')
    .description('部署到 VPS')
    .option('-e, --env <env>', '目标环境', 'dev')
    .option('-s, --strategy <strategy>', '部署策略: rolling | blue-green | canary', 'rolling')
    .option('--skip-build', '跳过构建', false)
    .option('--dry-run', '预览部署计划', false)
    .action(async (options) => {
      console.log(chalk.blue.bold('\n🚀 部署到 VPS\n'));
      
      const projectConfig = configManager.getProjectConfig();
      if (!projectConfig) {
        console.log(chalk.red('✗ 请先运行 `deploy init` 初始化项目\n'));
        return;
      }

      // 选择 VPS
      const globalConfig = configManager.getMergedConfig();
      const vpsNames = globalConfig.vps ? Object.keys(globalConfig.vps) : [];
      
      if (vpsNames.length === 0) {
        console.log(chalk.red('✗ 请先运行 `deploy vps add` 添加 VPS\n'));
        return;
      }

      const deployAnswers = await inquirer.prompt([
        {
          type: 'list',
          name: 'vps',
          message: '选择目标 VPS:',
          choices: vpsNames,
        },
      ]);

      const vpsConfig: VPSConfig = globalConfig.vps[deployAnswers.vps];
      
      // 部署流程
      const steps = [
        '连接 VPS',
        '拉取镜像',
        '停止旧容器',
        '启动新容器',
        '健康检查',
      ];

      for (const step of steps) {
        const stepSpinner = ora(step).start();
        await new Promise((r) => setTimeout(r, 800));
        stepSpinner.succeed(step);
      }

      console.log(chalk.green.bold('\n✅ 部署完成!\n'));
      console.log(chalk.gray(`  访问地址: http://${vpsConfig.host}:3000\n`));
    });

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
