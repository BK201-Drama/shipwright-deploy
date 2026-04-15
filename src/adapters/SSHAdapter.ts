import { Client, ConnectConfig } from 'ssh2';
import * as fs from 'fs';
import * as os from 'os';
import { VPSConfig, ExecResult } from '../types';
import ora from 'ora';
import chalk from 'chalk';

/**
 * SSH 适配器 - 远程执行引擎
 */
export class SSHAdapter {
  private client: Client | null = null;
  private config: VPSConfig;
  private connected: boolean = false;

  constructor(config: VPSConfig) {
    this.config = config;
  }

  // 连接 VPS
  async connect(): Promise<void> {
    const spinner = ora(`正在连接 ${this.config.host}...`).start();
    
    return new Promise((resolve, reject) => {
      this.client = new Client();
      
      const connectConfig: ConnectConfig = {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        readyTimeout: 30000,
      };

      if (this.config.auth.type === 'password') {
        connectConfig.password = this.config.auth.password;
      } else if (this.config.auth.type === 'privateKey') {
        connectConfig.privateKey = fs.readFileSync(this.config.auth.privateKeyPath!);
      }

      this.client.on('ready', () => {
        this.connected = true;
        spinner.succeed(`已连接到 ${this.config.host}`);
        resolve();
      });

      this.client.on('error', (err) => {
        spinner.fail(`连接失败: ${err.message}`);
        reject(err);
      });

      this.client.connect(connectConfig);
    });
  }

  // 执行命令
  async exec(command: string): Promise<ExecResult> {
    if (!this.client || !this.connected) {
      throw new Error('Not connected to VPS');
    }

    return new Promise((resolve, reject) => {
      this.client!.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        let stdout = '';
        let stderr = '';

        stream.on('close', (code: number) => {
          resolve({ stdout, stderr, exitCode: code });
        });

        stream.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
      });
    });
  }

  // 执行命令（带输出实时显示）
  async execWithStream(command: string, onData?: (data: string) => void): Promise<ExecResult> {
    if (!this.client || !this.connected) {
      throw new Error('Not connected to VPS');
    }

    return new Promise((resolve, reject) => {
      this.client!.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        let stdout = '';
        let stderr = '';

        stream.on('close', (code: number) => {
          resolve({ stdout, stderr, exitCode: code });
        });

        stream.on('data', (data: Buffer) => {
          const str = data.toString();
          stdout += str;
          if (onData) onData(str);
        });

        stream.stderr.on('data', (data: Buffer) => {
          const str = data.toString();
          stderr += str;
          if (onData) onData(chalk.yellow(str));
        });
      });
    });
  }

  // 上传文件
  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    if (!this.client || !this.connected) {
      throw new Error('Not connected to VPS');
    }

    return new Promise((resolve, reject) => {
      this.client!.sftp((err, sftp) => {
        if (err) {
          reject(err);
          return;
        }

        sftp.fastPut(localPath, remotePath, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    });
  }

  // 下载文件
  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    if (!this.client || !this.connected) {
      throw new Error('Not connected to VPS');
    }

    return new Promise((resolve, reject) => {
      this.client!.sftp((err, sftp) => {
        if (err) {
          reject(err);
          return;
        }

        sftp.fastGet(remotePath, localPath, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    });
  }

  // 断开连接
  disconnect(): void {
    if (this.client) {
      this.client.end();
      this.client = null;
      this.connected = false;
    }
  }

  // 检查连接状态
  isConnected(): boolean {
    return this.connected;
  }
}

// 连接池管理
export class SSHConnectionPool {
  private connections: Map<string, SSHAdapter> = new Map();

  async getConnection(config: VPSConfig): Promise<SSHAdapter> {
    const key = `${config.username}@${config.host}:${config.port}`;
    
    let adapter = this.connections.get(key);
    if (!adapter || !adapter.isConnected()) {
      adapter = new SSHAdapter(config);
      await adapter.connect();
      this.connections.set(key, adapter);
    }

    return adapter;
  }

  disconnectAll(): void {
    this.connections.forEach((adapter) => adapter.disconnect());
    this.connections.clear();
  }
}

export const sshPool = new SSHConnectionPool();
