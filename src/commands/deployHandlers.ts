import { exec as execCb } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { ConfigManager } from '../config/ConfigManager';
import { sshPool } from '../adapters/SSHAdapter';
import { VPSConfig } from '../types';

const exec = promisify(execCb);
const CANDIDATE_USERS = ['ubuntu', 'root', 'admin', 'ec2-user', 'debian'];

type RemoteRuntime = {
  whoami: string;
  hasPython: boolean;
  hasDocker: boolean;
  sudoReady: boolean;
};

type DeployOptions = {
  env: string;
  skipBuild: boolean;
  dryRun: boolean;
  port: string;
};

type DeployContext = {
  vpsName: string;
  vpsConfig: VPSConfig;
  projectName: string;
  projectDir: string;
  port: number;
  env: string;
};

type RemotePaths = {
  remoteDir: string;
  remoteTar: string;
  serviceName: string;
};

function quoteSingle(str: string): string {
  return str.replace(/'/g, `'\"'\"'`);
}

function sanitizeName(input: string): string {
  return input.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
}

function parsePort(portRaw: string): number | null {
  const port = Number(portRaw);
  if (!Number.isInteger(port)) return null;
  if (port < 1 || port > 65535) return null;
  return port;
}

function buildRemoteCommand(vpsConfig: VPSConfig, rawCommand: string): string {
  if (vpsConfig.username === 'root') {
    return rawCommand;
  }

  const escapedCommand = quoteSingle(rawCommand);
  if (vpsConfig.auth.type === 'password' && vpsConfig.auth.password) {
    const escapedPassword = quoteSingle(vpsConfig.auth.password);
    return `echo '${escapedPassword}' | sudo -S sh -c '${escapedCommand}'`;
  }

  return `sudo sh -c '${escapedCommand}'`;
}

async function runLocal(command: string, cwd: string): Promise<string> {
  const { stdout, stderr } = await exec(command, { cwd });
  if (stderr?.trim()) {
    console.log(chalk.gray(stderr.trim()));
  }
  return stdout.trim();
}

async function ensureLocalBuild(projectDir: string, skipBuild: boolean): Promise<void> {
  if (skipBuild) return;
  const spinner = ora('正在本地构建项目产物...').start();
  try {
    await runLocal('npm run build', projectDir);
    spinner.succeed('本地构建完成');
  } catch (error: any) {
    spinner.fail('本地构建失败');
    throw new Error(`本地构建失败: ${error.message}`);
  }
}

async function packDistArtifact(projectDir: string, projectName: string): Promise<string> {
  const distDir = path.join(projectDir, 'dist');
  if (!fs.existsSync(distDir)) {
    throw new Error('未找到 dist 目录，请先运行构建，或不要使用 --skip-build');
  }

  const tarball = path.join(os.tmpdir(), `${sanitizeName(projectName)}-dist-${Date.now()}.tgz`);
  await runLocal(`tar -czf "${tarball}" -C "${projectDir}" dist`, projectDir);
  return tarball;
}

function buildCandidateUsers(username: string): string[] {
  return Array.from(new Set([username, ...CANDIDATE_USERS]));
}

async function tryConnection(vpsConfig: VPSConfig): Promise<boolean> {
  try {
    await sshPool.getConnection(vpsConfig);
    return true;
  } catch {
    return false;
  }
}

async function resolveReachableVpsConfig(
  configManager: ConfigManager,
  vpsName: string,
  original: VPSConfig
): Promise<VPSConfig> {
  if (await tryConnection(original)) {
    return original;
  }

  if (original.auth.type !== 'password') {
    throw new Error('SSH 连接失败，请检查用户名/私钥配置');
  }

  for (const username of buildCandidateUsers(original.username)) {
    if (username === original.username) continue;
    const candidate: VPSConfig = { ...original, username };
    if (!(await tryConnection(candidate))) continue;

    console.log(
      chalk.yellow(`⚠ 账号 ${original.username} 连接失败，已自动切换到 ${username}（已回写配置）`)
    );
    configManager.setVPSConfig(vpsName, candidate);
    return candidate;
  }

  throw new Error('SSH 连接失败，请检查 IP/端口/用户名/密码');
}

async function commandExists(vpsConfig: VPSConfig, command: string): Promise<boolean> {
  const ssh = await sshPool.getConnection(vpsConfig);
  const result = await ssh.exec(`command -v ${command} >/dev/null 2>&1; echo $?`);
  return result.stdout.trim().endsWith('0');
}

async function detectSudoReady(vpsConfig: VPSConfig, whoami: string): Promise<boolean> {
  if (whoami === 'root') return true;
  const ssh = await sshPool.getConnection(vpsConfig);
  const result = await ssh.exec(buildRemoteCommand(vpsConfig, 'echo sudo-ready'));
  return result.exitCode === 0;
}

async function detectRemoteRuntime(vpsConfig: VPSConfig): Promise<RemoteRuntime> {
  const ssh = await sshPool.getConnection(vpsConfig);
  const whoamiResult = await ssh.exec('whoami');
  const whoami = whoamiResult.stdout.trim() || vpsConfig.username;

  const hasPython = await commandExists(vpsConfig, 'python3');
  const hasDocker = await commandExists(vpsConfig, 'docker');
  const sudoReady = await detectSudoReady(vpsConfig, whoami);

  return { whoami, hasPython, hasDocker, sudoReady };
}

async function selectVpsConfig(configManager: ConfigManager): Promise<{
  vpsName: string;
  vpsConfig: VPSConfig;
}> {
  const merged = configManager.getMergedConfig();
  const vpsNames = merged.vps ? Object.keys(merged.vps) : [];
  if (vpsNames.length === 0) {
    throw new Error('请先运行 `deploy vps add` 添加 VPS');
  }

  const answer = await inquirer.prompt([
    { type: 'list', name: 'vps', message: '选择目标 VPS:', choices: vpsNames },
  ]);
  return {
    vpsName: answer.vps,
    vpsConfig: merged.vps[answer.vps] as VPSConfig,
  };
}

function validateDeployPreconditions(configManager: ConfigManager, portRaw: string): number {
  if (!configManager.getProjectConfig()) {
    throw new Error('请先运行 `deploy init` 初始化项目');
  }

  const port = parsePort(portRaw);
  if (!port) {
    throw new Error('端口不合法，请传入 1-65535 的整数');
  }
  return port;
}

function buildRemotePaths(projectName: string, env: string, vpsConfig: VPSConfig): RemotePaths {
  const homeDir = vpsConfig.username === 'root' ? '/root' : `/home/${vpsConfig.username}`;
  const safeProjectName = sanitizeName(projectName);
  const safeEnv = sanitizeName(env);
  const remoteDir = `${homeDir}/.shipwright/apps/${safeProjectName}`;

  return {
    remoteDir,
    remoteTar: `${remoteDir}/dist.tgz`,
    serviceName: `shipwright-${safeProjectName}-${safeEnv}`,
  };
}

function buildUnitContent(paths: RemotePaths, context: DeployContext): string {
  return `[Unit]
Description=Shipwright static app ${context.projectName} (${context.env})
After=network.target

[Service]
Type=simple
User=${context.vpsConfig.username}
WorkingDirectory=${paths.remoteDir}
ExecStart=/usr/bin/python3 -m http.server ${context.port} --directory ${paths.remoteDir}/dist
Restart=always
RestartSec=3
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
`;
}

function buildDeployScript(paths: RemotePaths, unitContent: string): string {
  const escapedUnit = quoteSingle(unitContent);
  const escapedServiceName = quoteSingle(paths.serviceName);

  return [
    `mkdir -p "${paths.remoteDir}"`,
    `rm -rf "${paths.remoteDir}/dist"`,
    `tar -xzf "${paths.remoteTar}" -C "${paths.remoteDir}"`,
    `printf '%s' '${escapedUnit}' > "/tmp/${escapedServiceName}.service"`,
    `mv "/tmp/${escapedServiceName}.service" "/etc/systemd/system/${escapedServiceName}.service"`,
    'systemctl daemon-reload',
    `systemctl enable --now "${paths.serviceName}.service"`,
  ].join(' && ');
}

async function uploadArtifact(context: DeployContext, paths: RemotePaths, artifactPath: string): Promise<void> {
  const ssh = await sshPool.getConnection(context.vpsConfig);
  const spinner = ora('正在上传构建产物到 VPS...').start();

  await ssh.exec(`mkdir -p "${paths.remoteDir}"`);
  await ssh.uploadFile(artifactPath, paths.remoteTar);
  spinner.succeed('构建产物上传完成');
}

async function runDeployScript(context: DeployContext, paths: RemotePaths): Promise<void> {
  const ssh = await sshPool.getConnection(context.vpsConfig);
  const spinner = ora('正在发布并启动 systemd 服务...').start();
  const script = buildDeployScript(paths, buildUnitContent(paths, context));

  const result = await ssh.exec(buildRemoteCommand(context.vpsConfig, script));
  if (result.exitCode === 0) {
    spinner.succeed('服务发布成功');
    return;
  }

  spinner.fail('服务启动失败');
  throw new Error(result.stderr || result.stdout || '部署脚本执行失败');
}

async function checkServiceHealth(context: DeployContext, paths: RemotePaths): Promise<void> {
  const ssh = await sshPool.getConnection(context.vpsConfig);
  const result = await ssh.exec(`curl -fsS --max-time 8 http://127.0.0.1:${context.port} >/dev/null; echo $?`);
  if (result.stdout.trim().endsWith('0')) return;

  const statusResult = await ssh.exec(
    buildRemoteCommand(
      context.vpsConfig,
      `systemctl --no-pager -l status "${paths.serviceName}.service" || true`
    )
  );
  throw new Error(
    `服务启动后未通过本机健康检查。\n${statusResult.stdout || statusResult.stderr || '请检查 systemd 日志'}`
  );
}

async function checkPublicReachability(host: string, port: number): Promise<boolean> {
  try {
    await runLocal(`curl -I --max-time 8 "http://${host}:${port}"`, process.cwd());
    return true;
  } catch {
    return false;
  }
}

function printPublicCheckResult(reachable: boolean, port: number): void {
  if (reachable) return;
  console.log(chalk.yellow(`\n⚠ 公网可达性检查失败：服务在 VPS 本机已就绪，但外网无法访问端口 ${port}。`));
  console.log(chalk.yellow(`  请检查云安全组/防火墙是否放行 TCP ${port}，然后重试访问。`));
}

function printDeploySuccess(host: string, paths: RemotePaths): void {
  console.log(chalk.green.bold('\n✅ 部署完成!\n'));
  console.log(chalk.gray(`  服务名: ${paths.serviceName}`));
  console.log(chalk.gray(`  发布目录: ${paths.remoteDir}`));
  console.log(chalk.gray(`  访问地址: http://${host}`));
}

function printDryRun(vpsName: string, port: number): void {
  console.log(chalk.yellow('⚠ dry-run 模式，以下是将执行的动作:'));
  console.log(chalk.gray('  1) 本地构建并打包 dist'));
  console.log(chalk.gray(`  2) 通过 SSH 上传到 ${vpsName}`));
  console.log(chalk.gray(`  3) 在 VPS 上创建 systemd 服务并监听 ${port}`));
  console.log(chalk.gray(`  4) 进行 http://127.0.0.1:${port} 健康检查\n`));
}

async function prepareDeployContext(
  options: DeployOptions,
  configManager: ConfigManager
): Promise<DeployContext> {
  const port = validateDeployPreconditions(configManager, options.port);
  const selected = await selectVpsConfig(configManager);
  const reachableConfig = await resolveReachableVpsConfig(configManager, selected.vpsName, selected.vpsConfig);
  const projectDir = process.cwd();
  const projectConfig = configManager.getProjectConfig()!;
  const projectName = projectConfig.name || path.basename(projectDir);

  return {
    vpsName: selected.vpsName,
    vpsConfig: reachableConfig,
    projectName,
    projectDir,
    port,
    env: options.env,
  };
}

async function ensureRemoteReady(context: DeployContext): Promise<void> {
  const runtime = await detectRemoteRuntime(context.vpsConfig);
  if (!runtime.sudoReady) {
    throw new Error(`远程用户 ${runtime.whoami} 无 sudo 权限，无法写入 systemd。`);
  }
  if (!runtime.hasPython) {
    throw new Error('目标 VPS 未安装 python3，无法启动静态服务。');
  }
}

export async function handleDeployCommand(options: DeployOptions, configManager: ConfigManager): Promise<void> {
  console.log(chalk.blue.bold('\n🚀 部署到 VPS\n'));

  let artifactPath = '';
  try {
    const context = await prepareDeployContext(options, configManager);
    await ensureLocalBuild(context.projectDir, options.skipBuild);
    artifactPath = await packDistArtifact(context.projectDir, context.projectName);

    if (options.dryRun) {
      printDryRun(context.vpsName, context.port);
      return;
    }

    await ensureRemoteReady(context);
    const paths = buildRemotePaths(context.projectName, context.env, context.vpsConfig);
    await uploadArtifact(context, paths, artifactPath);
    await runDeployScript(context, paths);
    await checkServiceHealth(context, paths);

    const reachable = await checkPublicReachability(context.vpsConfig.host, context.port);
    printDeploySuccess(`${context.vpsConfig.host}:${context.port}`, paths);
    printPublicCheckResult(reachable, context.port);
    console.log();
  } catch (error: any) {
    console.log(chalk.red(`\n✗ 部署失败: ${error.message}\n`));
  } finally {
    if (artifactPath && fs.existsSync(artifactPath)) {
      fs.unlinkSync(artifactPath);
    }
  }
}

function printVpsRuntime(runtime: RemoteRuntime): void {
  console.log(chalk.green('✓ SSH 连接成功'));
  console.log(chalk.gray(`  当前用户: ${runtime.whoami}`));
  console.log(chalk.gray(`  Python3: ${runtime.hasPython ? '已安装' : '未安装'}`));
  console.log(chalk.gray(`  Docker: ${runtime.hasDocker ? '已安装' : '未安装'}`));
  console.log(chalk.gray(`  sudo 权限: ${runtime.sudoReady ? '可用' : '不可用'}`));
  console.log();
}

async function selectVpsForTest(configManager: ConfigManager): Promise<{ name: string; config: VPSConfig }> {
  const merged = configManager.getMergedConfig();
  const names = merged.vps ? Object.keys(merged.vps) : [];
  if (!names.length) {
    throw new Error('暂无 VPS 配置，请先执行 `deploy vps add`');
  }
  const pick = await inquirer.prompt([
    { type: 'list', name: 'vps', message: '选择要测试的 VPS:', choices: names },
  ]);
  return {
    name: pick.vps,
    config: merged.vps[pick.vps] as VPSConfig,
  };
}

export async function handleVpsTestCommand(configManager: ConfigManager): Promise<void> {
  console.log(chalk.blue.bold('\n🔌 测试 VPS 连接\n'));
  try {
    const selected = await selectVpsForTest(configManager);
    const config = await resolveReachableVpsConfig(configManager, selected.name, selected.config);
    const runtime = await detectRemoteRuntime(config);
    printVpsRuntime(runtime);
  } catch (error: any) {
    console.log(chalk.red(`✗ 连接失败: ${error.message}\n`));
  }
}
