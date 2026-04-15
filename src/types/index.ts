// ============================================
// Core Types - 类型定义
// ============================================

// VPS 配置
export interface VPSConfig {
  host: string;
  port: number;
  username: string;
  auth: {
    type: 'password' | 'privateKey';
    password?: string;
    privateKeyPath?: string;
  };
}

// 环境配置
export interface EnvConfig {
  name: string;
  vars: Record<string, string>;
  secrets: Record<string, string>; // 加密存储
  targets: TargetGroup[];
}

// 部署目标组
export interface TargetGroup {
  name: string;
  hosts: VPSConfig[];
  services: string[];
}

// 项目配置
export interface ProjectConfig {
  name: string;
  version: string;
  frontend?: ServiceConfig;
  backend?: ServiceConfig;
  environments: Record<string, EnvConfig>;
  defaultEnv: string;
}

// 服务配置
export interface ServiceConfig {
  type: 'react' | 'vue' | 'nestjs' | 'python' | 'express';
  path: string;
  port: number;
  buildCommand: string;
  outputDir: string;
  dockerfile?: string;
  dockerComposeService?: string;
}

// 部署状态
export interface DeploymentState {
  id: string;
  env: string;
  version: string;
  deployedAt: Date;
  commitHash: string;
  services: ServiceStatus[];
  rollbackId?: string;
}

export interface ServiceStatus {
  name: string;
  image: string;
  status: 'running' | 'stopped' | 'error';
  containerId?: string;
}

// SSH 执行结果
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// 构建上下文
export interface BuildContext {
  env: string;
  projectDir: string;
  services: string[];
  platform?: string[];
  noCache: boolean;
}

// 部署上下文
export interface DeployContext {
  env: string;
  targets: TargetGroup[];
  strategy: 'rolling' | 'blue-green' | 'canary';
  skipBuild: boolean;
  dryRun: boolean;
}

// 命令选项接口
export interface InitOptions {
  template: 'react-nestjs' | 'react-python' | 'fullstack' | 'custom';
  packageManager: 'npm' | 'yarn' | 'pnpm';
  envs: string[];
}

export interface BuildOptions {
  env: string;
  platform?: string[];
  noCache: boolean;
  push: boolean;
  tag?: string;
}

export interface DeployOptions {
  env: string;
  strategy: 'rolling' | 'blue-green' | 'canary';
  skipBuild: boolean;
  dryRun: boolean;
  timeout?: number;
}
