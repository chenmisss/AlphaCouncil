import 'dotenv/config'; // 必须在任何其他导入之前加载环境变量
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// 配置中间件
app.use(cors());
app.use(express.json());

// 导入 API 处理函数
// 注意：服务端代码需要适配原始的 Vercel Serverless Function 签名 (req, res)
import geminiHandler from '../api/ai/gemini.js';
import geminiVisionHandler from '../api/ai/gemini-vision.js';
import deepseekHandler from '../api/ai/deepseek.js';
import qwenHandler from '../api/ai/qwen.js';
import openaiHandler from '../api/ai/openai.js';
import stockHandler from '../api/stock/[symbol].js';

// 包装器：将 Express 请求适配为 Vercel 风格的处理函数
const adaptHandler = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    console.error('API Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
  }
};

// API 路由配置
const registerApiRoutes = (prefix) => {
  app.post(`${prefix}/api/ai/gemini`, adaptHandler(geminiHandler));
  app.post(`${prefix}/api/ai/gemini-vision`, adaptHandler(geminiVisionHandler));
  app.post(`${prefix}/api/ai/deepseek`, adaptHandler(deepseekHandler));
  app.post(`${prefix}/api/ai/qwen`, adaptHandler(qwenHandler));
  app.post(`${prefix}/api/ai/openai`, adaptHandler(openaiHandler));
};

// 注册两套路由：一套带前缀，一套不带，确保万无一失
registerApiRoutes('');
registerApiRoutes('/AlphaCouncil');

// 导入配额限制模块
import { checkRateLimit, incrementUsage } from './rateLimiter.js';

// 导入支付路由
import paymentRoutes from './paymentRoutes.js';

// 注册支付路由（两套路径）
app.use('/api/pay', paymentRoutes);
app.use('/AlphaCouncil/api/pay', paymentRoutes);

// 股票数据接口适配: 提取 symbol 参数
// 同时支持 /api/stock/:symbol 和 /AlphaCouncil/api/stock/:symbol
app.post(['/api/stock/:symbol', '/AlphaCouncil/api/stock/:symbol'], async (req, res) => {
  // 从请求体中获取浏览器指纹 (前端生成)
  const fingerprint = req.body.fingerprint;
  const userProvidedKey = req.body.apiKey;

  // 只有在用户未提供自己的 API Key 时才检查配额
  if (!userProvidedKey) {
    // 使用浏览器指纹作为用户标识，如果没有则降级使用 IP
    const clientId = fingerprint || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';

    // 💎 检查是否为付费用户 (24小时内有成功订单)
    const { getLatestPaidOrderByFingerprint } = await import('./orderService.js');
    const latestOrder = getLatestPaidOrderByFingerprint(clientId);
    const isPaidUser = latestOrder && (Date.now() - new Date(latestOrder.paidAt).getTime() < 24 * 60 * 60 * 1000);

    if (isPaidUser) {
      console.log(`[RateLimiter] 用户 ${clientId.slice(0, 8)}... 是付费用户，跳过限流检查`);
      // 付费用户跳过限流
    } else {
      const { allowed, remaining, limit, error } = checkRateLimit(clientId);

      // 添加配额信息到响应头
      res.setHeader('X-RateLimit-Limit', limit);
      res.setHeader('X-RateLimit-Remaining', remaining);

      if (!allowed) {
        console.log(`[RateLimiter] 用户 ${clientId.slice(0, 8)}... 配额已耗尽: ${error}`);
        return res.status(429).json({
          success: false,
          error: error || '今日全网额度已用完',
          quotaExceeded: true
        });
      }
    }

    // 请求成功后才计数 (且排除 status 查询)
    res.on('finish', () => {
      if (res.statusCode === 200 && req.params.symbol !== 'status') {
        incrementUsage(clientId);
      }
    });
  }

  // 修正: 不要直接赋值 req.query，而是修改它的属性
  req.query.symbol = req.params.symbol;
  await adaptHandler(stockHandler)(req, res);
});

