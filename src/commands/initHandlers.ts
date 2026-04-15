// ============================================
// init 命令处理器 - 项目脚手架
// ============================================

import * as fs from 'fs';
import * as path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { 
  generateTemplate, 
  writeTemplateFile, 
  TemplateOptions 
} from '../templates/index';
import { ConfigManager } from '../config/ConfigManager';

const configManager = new ConfigManager();

export interface InitAnswers {
  template: 'react-nestjs' | 'react-python' | 'fullstack' | 'custom';
  packageManager: 'npm' | 'yarn' | 'pnpm';
  projectName: string;
  frontendPort: number;
  backendPort: number;
  includeDocker: boolean;
  includeNginx: boolean;
  envs: string[];
}

/**
 * 初始化项目
 */
export async function handleInit(options: Partial<InitAnswers> = {}): Promise<void> {
  console.log(chalk.blue.bold('\n🚀 初始化 Deploy 项目\n'));

  // 交互式问答
  const answers = await inquirer.prompt<InitAnswers>([
    {
      type: 'input',
      name: 'projectName',
      message: '项目名称:',
      default: path.basename(process.cwd()),
      when: !options.projectName,
    },
    {
      type: 'list',
      name: 'template',
      message: '选择技术栈模板:',
      choices: [
        { name: 'React + NestJS (推荐)', value: 'react-nestjs' },
        { name: 'React + Python (FastAPI)', value: 'react-python' },
        { name: 'Fullstack (Monorepo)', value: 'fullstack' },
        { name: '自定义配置', value: 'custom' },
      ],
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
      type: 'number',
      name: 'frontendPort',
      message: '前端端口:',
      default: 80,
      when: (ans) => ans.template !== 'custom',
    },
    {
      type: 'number',
      name: 'backendPort',
      message: '后端端口:',
      default: 3000,
      when: (ans) => ans.template !== 'custom',
    },
    {
      type: 'confirm',
      name: 'includeDocker',
      message: '生成 Docker 配置?',
      default: true,
    },
    {
      type: 'confirm',
      name: 'includeNginx',
      message: '生成 Nginx 配置?',
      default: true,
      when: (ans) => ans.includeDocker,
    },
    {
      type: 'checkbox',
      name: 'envs',
      message: '选择环境:',
      choices: [
        { name: 'dev (开发)', checked: true },
        { name: 'staging (测试)', checked: true },
        { name: 'prod (生产)', checked: true },
      ],
      default: options.envs || ['dev', 'staging', 'prod'],
    },
  ]);

  // 合并选项
  const config: InitAnswers = { ...options, ...answers } as InitAnswers;
  
  // 创建目录结构
  const projectDir = process.cwd();
  const spinner = ora('正在生成项目结构...').start();

  try {
    // 创建目录
    createDirectoryStructure(projectDir, config);

    // 生成模板文件
    const templateOptions: TemplateOptions = {
      projectName: config.projectName,
      frontend: config.template.includes('react') || config.template === 'fullstack' 
        ? { type: 'react', port: config.frontendPort || 80 } 
        : undefined,
      backend: config.template === 'react-nestjs' || config.template === 'fullstack'
        ? { type: 'nestjs', port: config.backendPort || 3000 }
        : config.template === 'react-python'
        ? { type: 'python', port: config.backendPort || 8000 }
        : undefined,
      env: 'dev',
    };

    // 生成 Docker 配置
    if (config.includeDocker) {
      generateDockerFiles(projectDir, templateOptions, config);
    }

    // 生成环境配置文件
    generateEnvFiles(projectDir, config.envs);

    // 生成 deploy.config.json
    const deployConfig = generateTemplate('deploy-config', templateOptions);
    writeTemplateFile(projectDir, 'deploy.config.json', deployConfig);

    // 生成 .gitignore
    generateGitignore(projectDir);

    // 生成 README
    generateReadme(projectDir, config);

    spinner.succeed('项目结构生成完成');

    // 显示下一步提示
    showNextSteps(config);

  } catch (error: any) {
    spinner.fail(`生成失败: ${error.message}`);
    throw error;
  }
}

/**
 * 创建目录结构
 */
