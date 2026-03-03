
// 后端代理服务器配置
// 使用相对路径，以适配子目录部署
const BACKEND_API_URL = '/AlphaCouncil/api/stock';

// 导入浏览器指纹生成器
import { generateFingerprint } from './fingerprint';

// 聚合数据返回的股票数据接口定义（根据官方文档更新）
export interface StockRealtimeData {
  gid: string; // 股票编号
  name: string; // 股票名称
  nowPri: string; // 当前价格
  increase: string; // 涨跌额
  increPer: string; // 涨跌百分比
  todayStartPri: string; // 今日开盘价
  yestodEndPri: string; // 昨日收盘价
  todayMax: string; // 今日最高价
  todayMin: string; // 今日最低价
  competitivePri?: string; // 竞买价
  reservePri?: string; // 竞卖价
  traNumber: string; // 成交量（手）
  traAmount: string; // 成交金额
  date: string; // 日期
  time: string; // 时间
  // 买卖盘口 (买1-5, 卖1-5)
  buyOne: string; buyOnePri: string;
  buyTwo: string; buyTwoPri: string;
  buyThree: string; buyThreePri: string;
  buyFour: string; buyFourPri: string;
  buyFive: string; buyFivePri: string;
  sellOne: string; sellOnePri: string;
  sellTwo: string; sellTwoPri: string;
  sellThree: string; sellThreePri: string;
  sellFour: string; sellFourPri: string;
  sellFive: string; sellFivePri: string;
}

// 大盘数据接口
export interface DapanData {
  dot: string; // 当前点位
  name: string; // 指数名称
  nowPic: string; // 涨跌点数
  rate: string; // 涨跌幅
  traAmount: string; // 成交额（亿）
  traNumber: string; // 成交量（万手）
}



// API响应结构
interface JuheApiResponse {
  resultcode: string;
  reason: string;
  result: Array<{
    data: StockRealtimeData;
    dapandata?: DapanData;
    gopicture?: {
      minurl: string; // 分时图K线
      dayurl: string; // 日K线
      weekurl: string; // 周K线
      monthurl: string; // 月K线
    };
  }>;
  error_code?: number;
}



/**
 * 获取实时股票数据
 * 通过本地后端代理服务器请求聚合数据 API，避免 CORS 问题
 */
export async function fetchStockData(symbol: string, apiKey?: string): Promise<StockRealtimeData | null> {
  try {
    const targetUrl = `${BACKEND_API_URL}/${symbol}`;
    console.log(`[AlphaCouncil] Requesting stock data from: ${targetUrl}`);

    // 生成浏览器指纹用于配额限制
    const fingerprint = await generateFingerprint();

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, apiKey, fingerprint })
    });

    console.log(`[AlphaCouncil] Response status: ${response.status}`);

    // 处理配额超限 (429 Too Many Requests)
    if (response.status === 429) {
      const errorData = await response.json();
      console.error(`[AlphaCouncil] 配额超限: ${errorData.error}`);
      throw new Error(errorData.error || '今日全网额度已用完');
    }

    if (!response.ok) {
      console.error(`[AlphaCouncil] Backend returned error status: ${response.status}`);
      const text = await response.text();
      console.error(`[AlphaCouncil] Error body: ${text}`);
      return null;
    }

    const result = await response.json();

    if (!result.success) {
      return null;
    }

    // 提取股票数据
    const stockData = result.data.data;

    // 数据验证：确保必要字段存在
    if (!stockData.gid || !stockData.name || !stockData.nowPri) {
      return null;
    }

    // 附加大盘数据（如果存在）
    if (result.data.dapandata) {
      (stockData as any).dapandata = result.data.dapandata;
    }

    return stockData;

  } catch (error) {
    // 如果是配额超限错误，直接抛出让上层处理
    if (error instanceof Error && error.message.includes('免费额度')) {
      throw error;
    }
    console.error('[AlphaCouncil] 获取股票数据失败:', error instanceof Error ? error.message : String(error));
    return null;
  }
}


