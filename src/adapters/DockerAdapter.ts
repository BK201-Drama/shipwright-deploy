import { exec as execSync, spawn } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import ora from 'ora';
import chalk from 'chalk';
import { BuildOptions, ServiceConfig } from '../types';

const exec = promisify(execSync);

/**
 * Docker 构建适配器
 */
export class DockerAdapter {
  private projectDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  // 检查 Docker 是否安装
  async checkDocker(): Promise<boolean> {
    try {
      await exec('docker --version');
      return true;
    } catch {
      return false;
    }
  }

  // 构建镜像
  async buildImage(options: BuildOptions, service: ServiceConfig): Promise<void> {
    const spinner = ora(`正在构建 ${service.type} 镜像...`).start();
    
    const tag = options.tag || `${options.env}-${service.type}:latest`;
    const platformFlag = options.platform?.length 
      ? `--platform ${options.platform.join(',')}` 
      : '';
    const noCacheFlag = options.noCache ? '--no-cache' : '';

    const dockerfilePath = path.join(service.path, service.dockerfile || 'Dockerfile');
    
    const cmd = `docker build ${platformFlag} ${noCacheFlag} -t ${tag} -f ${dockerfilePath} ${service.path}`;
    
    try {
      await exec(cmd, { cwd: this.projectDir });
      spinner.succeed(`镜像构建完成: ${tag}`);
    } catch (error: any) {
      spinner.fail(`构建失败: ${error.message}`);
      throw error;
    }
  }

  // 推送镜像
  async pushImage(tag: string): Promise<void> {
    const spinner = ora(`正在推送镜像 ${tag}...`).start();
    
    try {
      await exec(`docker push ${tag}`);
      spinner.succeed(`镜像推送完成: ${tag}`);
    } catch (error: any) {
      spinner.fail(`推送失败: ${error.message}`);
      throw error;
    }
  }

  // 拉取镜像
  async pullImage(tag: string): Promise<void> {
    const spinner = ora(`正在拉取镜像 ${tag}...`).start();
    
    try {
      await exec(`docker pull ${tag}`);
      spinner.succeed(`镜像拉取完成: ${tag}`);
    } catch (error: any) {
      spinner.fail(`拉取失败: ${error.message}`);
      throw error;
    }
  }

  // 运行容器
  async runContainer(imageTag: string, port: number, name?: string): Promise<void> {
    const containerName = name || imageTag.split(':')[0];
    const cmd = `docker run -d --name ${containerName} -p ${port}:${port} ${imageTag}`;
    
    try {
      await exec(cmd);
      console.log(chalk.green(`✓ 容器启动: ${containerName}`));
    } catch (error: any) {
      if (error.message.includes('already in use')) {
        await exec(`docker restart ${containerName}`);
        console.log(chalk.yellow(`⚠ 容器已重启: ${containerName}`));
      } else {
        throw error;
      }
    }
  }

  // Docker Compose 部署
  async composeUp(env: string, projectDir?: string): Promise<void> {
    const spinner = ora('正在启动服务...').start();
    const workDir = projectDir || this.projectDir;
    
    try {
      await exec(`docker-compose -f ${path.join(workDir, 'docker-compose.yml')} up -d`, {
        cwd: workDir,
      });
      spinner.succeed('服务启动完成');
    } catch (error: any) {
      spinner.fail(`启动失败: ${error.message}`);
      throw error;
    }
  }

  // Docker Compose 停止
  async composeDown(projectDir?: string): Promise<void> {
    const spinner = ora('正在停止服务...').start();
    const workDir = projectDir || this.projectDir;
    
    try {
      await exec(`docker-compose -f ${path.join(workDir, 'docker-compose.yml')} down`, {
        cwd: workDir,
      });
      spinner.succeed('服务已停止');
    } catch (error: any) {
      spinner.fail(`停止失败: ${error.message}`);
      throw error;
    }
  }

  // 查看容器状态
  async getContainerStatus(): Promise<any[]> {
    try {
      const { stdout } = await exec('docker-compose ps --format json', {
        cwd: this.projectDir,
      });
      return stdout ? JSON.parse(`[${stdout.replace(/\n/g, ',')}]`) : [];
    } catch {
      return [];
    }
  }

  // 查看日志 (实时)
  logs(service: string, follow: boolean = false): void {
    const followFlag = follow ? '-f' : '';
    spawn(`docker-compose logs ${followFlag} ${service}`, {
      cwd: this.projectDir,
      shell: true,
      stdio: 'inherit',
    });
  }
}
