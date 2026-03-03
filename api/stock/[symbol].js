import fetch from 'node-fetch';
import fs from 'fs';

// 聚合 API 密钥配置（从环境变量读取，支持多 Key 轮询）
const JUHE_API_KEYS = [
  { name: '主账号', key: process.env.JUHE_API_KEY },
  { name: '备用', key: process.env.JUHE_API_KEY_2 },
].filter(item => item.key); // 过滤掉未配置的 Key

const JUHE_BASE_URL = 'http://web.juhe.cn/finance/stock/hs';

// 持久化存储路径
const USAGE_FILE = '/tmp/juhe_api_usage.json';

/**
 * 保存状态到文件
 */
function saveState(state) {
  try {
    fs.writeFileSync(USAGE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.warn('[Juhe] 无法保存状态文件:', e.message);
  }
}

/**
 * 从文件加载状态
 */
function loadState() {
  try {
    if (fs.existsSync(USAGE_FILE)) {
      const data = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
      // 检查是否是今天的数据
      if (data.date === new Date().toDateString()) {
        return data;
      }
    }
  } catch (e) {
    console.warn('[Juhe] 无法加载状态文件:', e.message);
  }
  // 返回默认值：新的一天，所有 API 都可用
  const defaultState = {
    date: new Date().toDateString(),
    exhaustedKeys: [],  // 已耗尽的 Key 索引列表
    callCounts: [0, 0]  // 调用计数（仅供显示）
  };
  saveState(defaultState);
  return defaultState;
}

/**
 * 标记某个 Key 已耗尽
 */
function markKeyExhausted(keyIndex) {
  const state = loadState();
  if (!state.exhaustedKeys.includes(keyIndex)) {
    state.exhaustedKeys.push(keyIndex);
    state.callCounts[keyIndex] = 50; // 标记为已用完
    saveState(state);
    console.log(`[Juhe] ${JUHE_API_KEYS[keyIndex].name}账号已耗尽，切换到下一个`);
  }
}

/**
 * 记录一次成功的 API 调用
 */
function recordSuccessfulCall(keyIndex) {
  const state = loadState();
  state.callCounts[keyIndex]++;
  saveState(state);
  console.log(`[Juhe] ${JUHE_API_KEYS[keyIndex].name}账号调用成功，今日累计: ${state.callCounts[keyIndex]}次`);
}

/**
 * 获取可用的 API Key（跳过已耗尽的）
 */
function getAvailableApiKey() {
  const state = loadState();

  for (let i = 0; i < JUHE_API_KEYS.length; i++) {
    if (!state.exhaustedKeys.includes(i)) {
      return { index: i, ...JUHE_API_KEYS[i] };
    }
  }

  // 所有 Key 都用完了
  return null;
}

/**
 * 获取当前使用状态（供前端显示）
 */
function getUsageStatus() {
  const state = loadState();
  return JUHE_API_KEYS.map((config, i) => ({
    name: config.name,
    used: state.callCounts[i] || 0,
    max: 50,
    exhausted: state.exhaustedKeys.includes(i)
  }));
}

/**
 * 尝试使用指定的 API Key 获取数据
 */
async function tryFetchWithKey(keyConfig, gid) {
  const url = `${JUHE_BASE_URL}?gid=${gid}&key=${keyConfig.key}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    // 检查是否是配额错误
    if (data.resultcode === '10012' ||
      data.reason?.includes('超过') ||
      data.reason?.includes('次数') ||
      data.reason?.includes('配额') ||
      data.error_code === 10012) {
      return { success: false, quotaExceeded: true, data };
    }

    if (data.resultcode !== '200') {
      return { success: false, quotaExceeded: false, data };
    }

    return { success: true, data };
  } catch (error) {
    return { success: false, quotaExceeded: false, error };
  }
}

export default async function handler(req, res) {
  // 设置 CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let symbol;

  // 支持 GET 和 POST 两种方式
  if (req.method === 'GET') {
    symbol = req.query.symbol;
  } else if (req.method === 'POST') {
    symbol = req.body.symbol;
  }

  // 特殊处理：查询使用状态（不消耗配额）
  if (symbol === 'status' || symbol === '_status') {
    const usage = getUsageStatus();
    const total = usage.reduce((acc, item) => acc + item.used, 0);
    return res.json({
      success: true,
      usageStatus: usage,
      totalUsed: total,
      totalMax: 100
    });
  }

  if (!symbol) {
    return res.status(400).json({ success: false, error: '缺少股票代码' });
  }

  // 格式化股票代码
  let gid = symbol.toLowerCase();
  if (!gid.startsWith('sh') && !gid.startsWith('sz')) {
    if (gid.startsWith('6')) {
      gid = `sh${gid}`;
    } else {
      gid = `sz${gid}`;
    }
  }

  // 依次尝试每个可用的 API Key
  const state = loadState();

  for (let i = 0; i < JUHE_API_KEYS.length; i++) {
    // 跳过已耗尽的 Key
    if (state.exhaustedKeys.includes(i)) {
      continue;
    }

    const keyConfig = JUHE_API_KEYS[i];
    console.log(`[Juhe] 尝试使用${keyConfig.name}账号...`);

    const result = await tryFetchWithKey(keyConfig, gid);

    if (result.success) {
      // 成功获取数据
      recordSuccessfulCall(i);

      return res.json({
        success: true,
        data: result.data.result[0],
        _meta: {
          apiSource: keyConfig.name,
          usageStatus: getUsageStatus()
        }
      });
    }

    if (result.quotaExceeded) {
      // 配额用完，标记并尝试下一个
      markKeyExhausted(i);
      console.log(`[Juhe] ${keyConfig.name}账号配额已用完: ${result.data?.reason || '超过配额'}`);
      continue;
    }

    // 其他错误（如股票代码不存在），直接返回
    return res.status(400).json({
      success: false,
      error: result.data?.reason || result.error?.message || '未知错误',
      apiSource: keyConfig.name
    });
  }

  // 所有 Key 都耗尽了
  const usage = getUsageStatus();
  return res.status(429).json({
    success: false,
    error: '今日聚合 API 配额已全部用完',
    usageStatus: usage,
    message: '企业和个人账号配额均已耗尽，配额将于明天 0:00 重置。'
  });
}
