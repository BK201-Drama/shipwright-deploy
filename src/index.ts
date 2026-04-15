#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { registerCommands } from './commands';

const program = new Command();

// 版本信息
const VERSION = '1.0.0';

program
  .name('deploy')
  .description('Easy Deploy CLI - 一键部署前后端到 VPS')
  .version(VERSION);

// 注册命令
registerCommands(program);

// 解析参数
program.parse(process.argv);

// 无参数时显示帮助
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