/**
 * 获取市场状态和时间上下文
 * A股交易时间: 周一至周五 9:30-11:30, 13:00-15:00
 */
export function getMarketStatus(): { status: string; label: string; timeContext: string } {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=周日, 6=周六
  const hour = now.getHours();
  const minute = now.getMinutes();
  const timeInMinutes = hour * 60 + minute;

  // A股交易时段（分钟表示）
  const morningOpen = 9 * 60 + 30;   // 9:30
  const morningClose = 11 * 60 + 30; // 11:30
  const afternoonOpen = 13 * 60;     // 13:00
  const afternoonClose = 15 * 60;    // 15:00

  // 判断是否周末
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return {
      status: 'closed',
      label: '⏸️ 周末休市',
      timeContext: '【数据时效】当前是周末，以下数据截至 **上周五收盘**。请勿使用"今日"表述，应使用"上周五"或"最近一个交易日"。'
    };
  }

  // 判断交易时段
  if (timeInMinutes < morningOpen) {
    // 开盘前
    return {
      status: 'pre-market',
      label: '🌅 盘前',
      timeContext: '【数据时效】当前是盘前（未开盘），以下数据截至 **昨日收盘**。请勿使用"今日"表述，应使用"昨日收盘"或"截至昨日"。'
    };
  } else if (timeInMinutes >= morningOpen && timeInMinutes <= morningClose) {
    // 上午交易时段
    return {
      status: 'trading',
      label: '📈 交易中(上午)',
      timeContext: '【数据时效】当前是 **盘中交易时段**，数据为实时行情。可使用"当前"、"盘中"等表述。'
    };
  } else if (timeInMinutes > morningClose && timeInMinutes < afternoonOpen) {
    // 午间休市
    return {
      status: 'lunch-break',
      label: '🍚 午间休市',
      timeContext: '【数据时效】当前是午间休市，数据截至 **今日上午收盘**。可使用"今日上午"、"目前"等表述。'
    };
  } else if (timeInMinutes >= afternoonOpen && timeInMinutes <= afternoonClose) {
    // 下午交易时段
    return {
      status: 'trading',
      label: '📈 交易中(下午)',
      timeContext: '【数据时效】当前是 **盘中交易时段**，数据为实时行情。可使用"当前"、"盘中"等表述。'
    };
  } else {
    // 收盘后
    return {
      status: 'after-hours',
      label: '🌙 已收盘',
      timeContext: '【数据时效】当前是盘后，数据截至 **今日收盘**。可使用"今日收盘"、"截至收盘"等表述。'
    };
  }
}

/**
 * 将原始 JSON 数据格式化为 AI 可读的字符串
 * 根据聚合数据API文档格式优化输出
 */