// 东方财富资金流向 API（免费，无需 API Key）
app.get(['/api/eastmoney/:symbol', '/AlphaCouncil/api/eastmoney/:symbol'], async (req, res) => {
  try {
    const symbol = req.params.symbol;

    // 构建东方财富 API 请求
    // secid 格式: 0.XXXXXX (深圳) 或 1.XXXXXX (上海)
    let secid;
    if (symbol.startsWith('6') || symbol.startsWith('9')) {
      secid = `1.${symbol}`; // 上海
    } else {
      secid = `0.${symbol}`; // 深圳
    }

    const url = `https://push2.eastmoney.com/api/qt/stock/fflow/kline/get?secid=${secid}&klt=1&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65`;

    console.log(`[EastMoney] Fetching capital flow for: ${symbol}`);

    const response = await fetch(url);
    const data = await response.json();

    if (data.rc !== 0 || !data.data) {
      return res.json({ success: false, error: '无法获取资金流向数据' });
    }

    const klines = data.data.klines || [];
    if (klines.length === 0) {
      return res.json({ success: false, error: '暂无资金流向数据' });
    }

    // 解析最新一条数据
    const latestLine = klines[klines.length - 1];
    const parts = latestLine.split(',');

    const superLargeInflow = parseFloat(parts[1]) || 0;
    const largeInflow = parseFloat(parts[2]) || 0;
    const mediumInflow = parseFloat(parts[3]) || 0;
    const smallInflow = parseFloat(parts[4]) || 0;
    const mainNetInflow = superLargeInflow + largeInflow;

    // 计算总成交额（用于计算主力净比）
    const totalFlow = Math.abs(superLargeInflow) + Math.abs(largeInflow) + Math.abs(mediumInflow) + Math.abs(smallInflow);
    const mainNetRatio = totalFlow > 0 ? (mainNetInflow / totalFlow) * 100 : 0;

    res.json({
      success: true,
      data: {
        code: data.data.code,
        name: data.data.name,
        mainNetInflow,
        superLargeInflow,
        largeInflow,
        mediumInflow,
        smallInflow,
        mainNetRatio,
        updateTime: parts[0]
      }
    });

  } catch (error) {
    console.error('[EastMoney] Error:', error.message);
    res.json({ success: false, error: error.message });
  }
});

// 北向资金 API（免费，无需 API Key）
app.get(['/api/northbound', '/AlphaCouncil/api/northbound'], async (req, res) => {
  try {
    const url = 'https://push2.eastmoney.com/api/qt/kamt.rtmin/get?fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56';

    console.log('[Northbound] Fetching northbound capital flow');

    const response = await fetch(url);
    const data = await response.json();

    if (data.rc !== 0 || !data.data) {
      return res.json({ success: false, error: '无法获取北向资金数据' });
    }

    // 解析 s2n 数据（沪股通+深股通合计）
    const s2nData = data.data.s2n || [];
    if (s2nData.length === 0) {
      return res.json({ success: false, error: '暂无北向资金数据' });
    }

    // 取最新一条数据
    const latestLine = s2nData[s2nData.length - 1];
    const parts = latestLine.split(',');

    // 格式: 时间, 沪股通净流入, 深股通净流入, 北向合计净流入, 沪股通当日资金流入, 深股通当日资金流入
    const time = parts[0];
    const hkToShInflow = parseFloat(parts[1]) || 0;  // 沪股通净流入
    const hkToSzInflow = parseFloat(parts[2]) || 0;  // 深股通净流入
    const northboundTotal = parseFloat(parts[3]) || 0; // 北向合计

    res.json({
      success: true,
      data: {
        time,
        hkToShInflow,        // 沪股通净流入
        hkToSzInflow,        // 深股通净流入
        northboundTotal,     // 北向资金合计
        direction: northboundTotal >= 0 ? '净流入' : '净流出',
        updateTime: new Date().toLocaleTimeString('zh-CN')
      }
    });

  } catch (error) {
    console.error('[Northbound] Error:', error.message);
    res.json({ success: false, error: error.message });
  }
});

