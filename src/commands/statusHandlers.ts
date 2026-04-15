// ============================================
// status & rollback 命令处理器 - 状态查看与回滚
// ============================================

import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from '../config/ConfigManager';
import { SSHAdapter } from '../adapters/SSHAdapter';
import { DeploymentState, ServiceStatus } from '../types';

const configManager = new ConfigManager();

/**
 * 查看服务状态
 */
export async function handleStatus(env?: string): Promise<void> {
  console.log(chalk.blue.bold('\n📊 服务状态\n'));

  const projectConfig = configManager.getProjectConfig();
  if (!projectConfig) {
    console.log(chalk.red('✗ 请先运行 `deploy init` 初始化项目\n'));
    return;
  }

  const globalConfig = configManager.getMergedConfig();
  if (!globalConfig.vps || Object.keys(globalConfig.vps).length === 0) {
    console.log(chalk.red('✗ 请先配置 VPS: deploy vps add\n'));
    return;
  }

  // 选择环境
  const targetEnv = env || projectConfig.defaultEnv;
  console.log(chalk.gray(`环境: ${targetEnv}\n`));

  // 选择 VPS
  let targetVps = globalConfig.currentVps;
  if (!targetVps) {
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'vps',
        message: '选择 VPS:',
        choices: Object.keys(globalConfig.vps),
      },
    ]);
    targetVps = answers.vps;
  }

  const vpsConfig = globalConfig.vps[targetVps];
  const ssh = new SSHAdapter(vpsConfig);

  const spinner = ora('正在获取服务状态...').start();

  try {
    await ssh.connect();

    // 获取 Docker 容器状态
    spinner.text = '正在查询容器...';
    const containersResult = await ssh.exec('docker ps -a --format "{{.Names}}|{{.Status}}|{{.Ports}}"');
    
    // 获取 Docker Compose 服务状态
    const composeResult = await ssh.exec('docker-compose ps --format json 2>/dev/null || echo "[]"');

    spinner.succeed('状态获取完成');

    // 解析并显示状态
    displayContainerStatus(containersResult.stdout);
    
    // 显示部署历史
    await displayDeploymentHistory();

    // 健康检查
    await performHealthCheck(ssh, projectConfig);

  } catch (error: any) {
    spinner.fail(`获取状态失败: ${error.message}`);
  } finally {
    ssh.disconnect();
  }
}

/**
 * 显示容器状态
 */
function displayContainerStatus(output: string): void {
  if (!output.trim()) {
    console.log(chalk.yellow('  没有运行中的容器\n'));
    return;
  }

  console.log(chalk.cyan.bold('容器状态:\n'));

  const lines = output.trim().split('\n');
  lines.forEach((line: string) => {
    const [name, status, ports] = line.split('|');
    
    const statusIcon = status.includes('Up') ? chalk.green('●') : chalk.red('●');
    const statusColor = status.includes('Up') ? chalk.green : chalk.red;

    console.log(`  ${statusIcon} ${chalk.cyan(name)}`);
    console.log(`      状态: ${statusColor(status)}`);
    if (ports) {
      console.log(`      端口: ${chalk.gray(ports)}`);
    }
    console.log();
  });
}

/**
 * 显示部署历史
 */