function createDirectoryStructure(baseDir: string, config: InitAnswers): void {
  const dirs = ['docker', 'scripts', 'envs', '.deploy-cli'];
  
  if (config.template.includes('react')) {
    dirs.push('frontend');
  }
  if (config.template !== 'custom') {
    dirs.push('backend');
  }

  dirs.forEach(dir => {
    const dirPath = path.join(baseDir, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  });
}

/**
 * 生成 Docker 相关文件
 */
function generateDockerFiles(
  baseDir: string, 
  options: TemplateOptions, 
  config: InitAnswers
): void {
  const dockerDir = path.join(baseDir, 'docker');

  // 前端 Dockerfile
  if (options.frontend) {
    const frontendDf = generateTemplate('dockerfile-frontend', options);
    writeTemplateFile(baseDir, 'frontend/Dockerfile', frontendDf);
    
    if (config.includeNginx) {
      const nginxConf = generateTemplate('nginx', options);
      writeTemplateFile(baseDir, 'frontend/nginx.conf', nginxConf);
    }
  }

  // 后端 Dockerfile
  if (options.backend) {
    const backendDf = generateTemplate('dockerfile-backend', options);
    writeTemplateFile(baseDir, 'backend/Dockerfile', backendDf);
  }

  // Docker Compose
  const compose = generateTemplate('docker-compose', options);
  writeTemplateFile(baseDir, 'docker-compose.yml', compose);
}

/**
 * 生成环境配置文件
 */
function generateEnvFiles(baseDir: string, envs: string[]): void {
  const envsDir = path.join(baseDir, 'envs');
  
  // .env.example
  writeTemplateFile(envsDir, '.env.example', `# Environment Variables Template
# Copy this file to .env and fill in values

# Application
NODE_ENV=development

# Frontend
FRONTEND_PORT=80

# Backend  
BACKEND_PORT=3000

# Database
DATABASE_URL=

# Add your secrets below
`);

  // 各环境配置
  envs.forEach(env => {
    const envContent = generateTemplate('env', { ...{} as any, env });
    writeTemplateFile(envsDir, `${env}.env`, envContent);
  });
}

/**
 * 生成 .gitignore
 */
function generateGitignore(baseDir: string): void {
  const content = `# Dependencies
node_modules/

# Build output
dist/
build/

# Environment
.env
.env.local
.env.*.local
envs/*.local.env

# IDE
.idea/
.vscode/
*.swp

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*

# Deploy CLI
.deploy-cli/state.json
.deploy-cli/history/

# Secrets (never commit)
*.secret.json
*.pem
*.key
`;
  writeTemplateFile(baseDir, '.gitignore', content);
}

/**
 * 生成 README
 */
function generateReadme(baseDir: string, config: InitAnswers): void {
  const content = `# ${config.projectName}

## 快速开始

\`\`\`bash
# 1. 配置 VPS
deploy vps add

# 2. 本地构建
deploy build --env dev

# 3. 部署到 VPS
deploy deploy --env dev
\`\`\`

## 项目结构

\`\`\`
${config.projectName}/
├── frontend/          # 前端代码
│   └── Dockerfile
├── backend/           # 后端代码
│   └── Dockerfile
├── docker/            # Docker 配置
├── envs/              # 环境配置
├── scripts/           # 部署脚本
├── docker-compose.yml
├── deploy.config.json
└── README.md
\`\`\`

## 环境管理

- **dev**: 开发环境
- **staging**: 测试环境  
- **prod**: 生产环境

## 部署命令

\`\`\`bash
deploy build --env <env>       # 构建
deploy deploy --env <env>      # 部署
deploy status                  # 查看状态
deploy logs [service]          # 查看日志
deploy rollback                # 回滚
\`\`\`

## License

MIT
`;
  writeTemplateFile(baseDir, 'README.md', content);
}

/**
 * 显示下一步提示
 */
function showNextSteps(config: InitAnswers): void {
  console.log(chalk.green.bold('\n✓ 项目初始化完成!\n'));
  console.log(chalk.gray('下一步操作:\n'));
  console.log(chalk.cyan('  1.'), '配置 VPS:');
  console.log(chalk.gray('     deploy vps add\n'));
  console.log(chalk.cyan('  2.'), '构建镜像:');
  console.log(chalk.gray('     deploy build --env dev\n'));
  console.log(chalk.cyan('  3.'), '部署到 VPS:');
  console.log(chalk.gray('     deploy deploy --env dev\n'));
  
  if (config.includeDocker) {
    console.log(chalk.yellow('\n提示: '), 'Docker 配置已生成，请确保已安装 Docker');
  }
}
