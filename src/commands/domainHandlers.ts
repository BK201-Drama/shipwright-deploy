// ============================================
// domain 命令处理器 - 域名与 SSL
// ============================================

import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from '../config/ConfigManager';
import { generateTemplate, writeTemplateFile, TemplateOptions } from '../templates/index';
import { SSHAdapter } from '../adapters/SSHAdapter';

const configManager = new ConfigManager();

export interface DomainAnswers {
  domain: string;
  enableSSL: boolean;
  email: string;
}

/**
 * 设置域名
 */
export async function handleDomainSet(domain?: string, enableSSL: boolean = false): Promise<void> {
  console.log(chalk.blue.bold('\n🌐 配置域名\n'));

  const answers = await inquirer.prompt<DomainAnswers>([
    {
      type: 'input',
      name: 'domain',
      message: '输入域名:',
      default: domain || 'example.com',
      validate: (input) => {
        const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z]{2,})+$/;
        return domainRegex.test(input) || '请输入有效的域名';
      },
    },
    {
      type: 'confirm',
      name: 'enableSSL',
      message: '启用 SSL (Let\'s Encrypt)?',
      default: enableSSL,
    },
    {
      type: 'input',
      name: 'email',
      message: 'SSL 证书邮箱:',
      when: (ans) => ans.enableSSL,
      validate: (input) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(input) || '请输入有效的邮箱';
      },
    },
  ]);

  const spinner = ora('正在配置域名...').start();

  try {
    // 生成 Nginx SSL 配置
    const sslConfig = generateTemplate('nginx-ssl', {} as TemplateOptions, answers.domain);
    
    const projectDir = process.cwd();
    const nginxDir = path.join(projectDir, 'docker/nginx');
    
    if (!fs.existsSync(nginxDir)) {
      fs.mkdirSync(nginxDir, { recursive: true });
    }
    
    writeTemplateFile(nginxDir, `${answers.domain}.conf`, sslConfig);

    // 更新项目配置
    const projectConfig = configManager.getProjectConfig();
    if (projectConfig) {
      (projectConfig as any).domain = answers.domain;
      (projectConfig as any).ssl = answers.enableSSL;
      configManager.setProjectConfig(projectConfig);
    }

    spinner.succeed(`域名配置完成: ${answers.domain}`);

    if (answers.enableSSL) {
      console.log(chalk.yellow('\n下一步: 在 VPS 上执行以下命令安装证书:'));
      console.log(chalk.gray(`
  # 安装 certbot
  apt update && apt install -y certbot python3-certbot-nginx
  
  # 申请证书
  certbot --nginx -d ${answers.domain} -m ${answers.email} --agree-tos --no-redirect
  
  # 自动续期
  certbot renew --dry-run
`));
    }

  } catch (error: any) {
    spinner.fail(`配置失败: ${error.message}`);
    throw error;
  }
}

/**
 * 在 VPS 上安装 SSL 证书
 */
export async function handleSSLInstall(domain: string, email: string): Promise<void> {
  console.log(chalk.blue.bold('\n🔒 安装 SSL 证书\n'));

  const globalConfig = configManager.getMergedConfig();
  if (!globalConfig.vps || Object.keys(globalConfig.vps).length === 0) {
    console.log(chalk.red('✗ 请先配置 VPS: deploy vps add\n'));
    return;
  }

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

  const spinner = ora('正在连接 VPS...').start();

  try {
    await ssh.connect();
    spinner.text = '正在安装 certbot...';

    // 安装 certbot
    await ssh.exec('apt update && apt install -y certbot python3-certbot-nginx');
    
    spinner.text = '正在申请证书...';
    
    // 申请证书
    const certResult = await ssh.exec(
      `certbot --nginx -d ${domain} -m ${email} --agree-tos --non-interactive --no-redirect`
    );

    if (certResult.exitCode === 0) {
      spinner.succeed('SSL 证书安装成功');
      console.log(chalk.green(`\n✓ HTTPS 已启用: https://${domain}\n`));
    } else {
      spinner.fail('证书申请失败');
      console.log(chalk.red(certResult.stderr));
    }

  } catch (error: any) {
    spinner.fail(`安装失败: ${error.message}`);
    throw error;
  } finally {
    ssh.disconnect();
  }
}

