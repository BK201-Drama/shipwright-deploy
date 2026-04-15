// ============================================
// 模板生成器 - Dockerfile / docker-compose / nginx 配置
// ============================================

import * as fs from 'fs';
import * as path from 'path';

export interface TemplateOptions {
  projectName: string;
  frontend?: {
    type: 'react' | 'vue';
    port: number;
  };
  backend?: {
    type: 'nestjs' | 'python' | 'express';
    port: number;
  };
  env: string;
}

// React 前端 Dockerfile
export const reactDockerfile = (options: TemplateOptions): string => `
# ====================
# Frontend: ${options.frontend?.type || 'react'}
# ====================
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE ${options.frontend?.port || 80}
CMD ["nginx", "-g", "daemon off;"]
`;

// NestJS 后端 Dockerfile
export const nestjsDockerfile = (options: TemplateOptions): string => `
# ====================
# Backend: NestJS
# ====================
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
EXPOSE ${options.backend?.port || 3000}
CMD ["node", "dist/main.js"]
`;

// Python 后端 Dockerfile
export const pythonDockerfile = (options: TemplateOptions): string => `
# ====================
# Backend: Python
# ====================
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE ${options.backend?.port || 8000}
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "${options.backend?.port || 8000}"]
`;

// Docker Compose 模板
export const dockerComposeTemplate = (options: TemplateOptions): string => `
version: '3.8'

services:
${options.frontend ? `  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    ports:
      - "\${FRONTEND_PORT:-${options.frontend.port}}:80"
    environment:
      - NODE_ENV=\${NODE_ENV:-production}
    restart: unless-stopped
` : ''}${options.backend ? `  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "\${BACKEND_PORT:-${options.backend.port}}:${options.backend.port}"
    environment:
      - NODE_ENV=\${NODE_ENV:-production}
      - DATABASE_URL=\${DATABASE_URL}
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:${options.backend.port}/health"]
      interval: 30s
      timeout: 10s
      retries: 3
` : ''}
networks:
  default:
    name: ${options.projectName}-network
`;

// Nginx 配置模板
export const nginxConfigTemplate = (): string => `
events {
    worker_connections 1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;
    
    sendfile        on;
    keepalive_timeout  65;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    server {
        listen 80;
        server_name localhost;
        
        root /usr/share/nginx/html;
        index index.html;

        location / {
            try_files $uri $uri/ /index.html;
        }

        location /api {
            proxy_pass http://backend:3000;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }
    }
}
`;

// Nginx 反向代理配置（带 SSL）
export const nginxSSLConfig = (domain: string): string => `
server {
    listen 80;
    server_name ${domain};
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${domain};

    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
    
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;

    location / {
        proxy_pass http://frontend:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api {
        proxy_pass http://backend:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
`;

// 环境配置模板
export const envTemplate = (env: string): string => `
# ${env.toUpperCase()} Environment
NODE_ENV=${env}

# Frontend
FRONTEND_PORT=80

# Backend
BACKEND_PORT=3000

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/${env}

# Add your environment variables below
`;

// 项目配置文件模板
export const deployConfigTemplate = (options: TemplateOptions): string => JSON.stringify({
  name: options.projectName,
  version: '1.0.0',
  frontend: options.frontend ? {
    type: options.frontend.type,
    path: './frontend',
    port: options.frontend.port,
  } : undefined,
  backend: options.backend ? {
    type: options.backend.type,
    path: './backend',
    port: options.backend.port,
  } : undefined,
  environments: {
    dev: { name: 'dev', vars: {}, secrets: {}, targets: [] },
    staging: { name: 'staging', vars: {}, secrets: {}, targets: [] },
    prod: { name: 'prod', vars: {}, secrets: {}, targets: [] },
  },
  defaultEnv: 'dev',
}, null, 2);

// 生成模板文件
export function generateTemplate(
  type: 'dockerfile-frontend' | 'dockerfile-backend' | 'docker-compose' | 'nginx' | 'nginx-ssl' | 'env' | 'deploy-config',
  options: TemplateOptions,
  domain?: string
): string {
  switch (type) {
    case 'dockerfile-frontend':
      return reactDockerfile(options);
    case 'dockerfile-backend':
      return options.backend?.type === 'nestjs' 
        ? nestjsDockerfile(options) 
        : pythonDockerfile(options);
    case 'docker-compose':
      return dockerComposeTemplate(options);
    case 'nginx':
      return nginxConfigTemplate();
    case 'nginx-ssl':
      return nginxSSLConfig(domain || 'example.com');
    case 'env':
      return envTemplate(options.env);
    case 'deploy-config':
      return deployConfigTemplate(options);
    default:
      return '';
  }
}

// 写入模板文件到目录
export function writeTemplateFile(
  targetPath: string,
  filename: string,
  content: string
): void {
  const filePath = path.join(targetPath, filename);
  fs.writeFileSync(filePath, content, 'utf-8');
}
