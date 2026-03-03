# AlphaCouncil AI - 多智能体股票分析决策系统

![License](https://img.shields.io/badge/license-MIT-blue.svg) ![React](https://img.shields.io/badge/React-19.0-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue) ![Tailwind](https://img.shields.io/badge/Tailwind-3.0-38bdf8)

**AlphaCouncil AI** 是一个基于前沿大语言模型（LLM）技术的专业级 A 股市场分析系统。它模拟了一家顶级基金公司的完整投资委员会决策流程，由 **12 个不同角色的 AI 智能体** 组成，通过四阶段的严谨工作流，将实时行情数据转化为专业的投资分析报告。

## 核心特性

* **👥 12 位拟人化 AI 专家**：涵盖宏观、行业、大盘、技术、资金、基本面六大维度分析师，加上总监、风控、机会分析师和总经理。
* **🚀 四大顶级 AI 模型协同**：混合调度 **Gemini 3.1 Pro / 3 Flash**、**DeepSeek V3.2 / R1**、**通义千问 Qwen 3 Max Thinking** 和 **GPT-5.2 Pro**，按角色匹配最佳模型。
* **📈 实时数据驱动**：接入聚合数据 API + 东方财富实时资金流向，获取沪深 A 股的五档盘口、K 线、主力资金、北向资金等多维数据。
* **🔍 联网搜索验证**：基本面总监和风控总监具备 Google Search Grounding 联网能力，实时验证数据并搜索最新新闻/风险。
* **📊 K 线图视觉分析**：技术分析师通过 Gemini Vision 多模态能力，直接"看"K 线图识别形态。
* **⚡ 并行与串行工作流**：第一阶段 6 人并行分析，后续阶段串行整合、审核和决策，兼顾效率与逻辑连贯性。
* **🎨 赛博朋克沉浸式 UI**：深色界面 + 打字机动画 + 机械键盘音效 + 行业配置图表。
* **💎 Freemium 商业模式**：内置支付宝付费解锁功能（可选），免费用户可体验第一阶段分析。

---

## 🏛️ 智能体架构 (Agent Architecture)

系统共包含 **12 位 AI 专家**，分为四个层级：

### 第一阶段：专业分析师团队（6 人并行执行）

| 角色 | 使用模型 | 职责 |
| :--- | :--- | :--- |
| 🌐 **宏观政策分析师** | Gemini 3 Flash | 分析北向资金、货币政策及系统性风险 |
| 📊 **行业轮动专家** | Gemini 3 Flash | 跟踪行业景气度、轮动规律，输出配置图表 |
| 📈 **大盘趋势分析师** | Qwen Max | 专注大盘指数走势，判断个股 vs 大盘表现 |
| 📉 **技术分析专家** | Gemini 3 Flash + Vision | K 线图视觉分析、均线、支撑/阻力位、量价关系 |
| 💰 **资金流向分析师** | Gemini 3 Flash | 主力资金动向、盘口密码、出货预警/抄底信号 |
| 📑 **基本面估值分析师** | DeepSeek R1 | 一利五率财务分析、PE 估值、3 年趋势研判 |

### 第二阶段：总监管理团队（整合层）

| 角色 | 使用模型 | 职责 |
| :--- | :--- | :--- |
| 👥 **基本面研究总监** | Gemini 3.1 Pro 🌐 | 整合宏观/行业/估值报告，联网搜索验证数据，裁决分歧 |
| ⚡ **市场动能总监** | DeepSeek R1 | 整合技术面+资金面，判断动能方向与强度 |

### 第三阶段：风控与机会团队（审核层）

| 角色 | 使用模型 | 职责 |
| :--- | :--- | :--- |
| 🛡️ **系统性风险总监** | Qwen Max 🌐 | 联网搜索负面舆情，挖掘被忽略的风险，历史相似案例分析 |
| ⚖️ **组合风险总监** | DeepSeek R1 | 量化风控：止损位、仓位上限、风险收益比计算 |
| 🎯 **机会分析师** | Gemini 3.1 Pro | 逆向思维，发现被低估的机会，平衡风控的保守视角 |

### 第四阶段：最高决策层

| 角色 | 使用模型 | 职责 |
| :--- | :--- | :--- |
| ⚖️ **投资决策总经理** | GPT-5.2 Pro | 拥有最终拍板权。通盘权衡 11 位专家报告，给出买入/卖出/观望指令 |

> 🌐 标记表示该角色具备联网搜索能力（Google Search Grounding）

---

## ⚙️ 技术架构

### 1. 数据获取层 (Data Layer)
* **实时行情**：聚合数据 (Juhe Data) API — 五档盘口、成交量、涨跌幅
* **资金流向**：东方财富 API — 主力净流入、超大单/大单/中单/小单分类
* **北向资金**：沪股通 + 深股通实时净流入
* **K 线数据**：近 10 日日线 + 对应板块指数
* **财务数据**：基本面核心指标（ROE、负债率、毛利率等近 3 年趋势）
* **K 线图表**：服务端 Python (matplotlib) 生成 K 线图，供 Gemini Vision 视觉分析

### 2. AI 模型服务层 (Service Layer)
* **Gemini 3.1 Pro / 3 Flash**：通过 `@google/genai` SDK 调用，支持多 Key 轮询、Search Grounding 联网搜索、Vision 多模态
* **DeepSeek R1 / V3.2**：OpenAI 兼容格式 REST API
* **通义千问 Qwen Max / 3 Max Thinking**：OpenAI 兼容格式 REST API
* **GPT-5.2 Pro**：通过 OpenRouter 调用
* **Fallback 机制**：任一模型失败时，自动沿 fallback 链切换备用模型（Gemini → DeepSeek → Qwen）

### 3. 后端服务 (Node.js + Express)
* API 代理与 CORS 处理
* 浏览器指纹 + 频率限制（防滥用）
* 支付宝当面付 / H5 支付集成（可选）
* 订单管理与状态轮询

### 4. 前端交互层 (UI Layer)
* **React 19 + TypeScript**：Hooks 管理 12 智能体复杂状态
* **Tailwind CSS**：响应式布局，适配桌面与移动端
* **实时打字机动画**：逐字输出 AI 分析结果
* **Web Audio API**：机械键盘敲击音效
* **Recharts**：行业配置可视化图表

---

## 🚀 快速开始

### 环境要求
* Node.js 18+
* Python 3.8+（用于 K 线图生成，需安装 matplotlib）

### 本地开发

```bash
# 1. 克隆项目
git clone https://github.com/chenmisss/AlphaCouncil.git
cd AlphaCouncil

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env，填入你的 API Key

# 4. 启动开发服务器
npm run dev
```

### 部署到 VPS

```bash
# 构建前端
npm run build

# 启动后端服务（推荐使用 PM2）
pm2 start server/index.js --name alphacouncil

# 配置 Nginx 反向代理（详见 DEPLOYMENT.md）
```

### 部署到 Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/chenmisss/AlphaCouncil)

在 Vercel 项目设置中配置环境变量即可。

---

## 🔑 API 密钥获取

| API | 获取地址 | 用途 | 费用 |
| :--- | :--- | :--- | :--- |
| **Gemini** | [aistudio.google.com](https://aistudio.google.com/app/apikey) | 分析师 + 视觉分析 + 联网搜索 | 有免费额度 |
| **DeepSeek** | [platform.deepseek.com](https://platform.deepseek.com/api_keys) | 基本面、动能、风控 | 按量付费 |
| **通义千问** | [dashscope.console.aliyun.com](https://dashscope.console.aliyun.com/apiKey) | 大盘分析、风控 | 有免费额度 |
| **聚合数据** | [juhe.cn](https://www.juhe.cn/) | A 股实时行情 | 有免费额度 |
| **OpenRouter** | [openrouter.ai](https://openrouter.ai/keys) | GPT-5.2 Pro（总经理） | 按量付费 |

> 💡 中国大陆用户访问 Gemini API 需要代理。项目附带 `gemini_proxy_worker.js`，可一键部署到 Cloudflare Workers 作为代理。

---

## ⚠️ 免责声明

本系统生成的所有分析报告、投资建议及决策结果均由人工智能模型自动生成，**仅供技术研究与辅助参考，不构成任何实质性的投资建议**。

* 股市有风险，投资需谨慎。
* AI 模型可能会产生"幻觉"或基于过时信息进行推理。
* 请务必结合个人独立判断进行投资操作。

---

## 📄 License

MIT

---

Originally created by 张一依有把越女剑, optimized and enhanced by [chenmisss](https://github.com/chenmisss).
