import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ProjectConfig, VPSConfig, EnvConfig } from '../types';

const HOME_DIR = os.homedir();
const CLI_CONFIG_DIR = path.join(HOME_DIR, '.easy-deploy');
const PROJECT_CONFIG_FILE = 'deploy.config.json';

/**
 * 配置管理器 - 多层配置合并
 * priority: CLI args > env-specific > project-config > global-defaults
 */
export class ConfigManager {
  private globalConfig: Record<string, any> = {};
  private projectConfig: ProjectConfig | null = null;
  private projectPath: string = process.cwd();

  constructor(projectPath?: string) {
    if (projectPath) {
      this.projectPath = projectPath;
    }
    this.ensureConfigDir();
    this.loadGlobalConfig();
    this.loadProjectConfig();
  }

  private ensureConfigDir(): void {
    if (!fs.existsSync(CLI_CONFIG_DIR)) {
      fs.mkdirSync(CLI_CONFIG_DIR, { recursive: true });
    }
  }

  // 加载全局配置 (~/.easy-deploy/config.json)
  private loadGlobalConfig(): void {
    const globalConfigPath = path.join(CLI_CONFIG_DIR, 'config.json');
    if (fs.existsSync(globalConfigPath)) {
      try {
        this.globalConfig = JSON.parse(fs.readFileSync(globalConfigPath, 'utf-8'));
      } catch (e) {
        console.warn('Failed to load global config:', e);
      }
    }
  }

  // 保存全局配置
  saveGlobalConfig(): void {
    const globalConfigPath = path.join(CLI_CONFIG_DIR, 'config.json');
    fs.writeFileSync(globalConfigPath, JSON.stringify(this.globalConfig, null, 2));
  }

  // 加载项目配置 (./deploy.config.json)
  private loadProjectConfig(): void {
    const configPath = path.join(this.projectPath, PROJECT_CONFIG_FILE);
    if (fs.existsSync(configPath)) {
      try {
        this.projectConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      } catch (e) {
        console.warn('Failed to load project config:', e);
      }
    }
  }

  // 保存项目配置
  saveProjectConfig(): void {
    if (!this.projectConfig) return;
    const configPath = path.join(this.projectPath, PROJECT_CONFIG_FILE);
    fs.writeFileSync(configPath, JSON.stringify(this.projectConfig, null, 2));
  }

  // 获取项目配置
  getProjectConfig(): ProjectConfig | null {
    return this.projectConfig;
  }

  // 设置项目配置
  setProjectConfig(config: ProjectConfig): void {
    this.projectConfig = config;
    this.saveProjectConfig();
  }

  // 获取环境配置
  getEnvConfig(envName: string): EnvConfig | null {
    if (!this.projectConfig) return null;
    return this.projectConfig.environments[envName] || null;
  }

  // 添加/更新环境
  setEnvConfig(envName: string, config: EnvConfig): void {
    if (!this.projectConfig) {
      this.projectConfig = {
        name: path.basename(this.projectPath),
        version: '1.0.0',
        environments: {},
        defaultEnv: envName,
      };
    }
    this.projectConfig.environments[envName] = config;
    this.saveProjectConfig();
  }

  // 获取 VPS 配置
  getVPSConfig(name?: string): VPSConfig | VPSConfig[] | null {
    const vpsConfigs = this.globalConfig.vps?.[name || 'default'];
    return vpsConfigs || null;
  }

  // 保存 VPS 配置
  setVPSConfig(name: string, config: VPSConfig): void {
    if (!this.globalConfig.vps) {
      this.globalConfig.vps = {};
    }
    this.globalConfig.vps[name] = config;
    this.saveGlobalConfig();
  }

  // 获取镜像仓库配置
  getRegistryConfig(): { registry: string; username: string; password?: string } | null {
    return this.globalConfig.registry || null;
  }

  // 设置镜像仓库配置
  setRegistryConfig(config: { registry: string; username: string; password?: string }): void {
    this.globalConfig.registry = config;
    this.saveGlobalConfig();
  }

  // 获取合并后的配置（运行时）
  getMergedConfig(env?: string): Record<string, any> {
    const config: Record<string, any> = {
      ...this.globalConfig,
      ...(this.projectConfig || {}),
    };

    if (env && this.projectConfig?.environments[env]) {
      Object.assign(config, this.projectConfig.environments[env]);
    }

    return config;
  }

  // 获取 CLI 配置目录
  getConfigDir(): string {
    return CLI_CONFIG_DIR;
  }
}

export const configManager = new ConfigManager();