async function displayDeploymentHistory(): Promise<void> {
  const historyDir = path.join(process.cwd(), '.deploy-cli', 'history');
  
  if (!fs.existsSync(historyDir)) {
    return;
  }

  const historyFiles = fs.readdirSync(historyDir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, 5);

  if (historyFiles.length === 0) {
    return;
  }

  console.log(chalk.cyan.bold('最近部署:\n'));

  historyFiles.forEach((file, index) => {
    const filePath = path.join(historyDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const deployment: DeploymentState = JSON.parse(content);

    const time = new Date(deployment.deployedAt).toLocaleString('zh-CN');
    const isLatest = index === 0;

    console.log(`  ${isLatest ? chalk.green('→') : ' '} ${chalk.gray(time)} | ${chalk.cyan(deployment.env)} | ${deployment.version}`);
    if (isLatest) {
      console.log(`    ${chalk.green('当前版本')}`);
    }
  });
  console.log();
}

/**
 * 执行健康检查
 */
async function performHealthCheck(ssh: SSHAdapter, projectConfig: any): Promise<void> {
  console.log(chalk.cyan.bold('健康检查:\n'));

  const services = [];
  if (projectConfig.frontend) {
    services.push({ name: 'frontend', port: 80, path: '/' });
  }
  if (projectConfig.backend) {
    services.push({ name: 'backend', port: projectConfig.backend.port, path: '/health' });
  }

  for (const service of services) {
    try {
      const result = await ssh.exec(
        `curl -sf http://localhost:${service.port}${service.path} > /dev/null && echo "OK" || echo "FAIL"`
      );
      const isHealthy = result.stdout.trim() === 'OK';
      const icon = isHealthy ? chalk.green('✓') : chalk.red('✗');
      console.log(`  ${icon} ${service.name}: ${isHealthy ? chalk.green('健康') : chalk.red('异常')}`);
    } catch {
      console.log(`  ${chalk.red('✗')} ${service.name}: ${chalk.red('无法检查')}`);
    }
  }
  console.log();
}

/**
 * 回滚到上一版本
 */
export async function handleRollback(env?: string): Promise<void> {
  console.log(chalk.blue.bold('\n⏪ 回滚部署\n'));

  const projectConfig = configManager.getProjectConfig();
  if (!projectConfig) {
    console.log(chalk.red('✗ 请先运行 `deploy init` 初始化项目\n'));
    return;
  }

  // 获取部署历史
  const historyDir = path.join(process.cwd(), '.deploy-cli', 'history');
  
  if (!fs.existsSync(historyDir)) {
    console.log(chalk.red('✗ 没有部署历史，无法回滚\n'));
    return;
  }

  const historyFiles = fs.readdirSync(historyDir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse();

  if (historyFiles.length < 2) {
    console.log(chalk.red('✗ 没有可回滚的版本（至少需要 2 次部署）\n'));
    return;
  }

  // 显示可回滚的版本
  console.log(chalk.cyan('可回滚版本:\n'));
  
  const versions: { file: string; deployment: DeploymentState }[] = [];
  
  historyFiles.slice(0, 10).forEach((file, index) => {
    const filePath = path.join(historyDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const deployment: DeploymentState = JSON.parse(content);
    versions.push({ file, deployment });

    const time = new Date(deployment.deployedAt).toLocaleString('zh-CN');
    const isLatest = index === 0;
    
    if (!isLatest) {
      console.log(`  ${chalk.cyan(index)}. ${chalk.gray(time)} | ${deployment.env} | ${deployment.version}`);
    }
  });

  console.log();

  // 选择要回滚的版本
  const answers = await inquirer.prompt([
    {
      type: 'number',
      name: 'version',
      message: '选择要回滚的版本 (输入序号):',
      validate: (input) => {
        if (input < 1 || input >= versions.length) {
          return `请输入 1-${versions.length - 1} 之间的数字`;
        }
        return true;
      },
    },
    {
      type: 'confirm',
      name: 'confirm',
      message: (ans) => {
        const target = versions[ans.version];
        return `确认回滚到 ${target.deployment.version}?`;
      },
    },
  ]);

  if (!answers.confirm) {
    console.log(chalk.yellow('\n已取消回滚\n'));
    return;
  }

  const targetVersion = versions[answers.version];
  await executeRollback(targetVersion.deployment);
}

/**
 * 执行回滚
 */
async function executeRollback(deployment: DeploymentState): Promise<void> {
  const globalConfig = configManager.getMergedConfig();
  
  if (!globalConfig.vps || Object.keys(globalConfig.vps).length === 0) {
    console.log(chalk.red('✗ 请先配置 VPS\n'));
    return;
  }

  // 选择 VPS
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'vps',
      message: '选择 VPS:',
      choices: Object.keys(globalConfig.vps),
    },
  ]);

  const vpsConfig = globalConfig.vps[answers.vps];
  const ssh = new SSHAdapter(vpsConfig);

  const spinner = ora('正在回滚...').start();

  try {
    await ssh.connect();

    // 停止当前服务
    spinner.text = '正在停止当前服务...';
    await ssh.exec('docker-compose down');

    // 拉取旧版本镜像
    for (const service of deployment.services) {
      spinner.text = `正在拉取 ${service.name}:${deployment.version}...`;
      await ssh.exec(`docker pull ${service.image}`);
    }

    // 启动旧版本
    spinner.text = '正在启动旧版本...';
    await ssh.exec('docker-compose up -d');

    // 健康检查
    spinner.text = '正在检查服务状态...';
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const healthResult = await ssh.exec('docker-compose ps --format json');
    
    spinner.succeed('回滚完成');

    console.log(chalk.green.bold('\n✓ 回滚成功!\n'));
    console.log(chalk.gray(`版本: ${deployment.version}`));
    console.log(chalk.gray(`时间: ${new Date(deployment.deployedAt).toLocaleString('zh-CN')}\n`));

  } catch (error: any) {
    spinner.fail(`回滚失败: ${error.message}`);
    throw error;
  } finally {
    ssh.disconnect();
  }
}

/**
 * 保存部署状态
 */
export function saveDeploymentState(state: DeploymentState): void {
  const historyDir = path.join(process.cwd(), '.deploy-cli', 'history');
  
  if (!fs.existsSync(historyDir)) {
    fs.mkdirSync(historyDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${timestamp}.json`;
  const filePath = path.join(historyDir, filename);

  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));

  // 清理旧历史（保留最近 50 条）
  const files = fs.readdirSync(historyDir)
    .filter(f => f.endsWith('.json'))
    .sort();

  if (files.length > 50) {
    files.slice(0, files.length - 50).forEach(f => {
      fs.unlinkSync(path.join(historyDir, f));
    });
  }
}