/**
 * 检查 DNS 解析
 */
export async function handleDNSCheck(domain: string): Promise<void> {
  console.log(chalk.blue.bold('\n🔍 检查 DNS 解析\n'));

  const { exec } = require('child_process');
  const util = require('util');
  const execAsync = util.promisify(exec);

  const spinner = ora('正在检查 DNS...').start();

  try {
    // 检查 A 记录
    const { stdout: aRecord } = await execAsync(`dig +short A ${domain}`);
    // 检查 AAAA 记录
    const { stdout: aaaaRecord } = await execAsync(`dig +short AAAA ${domain}`);
    // 检查 CNAME
    const { stdout: cnameRecord } = await execAsync(`dig +short CNAME ${domain}`);

    spinner.succeed('DNS 检查完成');

    console.log(chalk.gray('\n解析结果:'));
    console.log(chalk.cyan('  A 记录:'), aRecord.trim() || '未设置');
    console.log(chalk.cyan('AAAA 记录:'), aaaaRecord.trim() || '未设置');
    console.log(chalk.cyan('CNAME:'), cnameRecord.trim() || '未设置');

    if (!aRecord.trim() && !aaaaRecord.trim() && !cnameRecord.trim()) {
      console.log(chalk.yellow('\n⚠ 未检测到 DNS 记录，请先配置域名解析'));
    }

  } catch (error: any) {
    spinner.fail(`检查失败: ${error.message}`);
  }
}

/**
 * 续期证书
 */
export async function handleSSLRenew(domain?: string): Promise<void> {
  console.log(chalk.blue.bold('\n🔄 续期 SSL 证书\n'));

  const globalConfig = configManager.getMergedConfig();
  if (!globalConfig.vps || Object.keys(globalConfig.vps).length === 0) {
    console.log(chalk.red('✗ 请先配置 VPS: deploy vps add\n'));
    return;
  }

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

  const spinner = ora('正在连接 VPS...').start();

  try {
    await ssh.connect();
    spinner.text = '正在续期证书...';

    const renewCmd = domain 
      ? `certbot renew --cert-name ${domain}`
      : 'certbot renew';

    const result = await ssh.exec(renewCmd);

    if (result.exitCode === 0) {
      spinner.succeed('证书续期成功');
      // 重载 Nginx
      await ssh.exec('nginx -s reload');
      console.log(chalk.green('\n✓ Nginx 已重载\n'));
    } else {
      spinner.fail('续期失败');
      console.log(chalk.yellow('\n可能证书尚未到续期时间\n'));
    }

  } catch (error: any) {
    spinner.fail(`续期失败: ${error.message}`);
  } finally {
    ssh.disconnect();
  }
}

/**
 * 查看证书状态
 */
export async function handleSSLStatus(domain: string): Promise<void> {
  console.log(chalk.blue.bold('\n📋 SSL 证书状态\n'));

  const globalConfig = configManager.getMergedConfig();
  if (!globalConfig.vps || Object.keys(globalConfig.vps).length === 0) {
    console.log(chalk.red('✗ 请先配置 VPS: deploy vps add\n'));
    return;
  }

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

  const spinner = ora('正在查询证书信息...').start();

  try {
    await ssh.connect();
    const result = await ssh.exec(`certbot certificates --cert-name ${domain}`);

    spinner.succeed('查询完成');
    console.log(chalk.gray('\n' + result.stdout));

  } catch (error: any) {
    spinner.fail(`查询失败: ${error.message}`);
  } finally {
    ssh.disconnect();
  }
}