export function formatStockDataForPrompt(data: StockRealtimeData | null): string {
  if (!data) return "无法获取实时行情数据 (API连接失败)，请依赖您的内部知识库或搜索工具。";

  // 获取市场状态
  const marketStatus = getMarketStatus();

  // 计算成交量/成交额的可读格式
  const traNumberFormatted = parseFloat(data.traNumber) > 10000
    ? `${(parseFloat(data.traNumber) / 10000).toFixed(2)}万手`
    : `${data.traNumber}手`;

  const traAmountFormatted = parseFloat(data.traAmount) > 100000000
    ? `${(parseFloat(data.traAmount) / 100000000).toFixed(2)}亿元`
    : `${(parseFloat(data.traAmount) / 10000).toFixed(2)}万元`;

  // 计算日振幅
  const todayMax = parseFloat(data.todayMax);
  const todayMin = parseFloat(data.todayMin);
  const currentPrice = parseFloat(data.nowPri);
  const dailyAmplitude = ((todayMax - todayMin) / currentPrice) * 100;

  // 获取大盘数据
  const dapandata = (data as any).dapandata;
  const marketIndexInfo = dapandata ? `
【大盘指数】
  指数名称: ${dapandata.name}
  当前点位: ${dapandata.dot}
  涨跌幅度: ${parseFloat(dapandata.rate) >= 0 ? '+' : ''}${dapandata.rate}%
  成交量: ${dapandata.traNumber}万手
  成交额: ${dapandata.traAmount}亿元
` : '';

  return `
╔═══════════════════════════════════════════════════════════╗
║           实时行情数据 (来源: 聚合数据API)                ║
╚═══════════════════════════════════════════════════════════╝

${marketStatus.timeContext}

【市场状态】${marketStatus.label}

【基本信息】
  股票名称: ${data.name}
  股票代码: ${data.gid.toUpperCase()}
  数据时间: ${data.date} ${data.time}

【价格信息】
  当前价格: ¥${data.nowPri}
  涨跌幅度: ${parseFloat(data.increPer) >= 0 ? '+' : ''}${data.increPer}%
  涨跌金额: ${parseFloat(data.increase) >= 0 ? '+' : ''}¥${data.increase}
  今日开盘: ¥${data.todayStartPri}
  昨日收盘: ¥${data.yestodEndPri}
  今日最高: ¥${data.todayMax}
  今日最低: ¥${data.todayMin}
  ${data.competitivePri ? `竞买价: ¥${data.competitivePri}` : ''}
  ${data.reservePri ? `竞卖价: ¥${data.reservePri}` : ''}

【成交情况】
  成交量: ${traNumberFormatted}
  成交额: ${traAmountFormatted}
  日振幅: ${dailyAmplitude.toFixed(2)}%
  流动性: ${parseFloat(data.traAmount) > 100000000 ? '充足' : parseFloat(data.traAmount) > 50000000 ? '一般' : '偏弱'}${marketIndexInfo}

【五档盘口】（关键数据：研判买卖力量对比）
  ┌─────────────────────────────────────┐
  │ 卖五  ¥${data.sellFivePri.padEnd(8)} │ ${data.sellFive.padEnd(10)}股 │
  │ 卖四  ¥${data.sellFourPri.padEnd(8)} │ ${data.sellFour.padEnd(10)}股 │
  │ 卖三  ¥${data.sellThreePri.padEnd(8)} │ ${data.sellThree.padEnd(10)}股 │
  │ 卖二  ¥${data.sellTwoPri.padEnd(8)} │ ${data.sellTwo.padEnd(10)}股 │
  │ 卖一  ¥${data.sellOnePri.padEnd(8)} │ ${data.sellOne.padEnd(10)}股 │ ⬅️ 压力
  ├─────────────────────────────────────┤
  │ 买一  ¥${data.buyOnePri.padEnd(8)} │ ${data.buyOne.padEnd(10)}股 │ ⬅️ 支撑
  │ 买二  ¥${data.buyTwoPri.padEnd(8)} │ ${data.buyTwo.padEnd(10)}股 │
  │ 买三  ¥${data.buyThreePri.padEnd(8)} │ ${data.buyThree.padEnd(10)}股 │
  │ 买四  ¥${data.buyFourPri.padEnd(8)} │ ${data.buyFour.padEnd(10)}股 │
  │ 买五  ¥${data.buyFivePri.padEnd(8)} │ ${data.buyFive.padEnd(10)}股 │
  └─────────────────────────────────────┘

💡 分析提示: 请重点关注盘口买卖挂单量差异，判断主力意图
═══════════════════════════════════════════════════════════
  `;
}

// 东方财富资金流向数据接口
export interface CapitalFlowData {
  code: string;
  name: string;
  mainNetInflow: number;
  superLargeInflow: number;
  largeInflow: number;
  mediumInflow: number;
  smallInflow: number;
  mainNetRatio: number;
  updateTime: string;
}

/**
 * 获取东方财富资金流向数据
 */
