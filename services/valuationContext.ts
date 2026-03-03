/**
 * 估值上下文分析服务
 * 提供历史估值位置推算和行业估值对比
 */

interface ValuationLevel {
    估值水平: string;
    参考依据: string;
}

interface IndustryPE {
    范围: string;
    说明: string;
}

/**
 * 基于当前估值和ROE推算历史估值位置
 * 注：这是基于启发式规则的推算，不是真实历史数据
 */
export function estimateValuationPercentile(
    currentPE: number,
    roe: number
): ValuationLevel {
    if (!currentPE || currentPE <= 0) {
        return {
            估值水平: "数据不足",
            参考依据: "当前PE数据无效"
        };
    }

    // 基于ROE推断合理PE范围
    const reasonableRange = getReasonablePERange(roe);

    if (currentPE < reasonableRange.low) {
        return {
            估值水平: "历史低位（低于合理区间）",
            参考依据: `当前PE ${currentPE.toFixed(1)} < 合理下限 ${reasonableRange.low.toFixed(1)}`
        };
    } else if (currentPE > reasonableRange.high) {
        return {
            估值水平: "历史高位（高于合理区间）",
            参考依据: `当前PE ${currentPE.toFixed(1)} > 合理上限 ${reasonableRange.high.toFixed(1)}`
        };
    } else {
        return {
            估值水平: "合理区间",
            参考依据: `PE ${currentPE.toFixed(1)} 位于 [${reasonableRange.low.toFixed(1)}, ${reasonableRange.high.toFixed(1)}] 区间`
        };
    }
}

/**
 * 基于ROE推断合理PE范围
 * 高ROE成长股合理PE更高，低ROE价值股合理PE更低
 */
function getReasonablePERange(roe: number): { low: number; high: number } {
    let basePE: number;

    if (roe >= 20) {
        basePE = 25; // 高ROE成长股
    } else if (roe >= 15) {
        basePE = 20; // 优质成长股
    } else if (roe >= 10) {
        basePE = 15; // 稳健型
    } else if (roe >= 5) {
        basePE = 10; // 低盈利
    } else {
        basePE = 8;  // 微利/亏损
    }

    return {
        low: basePE * 0.6,   // 下限：基准PE的60%
        high: basePE * 1.5   // 上限：基准PE的150%
    };
}

/**
 * 获取行业典型PE范围
 * 基于市场常识和典型案例
 */
export function getIndustryTypicalPE(industryName: string): IndustryPE {
    const industryMap: Record<string, { range: string; note: string }> = {
        // 高成长行业
        "半导体": { range: "30-50倍", note: "高成长科技行业" },
        "芯片": { range: "30-50倍", note: "高成长科技行业" },
        "新能源": { range: "25-40倍", note: "政策支持成长行业" },
        "新能源汽车": { range: "25-40倍", note: "政策支持成长行业" },
        "光伏": { range: "20-35倍", note: "清洁能源行业" },

        // 稳健成长
        "消费电子": { range: "20-35倍", note: "稳定成长行业" },
        "医药": { range: "25-40倍", note: "防御性成长" },
        "生物医药": { range: "30-50倍", note: "创新药成长性" },
        "白酒": { range: "25-40倍", note: "高盈利消费品" },
        "食品饮料": { range: "20-35倍", note: "消费稳定行业" },

        // 价值型
        "银行": { range: "4-8倍", note: "低估值价值股" },
        "保险": { range: "8-15倍", note: "金融价值股" },
        "房地产": { range: "5-10倍", note: "周期性行业" },
        "建筑": { range: "6-12倍", note: "基建相关" },
        "钢铁": { range: "5-10倍", note: "周期性重资产" },
        "煤炭": { range: "6-12倍", note: "资源周期股" },

        // 中等估值
        "汽车": { range: "12-20倍", note: "制造业" },
        "机械": { range: "15-25倍", note: "装备制造" },
        "化工": { range: "12-20倍", note: "周期性制造" },
        "电力": { range: "10-18倍", note: "公用事业" },

        // 默认
        "default": { range: "15-25倍", note: "市场平均水平" }
    };

    // 模糊匹配：如果行业名包含关键词
    for (const [key, value] of Object.entries(industryMap)) {
        if (industryName.includes(key) || key.includes(industryName)) {
            return {
                范围: value.range,
                说明: value.note
            };
        }
    }

    // 默认值
    const defaultInfo = industryMap["default"];
    return {
        范围: defaultInfo.range,
        说明: defaultInfo.note
    };
}

/**
 * 格式化估值上下文为AI可读文本
 */
export function formatValuationContext(
    currentPE: number,
    currentPB: number,
    roe: number,
    industryName: string = "default"
): string {
    const valuationLevel = estimateValuationPercentile(currentPE, roe);
    const industryPE = getIndustryTypicalPE(industryName);

    // 解析行业PE范围用于对比
    const industryRange = industryPE.范围.match(/(\d+)-(\d+)/);
    let comparisonText = "数据不足";

    if (industryRange && currentPE > 0) {
        const industryLow = parseFloat(industryRange[1]);
        const industryHigh = parseFloat(industryRange[2]);
        const industryMid = (industryLow + industryHigh) / 2;

        if (currentPE < industryLow * 0.8) {
            comparisonText = `💚 显著低估（低于行业下限${(((industryLow - currentPE) / industryLow * 100)).toFixed(0)}%）`;
        } else if (currentPE < industryLow) {
            comparisonText = `🟢 相对低估（接近行业下限）`;
        } else if (currentPE <= industryMid) {
            comparisonText = `😐 行业中下位（低于中位值）`;
        } else if (currentPE <= industryHigh) {
            comparisonText = `🟡 行业中上位（接近上限）`;
        } else if (currentPE > industryHigh * 1.2) {
            comparisonText = `🔴 显著高估（超行业上限${(((currentPE - industryHigh) / industryHigh * 100)).toFixed(0)}%）`;
        } else {
            comparisonText = `⚠️ 相对高估（超过行业上限）`;
        }
    }

    return `
╔═══════════════════════════════════════════════════════════╗
║              估值上下文分析（供机会分析师参考）            ║
╚═══════════════════════════════════════════════════════════╝

【历史估值位置（推算）】
估值水平: ${valuationLevel.估值水平}
参考依据: ${valuationLevel.参考依据}

【行业估值对比】
行业典型PE范围: ${industryPE.范围} （${industryPE.说明}）
当前PE: ${currentPE.toFixed(2)}倍 | PB: ${currentPB.toFixed(2)}倍
→ ${comparisonText}

【估值判断逻辑】
- ROE ${roe.toFixed(1)}% → 高ROE公司合理PE更高
- 当前PE相对合理区间和行业水平的位置
- 结合基本面趋势判断是否存在均值回归机会

**⚠️ 数据说明**：
- 历史估值位置基于启发式规则推算（非真实历史数据）
- 行业PE范围基于市场常识和典型案例
- 仅供参考，需结合公司基本面、催化剂等综合判断
`;
}