// K线历史数据 API（免费，无需 API Key）
app.get(['/api/kline/:symbol', '/AlphaCouncil/api/kline/:symbol'], async (req, res) => {
  try {
    const symbol = req.params.symbol;
    const days = parseInt(req.query.days) || 10; // 默认获取10天

    // 构建东方财富 API 请求
    // secid 格式: 0.XXXXXX (深圳) 或 1.XXXXXX (上海)
    // 指数代码: sh000001 -> 1.000001, sz399001 -> 0.399001
    let secid;

    // 处理指数代码（如 sh000001）
    if (symbol.startsWith('sh')) {
      secid = `1.${symbol.substring(2)}`; // sh000001 -> 1.000001
    } else if (symbol.startsWith('sz')) {
      secid = `0.${symbol.substring(2)}`; // sz399001 -> 0.399001
    } else if (symbol.startsWith('6') || symbol.startsWith('9')) {
      secid = `1.${symbol}`; // 上海股票
    } else {
      secid = `0.${symbol}`; // 深圳股票
    }

    // klt=101 表示日K线
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=101&fqt=1&end=20500101&lmt=${days}&fields1=f1,f2,f3,f4,f5,f6,f7,f8&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`;

    console.log(`[KLine] Fetching ${days} days K-line for: ${symbol}`);

    const response = await fetch(url);
    const data = await response.json();

    if (data.rc !== 0 || !data.data) {
      return res.json({ success: false, error: '无法获取K线数据' });
    }

    const klines = data.data.klines || [];
    if (klines.length === 0) {
      return res.json({ success: false, error: '暂无K线数据' });
    }

    // 解析K线数据
    // 格式: 日期,开盘,收盘,最高,最低,成交量,成交额,振幅,涨跌幅,涨跌额,换手率
    const parsedKlines = klines.map(line => {
      const parts = line.split(',');
      return {
        date: parts[0],
        open: parseFloat(parts[1]),
        close: parseFloat(parts[2]),
        high: parseFloat(parts[3]),
        low: parseFloat(parts[4]),
        volume: parseFloat(parts[5]),       // 成交量(手)
        amount: parseFloat(parts[6]),       // 成交额
        amplitude: parseFloat(parts[7]),    // 振幅%
        changePercent: parseFloat(parts[8]),// 涨跌幅%
        change: parseFloat(parts[9]),       // 涨跌额
        turnover: parseFloat(parts[10])     // 换手率%
      };
    });

    res.json({
      success: true,
      data: {
        code: data.data.code,
        name: data.data.name,
        klines: parsedKlines
      }
    });

  } catch (error) {
    console.error('[KLine] Error:', error.message);
    res.json({ success: false, error: error.message });
  }
});

// 基本面财务数据 API（代理到 Baostock Python 服务）
app.get(['/api/fundamental/:symbol', '/AlphaCouncil/api/fundamental/:symbol'], async (req, res) => {
  try {
    const symbol = req.params.symbol;
    console.log(`[Fundamental] Fetching financial data for: ${symbol}`);

    // 代理到 Python Baostock 服务
    const response = await fetch(`http://localhost:5002/api/fundamental/${symbol}`);
    const data = await response.json();

    res.json(data);
  } catch (error) {
    console.error('[Fundamental] Error:', error.message);
    res.json({ success: false, error: error.message });
  }
});

// K线图 API（代理到 Chart Python 服务）
app.get(['/api/kline-chart/:symbol', '/AlphaCouncil/api/kline-chart/:symbol'], async (req, res) => {
  try {
    const symbol = req.params.symbol;
    console.log(`[KLineChart] Generating chart for: ${symbol}`);

    // 代理到 Python Chart 服务
    const response = await fetch(`http://localhost:5003/api/kline-chart/${symbol}`);

    if (!response.ok) {
      throw new Error(`Chart service returned ${response.status}`);
    }

    // 返回图片
    res.set('Content-Type', 'image/png');
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('[KLineChart] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 静态文件托管 (生产环境)
// 指向 Vite 构建产物目录
const distPath = path.join(__dirname, '../dist');
if (fs.existsSync(distPath)) {
  // 修改 1: 将静态文件挂载到 /AlphaCouncil 子路径
  app.use('/AlphaCouncil', express.static(distPath));

  // 修改 2: 访问 /AlphaCouncil (无斜杠) 自动重定向到 /AlphaCouncil/
  app.get('/AlphaCouncil', (req, res) => {
    res.redirect('/AlphaCouncil/');
  });

  // 修改 3: SPA 路由回退
  // 使用正则匹配，兼容所有 Express 版本
  app.get(/\/AlphaCouncil\/.*/, (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });

  // 根路径提示
  app.get('/', (req, res) => {
    res.redirect('/AlphaCouncil/');
  });
} else {
  console.warn('⚠️  Warning: "dist" directory not found. Run "npm run build" first if in production.');
  app.get('/', (req, res) => {
    res.send('AlphaCouncil AI Backend Running. Please build the frontend accessing "/".');
  });
}

// 启动服务器
app.listen(PORT, () => {
  console.log(`
🚀 Server is running on http://localhost:${PORT}
- Environment: ${process.env.NODE_ENV || 'development'}
- API Endpoint: /api/ai/*, /api/stock/*
  `);
});