export async function fetchCapitalFlowData(symbol: string): Promise<CapitalFlowData | null> {
  try {
    const targetUrl = `/AlphaCouncil/api/eastmoney/${symbol}`;
    console.log(`[AlphaCouncil] Fetching capital flow from: ${targetUrl}`);

    const response = await fetch(targetUrl);
    const result = await response.json();

    if (!result.success || !result.data) {
      console.log('[AlphaCouncil] 资金流向数据获取失败');
      return null;
    }

    return result.data as CapitalFlowData;
  } catch (error) {
    console.error('[AlphaCouncil] 获取资金流向失败:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

// 北向资金数据接口
export interface NorthboundData {
  time: string;
  hkToShInflow: number;     // 沪股通净流入
  hkToSzInflow: number;     // 深股通净流入
  northboundTotal: number;  // 北向资金合计
  direction: string;        // 净流入/净流出
  updateTime: string;
}

/**
 * 获取北向资金数据（沪股通+深股通）
 */
export async function fetchNorthboundData(): Promise<NorthboundData | null> {
  try {
    const targetUrl = `/AlphaCouncil/api/northbound`;
    console.log(`[AlphaCouncil] Fetching northbound capital from: ${targetUrl}`);

    const response = await fetch(targetUrl);
    const result = await response.json();

    if (!result.success || !result.data) {
      console.log('[AlphaCouncil] 北向资金数据获取失败');
      return null;
    }

    return result.data as NorthboundData;
  } catch (error) {
    console.error('[AlphaCouncil] 获取北向资金失败:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * 格式化北向资金为 AI 可读的字符串
 */
export function formatNorthboundForPrompt(data: NorthboundData | null): string {
  if (!data) return "";

  const formatFlow = (amount: number): string => {
    const absAmount = Math.abs(amount);
    const sign = amount >= 0 ? '+' : '-';
    if (absAmount >= 100000000) {
      return `${sign}${(absAmount / 100000000).toFixed(2)}亿`;
    } else {
      return `${sign}${(absAmount / 10000).toFixed(2)}万`;
    }
  };

  // 判断北向资金强度
  let strength = "";
  const total = data.northboundTotal;
  if (total > 5000000000) strength = "🟢🟢 北向大幅流入（>50亿）";
  else if (total > 2000000000) strength = "🟢 北向明显流入（>20亿）";
  else if (total > 0) strength = "🟡 北向小幅流入";
  else if (total > -2000000000) strength = "🟡 北向小幅流出";
  else if (total > -5000000000) strength = "🔴 北向明显流出（>20亿）";
  else strength = "🔴🔴 北向大幅流出（>50亿）";

  return `
【北向资金】（实时数据 ${data.updateTime}）
  ├─ 沪股通净流入: ${formatFlow(data.hkToShInflow)}
  ├─ 深股通净流入: ${formatFlow(data.hkToSzInflow)}
  ├─ 北向合计: ${formatFlow(data.northboundTotal)}
  └─ ${strength}
═══════════════════════════════════════════════════════════
`;
}

/**
 * 格式化金额为易读格式
 */
function formatAmount(amount: number): string {
  const absAmount = Math.abs(amount);
  const sign = amount >= 0 ? '+' : '-';

  if (absAmount >= 100000000) {
    return `${sign}${(absAmount / 100000000).toFixed(2)}亿`;
  } else if (absAmount >= 10000) {
    return `${sign}${(absAmount / 10000).toFixed(2)}万`;
  } else {
    return `${sign}${absAmount.toFixed(2)}`;
  }
}

/**
 * 格式化资金流向数据为 AI 可读的字符串
 */
export function formatCapitalFlowForPrompt(data: CapitalFlowData | null): string {
  if (!data) return "";

  const mainFlow = formatAmount(data.mainNetInflow);
  const superLarge = formatAmount(data.superLargeInflow);
  const large = formatAmount(data.largeInflow);
  const medium = formatAmount(data.mediumInflow);
  const small = formatAmount(data.smallInflow);

  // 判断资金方向
  let direction = "中性";
  if (data.mainNetInflow > 0 && data.mainNetRatio > 5) {
    direction = "🟢 主力流入";
  } else if (data.mainNetInflow > 0) {
    direction = "🟡 小幅流入";
  } else if (data.mainNetInflow < 0 && data.mainNetRatio < -5) {
    direction = "🔴 主力流出";
  } else if (data.mainNetInflow < 0) {
    direction = "🟠 小幅流出";
  }

  return `
【东方财富资金流向】（实时数据）
  资金方向: ${direction}
  主力净流入: ${mainFlow}（主力净比: ${data.mainNetRatio.toFixed(2)}%）
  ├─ 超大单: ${superLarge}
  └─ 大单: ${large}
  散户资金:
  ├─ 中单: ${medium}
  └─ 小单: ${small}
  更新时间: ${data.updateTime}
═══════════════════════════════════════════════════════════
`;
}


// K线数据接口
export interface KLineData {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  amplitude: number;
  changePercent: number;
  change: number;
  turnover: number;
}

export interface KLineResponse {
  code: string;
  name: string;
  klines: KLineData[];
}

/**
 * 获取K线历史数据
 */
export async function fetchKLineData(symbol: string, days: number = 10): Promise<KLineResponse | null> {
  try {
    const targetUrl = `/AlphaCouncil/api/kline/${symbol}?days=${days}`;
    console.log(`[AlphaCouncil] Fetching K-line from: ${targetUrl}`);

    const response = await fetch(targetUrl);
    const result = await response.json();

    if (!result.success || !result.data) {
      console.log('[AlphaCouncil] K线数据获取失败');
      return null;
    }

    return result.data as KLineResponse;
  } catch (error) {
    console.error('[AlphaCouncil] 获取K线失败:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * 格式化K线数据为 AI 可读的字符串
 * 包含均线计算、连涨连跌天数、超买超卖判断
 */
export function formatKLineForPrompt(data: KLineResponse | null): string {
  if (!data || !data.klines || data.klines.length === 0) return "";

  const klines = data.klines;

  // 计算趋势
  const firstClose = klines[0].close;
  const lastClose = klines[klines.length - 1].close;
  const totalChange = ((lastClose - firstClose) / firstClose * 100).toFixed(2);
  const trend = parseFloat(totalChange) >= 0 ? "📈 上涨" : "📉 下跌";

  // 计算平均换手率和成交额
  const avgTurnover = (klines.reduce((sum, k) => sum + k.turnover, 0) / klines.length).toFixed(2);
  const avgAmount = klines.reduce((sum, k) => sum + k.amount, 0) / klines.length;
  const avgAmountStr = avgAmount >= 100000000 ? `${(avgAmount / 100000000).toFixed(2)}亿` : `${(avgAmount / 10000).toFixed(2)}万`;

  // === 新增：计算均线 MA5/MA10/MA20 ===
  const calcMA = (period: number): number | null => {
    if (klines.length < period) return null;
    const recentCloses = klines.slice(-period).map(k => k.close);
    return recentCloses.reduce((a, b) => a + b, 0) / period;
  };

  const ma5 = calcMA(5);
  const ma10 = calcMA(10);
  const ma20 = calcMA(20);

  // 均线排列判断
  let maPattern = "无明显排列";
  if (ma5 && ma10 && ma20) {
    if (ma5 > ma10 && ma10 > ma20) maPattern = "🟢 多头排列 (MA5>MA10>MA20)";
    else if (ma5 < ma10 && ma10 < ma20) maPattern = "🔴 空头排列 (MA5<MA10<MA20)";
    else maPattern = "⚪ 均线缠绕";
  }

  // 超买超卖判断（相对MA20偏离度）
  let overboughtOversold = "";
  if (ma20) {
    const deviationPercent = ((lastClose - ma20) / ma20 * 100);
    if (deviationPercent > 15) overboughtOversold = "🔴 超买区域 (高于MA20超15%)";
    else if (deviationPercent < -15) overboughtOversold = "🟢 超卖区域 (低于MA20超15%)";
    else if (deviationPercent > 10) overboughtOversold = "🟡 偏强 (高于MA20约10%)";
    else if (deviationPercent < -10) overboughtOversold = "🟡 偏弱 (低于MA20约10%)";
    else overboughtOversold = "⚪ 正常区间";
  }

  // === 新增：连涨连跌天数 ===
  let consecutiveUp = 0;
  let consecutiveDown = 0;
  for (let i = klines.length - 1; i >= 0; i--) {
    if (klines[i].changePercent > 0) {
      if (consecutiveDown > 0) break;
      consecutiveUp++;
    } else if (klines[i].changePercent < 0) {
      if (consecutiveUp > 0) break;
      consecutiveDown++;
    } else {
      break;
    }
  }

  let consecutiveInfo = "";
  if (consecutiveUp >= 5) consecutiveInfo = `🔴 连涨 ${consecutiveUp} 天（追高警告！）`;
  else if (consecutiveUp >= 3) consecutiveInfo = `🟡 连涨 ${consecutiveUp} 天`;
  else if (consecutiveDown >= 5) consecutiveInfo = `🟢 连跌 ${consecutiveDown} 天（抄底机会？）`;
  else if (consecutiveDown >= 3) consecutiveInfo = `🟡 连跌 ${consecutiveDown} 天`;
  else consecutiveInfo = "无明显连续走势";

  // === 新增：成交量异动 ===
  const lastVolume = klines[klines.length - 1].volume;
  const avgVolume = klines.slice(0, -1).reduce((sum, k) => sum + k.volume, 0) / Math.max(1, klines.length - 1);
  const volumeRatio = lastVolume / avgVolume;
  let volumeAlert = "";
  if (volumeRatio > 3) volumeAlert = "🔴 暴量（>3倍均量）";
  else if (volumeRatio > 2) volumeAlert = "🟠 放量（>2倍均量）";
  else if (volumeRatio < 0.5) volumeAlert = "⚪ 缩量（<0.5倍均量）";
  else volumeAlert = "正常量能";

  // 最近5天K线摘要
  const recentKlines = klines.slice(-5).map(k => {
    const sign = k.changePercent >= 0 ? '+' : '';
    return `${k.date.slice(5)}: ¥${k.close.toFixed(2)} (${sign}${k.changePercent.toFixed(2)}%)`;
  }).join('\n  ');

  return `
【历史K线】（近${klines.length}个交易日）
  整体趋势: ${trend} ${totalChange}%
  平均换手率: ${avgTurnover}%
  日均成交额: ${avgAmountStr}

  【均线分析】
  ├─ MA5:  ${ma5 ? '¥' + ma5.toFixed(2) : '暂无'}
  ├─ MA10: ${ma10 ? '¥' + ma10.toFixed(2) : '暂无'}
  ├─ MA20: ${ma20 ? '¥' + ma20.toFixed(2) : '暂无'}
  └─ 排列: ${maPattern}

  【量价信号】
  ├─ ${overboughtOversold}
  ├─ ${consecutiveInfo}
  └─ ${volumeAlert}

  近期走势:
  ${recentKlines}
═══════════════════════════════════════════════════════════
`;
}

// 基本面财务数据接口（一利五率 + 扩展）
export interface FundamentalData {
  // 一利
  netProfit: number | null;           // 累计净利润
  netProfitAnnualized: number | null; // 年化预估净利润
  currentQuarter: number | null;      // 第几季度
  // 估值指标
  epsTTM: number | null;              // 每股收益(TTM) - 用于计算PE
  totalShares: number | null;         // 总股本
  // 五率
  roe: number | null;                 // 净资产收益率
  debtRatio: string | null;           // 资产负债率
  grossProfitMargin: number | null;   // 毛利率
  grossProfitMarginChange: number | null; // 毛利率变化
  netProfitMargin: number | null;     // 净利率
  cfoToRevenue: number | null;        // 营业现金比率
  cfoToNetProfit: number | null;      // 现金流/净利润
  // 成长性
  yoyNetProfit: number | null;        // 净利润同比
  yoyAsset: number | null;            // 总资产同比
  // 运营效率
  assetTurnover: number | null;       // 资产周转率
  receivableTurnover: number | null;  // 应收周转率
  inventoryTurnover: number | null;   // 存货周转率
  // 🆕 历史年报对比（近3年）
  historicalData?: Array<{
    year: number;
    roe: number | null;
    grossProfitMargin: number | null;
    netProfitMargin: number | null;
    netProfit: number | null;
    debtRatio: number | null;
    quarter: number;
  }>;
  // 元数据
  reportPeriod: string;
  updateTime: string;
}

/**
 * 获取基本面财务数据
 */
export async function fetchFundamentalData(symbol: string): Promise<FundamentalData | null> {
  try {
    const targetUrl = `/AlphaCouncil/api/fundamental/${symbol}`;
    console.log(`[AlphaCouncil] Fetching fundamental data from: ${targetUrl}`);

    const response = await fetch(targetUrl);
    const result = await response.json();

    if (!result.success || !result.data) {
      console.log('[AlphaCouncil] 基本面数据获取失败');
      return null;
    }

    return result.data as FundamentalData;
  } catch (error) {
    console.error('[AlphaCouncil] 获取基本面数据失败:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * 格式化基本面数据为 AI 可读的字符串（一利五率格式）
 */
export function formatFundamentalForPrompt(data: FundamentalData | null): string {
  if (!data) return "";

  // 格式化百分比
  const formatPercent = (val: number | null): string => {
    if (val === null || val === undefined) return "暂无";
    const num = val * 100;
    return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
  };

  // 格式化金额
  const formatMoney = (val: number | null): string => {
    if (val === null || val === undefined) return "暂无";
    if (Math.abs(val) >= 100000000) return `${(val / 100000000).toFixed(2)}亿`;
    if (Math.abs(val) >= 10000) return `${(val / 10000).toFixed(2)}万`;
    return val.toFixed(2);
  };

  // ROE 健康度判断
  const roeVal = data.roe ? data.roe * 100 : null;
  let roeLevel = "暂无";
  if (roeVal !== null) {
    if (roeVal > 15) roeLevel = "🟢 优秀";
    else if (roeVal > 10) roeLevel = "🟡 良好";
    else if (roeVal > 0) roeLevel = "🟠 一般";
    else roeLevel = "🔴 亏损";
  }

  // 负债率健康度判断
  const debtVal = data.debtRatio ? parseFloat(data.debtRatio) : null;
  let debtLevel = "暂无";
  if (debtVal !== null) {
    if (debtVal < 40) debtLevel = "🟢 低";
    else if (debtVal < 60) debtLevel = "🟡 适中";
    else if (debtVal < 80) debtLevel = "🟠 偏高";
    else debtLevel = "🔴 危险";
  }

  // 毛利率变化判断
  const gpmChange = data.grossProfitMarginChange;
  let gpmChangeLevel = "";
  if (gpmChange !== null) {
    if (gpmChange > 0.02) gpmChangeLevel = "🟢 改善";
    else if (gpmChange > -0.02) gpmChangeLevel = "🟡 稳定";
    else gpmChangeLevel = "🔴 恶化";
  }

  // 现金流健康度判断
  const cfoRatio = data.cfoToRevenue;
  let cfoLevel = "暂无";
  if (cfoRatio !== null) {
    if (cfoRatio > 0.1) cfoLevel = "🟢 健康";
    else if (cfoRatio > 0) cfoLevel = "🟡 一般";
    else cfoLevel = "🔴 失血";
  }

  // 季度标签
  const quarterLabel = data.currentQuarter ? `Q1-Q${data.currentQuarter}累计` : '累计';

  // 🆕 历史数据对比格式化
  let historicalSection = "";
  if (data.historicalData && data.historicalData.length > 0) {
    const histLines: string[] = [];

    // 按年份降序排列
    const sortedHist = [...data.historicalData].sort((a, b) => b.year - a.year);

    // ROE趋势
    const roeValues = sortedHist.filter(h => h.roe !== null).map(h => ({ year: h.year, val: h.roe! * 100 }));
    if (roeValues.length >= 2) {
      const trend = roeValues[0].val > roeValues[roeValues.length - 1].val ? "📈" :
        roeValues[0].val < roeValues[roeValues.length - 1].val ? "📉" : "➡️";
      histLines.push(`  ├─ ROE趋势: ${roeValues.map(r => `${r.year}年${r.val.toFixed(1)}%`).join(' → ')} ${trend}`);
    }

    // 毛利率趋势
    const gpmValues = sortedHist.filter(h => h.grossProfitMargin !== null).map(h => ({ year: h.year, val: h.grossProfitMargin! * 100 }));
    if (gpmValues.length >= 2) {
      const trend = gpmValues[0].val > gpmValues[gpmValues.length - 1].val ? "📈 改善" :
        gpmValues[0].val < gpmValues[gpmValues.length - 1].val ? "📉 恶化" : "➡️ 稳定";
      histLines.push(`  ├─ 毛利率趋势: ${gpmValues.map(r => `${r.year}年${r.val.toFixed(1)}%`).join(' → ')} ${trend}`);
    }

    // 负债率趋势
    const debtValues = sortedHist.filter(h => h.debtRatio !== null).map(h => ({ year: h.year, val: h.debtRatio! }));
    if (debtValues.length >= 2) {
      const trend = debtValues[0].val < debtValues[debtValues.length - 1].val ? "🟢 下降" :
        debtValues[0].val > debtValues[debtValues.length - 1].val ? "🔴 上升" : "➡️ 稳定";
      histLines.push(`  └─ 负债率趋势: ${debtValues.map(r => `${r.year}年${r.val.toFixed(1)}%`).join(' → ')} ${trend}`);
    }

    if (histLines.length > 0) {
      historicalSection = `
📜 历史财务对比（近3年年报）
${histLines.join('\n')}
`;
    }
  }

  return `
【一利五率分析】（Baostock · ${data.reportPeriod}）
══════════════════════════════════════════════
📊 一利（利润指标）
  ├─ ${quarterLabel}: ${formatMoney(data.netProfit)} ${data.netProfit && data.netProfit < 0 ? '🔴 亏损' : ''}
  └─ 全年预估(线性): ${formatMoney(data.netProfitAnnualized)} ${data.netProfitAnnualized && data.netProfitAnnualized < 0 ? '🔴' : ''}

💰 估值指标
  └─ 每股收益(EPS-TTM): ${data.epsTTM ? (data.epsTTM >= 0 ? '+' : '') + data.epsTTM.toFixed(4) + ' 元' : '暂无'} ${data.epsTTM && data.epsTTM < 0 ? '🔴 亏损' : ''}
  ※ 计算PE: 当前股价 ÷ EPS = 市盈率（需结合上方实时股价）
  ※ 请联网搜索"[股票名称] 所在行业 平均PE"获取行业对比参考

📈 五率（效率指标）
  ├─ ROE（净资产收益率）: ${formatPercent(data.roe)} ${roeLevel}
  ├─ 资产负债率: ${data.debtRatio ? data.debtRatio + '%' : '暂无'} ${debtLevel}
  ├─ 毛利率: ${formatPercent(data.grossProfitMargin)}
  ├─ 毛利率变化: ${formatPercent(data.grossProfitMarginChange)} ${gpmChangeLevel}
  ├─ 净利率: ${formatPercent(data.netProfitMargin)}
  └─ 营业现金比率: ${formatPercent(data.cfoToRevenue)} ${cfoLevel}
${historicalSection}
📉 成长性
  ├─ 净利润同比: ${formatPercent(data.yoyNetProfit)}
  └─ 总资产同比: ${formatPercent(data.yoyAsset)}

⚙️ 运营效率
  ├─ 资产周转率: ${data.assetTurnover ? data.assetTurnover.toFixed(2) + 'x' : '暂无'}
  ├─ 应收账款周转率: ${data.receivableTurnover ? data.receivableTurnover.toFixed(2) + 'x' : '暂无'}
  └─ 存货周转率: ${data.inventoryTurnover ? data.inventoryTurnover.toFixed(2) + 'x' : '暂无'}

数据更新: ${data.updateTime}
═══════════════════════════════════════════════════════════
`;
}