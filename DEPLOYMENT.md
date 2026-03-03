# AlphaCouncil 部署指南

## 📦 项目概述

AlphaCouncil 是一个多智能体股票分析决策系统，融合 12 位 AI 专家，给出综合研判。

### 技术栈
- **前端**: React + TypeScript + Vite + TailwindCSS
- **后端**: Node.js Express Server
- **AI模型**: Gemini 3 Pro/Flash, DeepSeek R1, 通义千问 Qwen Max
- **辅助服务**: Python Flask (K线图生成、金融数据API)

---

## 🖥️ 阿里云服务器配置

### 服务器规格
- **系统**: Ubuntu 22.04 LTS
- **配置**: 2核4G 或以上
- **带宽**: 5Mbps 或以上
- **IP**: 106.15.11.240 (示例)

### 已安装软件
```bash
# Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
apt-get install -y nodejs

# PM2 进程管理
npm install -g pm2

# Python 3 + pip
apt-get install -y python3 python3-pip python3-venv

# Nginx
apt-get install -y nginx

# Certbot (SSL证书)
apt-get install -y certbot python3-certbot-nginx
```

---

## 📁 服务器目录结构

```
/root/AlphaCouncil/
├── dist/                    # Vite 构建产物
├── server/                  # Node.js 服务端
│   ├── index.js            # Express 主入口
│   ├── rateLimiter.js      # 使用次数限制
│   └── usage_data.json     # 使用数据持久化
├── api/                     # API 处理器
│   ├── ai/                 # AI 接口
│   │   ├── gemini.js
│   │   ├── gemini-vision.js
│   │   ├── deepseek.js
│   │   └── qwen.js
│   ├── stock/              # 股票数据接口
│   └── kline-chart/        # K线图生成
├── package.json
└── node_modules/
```

---

## 🚀 部署步骤

### 1. 上传代码
```bash
# 在本地执行
scp -r AlphaCouncil-master root@YOUR_SERVER_IP:/root/AlphaCouncil
```

### 2. 安装依赖
```bash
ssh root@YOUR_SERVER_IP
cd /root/AlphaCouncil
npm install
```

### 3. 配置环境变量
```bash
# 创建 .env 文件或直接在 PM2 启动时设置
export GEMINI_API_KEY=你的Gemini密钥
export DEEPSEEK_API_KEY=你的DeepSeek密钥
export QWEN_API_KEY=你的通义千问密钥
export JUHE_API_KEY=你的聚合数据密钥
```

### 4. 构建前端
```bash
npm run build
```

### 5. 启动服务
```bash
# 主服务 (端口3000)
pm2 start server/index.js --name alphacouncil

# Python 金融API (端口5001)
cd server
python3 -m venv venv
source venv/bin/activate
pip install flask requests mplfinance matplotlib pandas
pm2 start "python3 financial_api.py" --name financial-api

# Python K线图API (端口5002)
pm2 start "python3 chart_api.py" --name chart-api

# 保存PM2配置
pm2 save
pm2 startup
```

### 6. 配置Nginx
```bash
cat > /etc/nginx/conf.d/alphacouncil.conf << 'EOF'
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # 前端
    location /AlphaCouncil/ {
        proxy_pass http://127.0.0.1:3000/AlphaCouncil/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }

    # API
    location /api/ {
        proxy_pass http://127.0.0.1:3000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
}
EOF

nginx -t && nginx -s reload
```

### 7. 申请SSL证书
```bash
certbot --nginx -d your-domain.com
```

---

## 🔑 API密钥获取

| 服务 | 获取地址 | 用途 |
|------|----------|------|
| Gemini | https://aistudio.google.com/ | 主力AI模型 |
| DeepSeek | https://platform.deepseek.com/ | 推理模型 |
| 通义千问 | https://dashscope.console.aliyun.com/ | 搜索增强 |
| 聚合数据 | https://www.juhe.cn/ | 股票数据 |

---

## 📊 PM2 常用命令

```bash
pm2 list              # 查看所有进程
pm2 logs alphacouncil # 查看日志
pm2 restart all       # 重启所有
pm2 stop alphacouncil # 停止服务
```

---

## 🛠️ 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

---

## 📝 注意事项

1. **Gemini API 需要代理**: 国内服务器无法直连 Google API，需要使用 Cloudflare Worker 代理
2. **聚合数据有调用限制**: 注意控制 API 调用频率
3. **PM2 重启后数据不丢失**: 使用 JSON 文件持久化使用次数

---

## 🔗 Cloudflare Worker 代理配置

文件: `gemini_proxy_worker.js`

部署到 Cloudflare Workers 后，在代码中设置:
```javascript
const GEMINI_PROXY_URL = 'https://your-worker.workers.dev';
```

---

## 📞 联系方式

如有问题，请联系项目负责人。
