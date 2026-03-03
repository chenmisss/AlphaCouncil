/**
 * 东方财富资金流向 API 服务
 * 免费接口，无需 API Key
 */

// 资金流向数据接口
export interface CapitalFlowData {
    code: string;       // 股票代码
    name: string;       // 股票名称
    mainNetInflow: number;    // 主力净流入（元）
    superLargeInflow: number; // 超大单净流入
    largeInflow: number;      // 大单净流入
    mediumInflow: number;     // 中单净流入
    smallInflow: number;      // 小单净流入
    mainNetRatio: number;     // 主力净比（%）
    updateTime: string;       // 更新时间
}

/**
 * 解析东方财富 API 返回的 kline 数据
 * 格式：时间,超大单净流入,大单净流入,中单净流入,小单净流入,主力净流入
 */
function parseKlineData(klines: string[]): {
    mainNetInflow: number;
    superLargeInflow: number;
    largeInflow: number;
    mediumInflow: number;
    smallInflow: number;
} | null {
    if (!klines || klines.length === 0) return null;

    // 取最后一条数据（最新）
    const latestLine = klines[klines.length - 1];
    const parts = latestLine.split(',');

    if (parts.length < 6) return null;

    return {
        superLargeInflow: parseFloat(parts[1]) || 0,
        largeInflow: parseFloat(parts[2]) || 0,
        mediumInflow: parseFloat(parts[3]) || 0,
        smallInflow: parseFloat(parts[4]) || 0,
        mainNetInflow: parseFloat(parts[1]) + parseFloat(parts[2]) || 0 // 主力 = 超大单 + 大单
    };
}

/**
 * 将数字格式化为易读的金额
 */
export function formatAmount(amount: number): string {
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
    if (!data) return "【东方财富资金流向】暂无数据";

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
`;
}
