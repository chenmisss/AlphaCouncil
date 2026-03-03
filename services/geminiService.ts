import { AgentConfig, AgentRole, ApiKeys, ModelProvider, WorkflowState } from '../types';

// 后端 AI 代理接口 URL
// 使用相对路径，以适配子目录部署 (例如 /AlphaCouncil/api/ai)
const getBackendUrl = () => 'api/ai';

/**
 * 核心函数：根据配置生成单个智能体的回复
 * 包含 Gemini, DeepSeek, Qwen 的调用逻辑
 * 支持可选的图片 URL 用于 Gemini Vision 多模态分析
 */
export async function generateAgentResponse(
  config: AgentConfig,
  stockSymbol: string,
  apiKeys: ApiKeys,
  context: string = "",
  stockDataContext: string = "",
  imageUrl?: string // 可选的图片 URL，用于 K 线图分析
): Promise<string> {
  // 构建通用 Prompt 模板，强调使用实时数据和输出精简
  const prompt = `
    目标标的: ${stockSymbol} (A股 / 沪深)
    【当前时间】: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}
    
    【实时行情数据 (来源: 聚合数据 API)】:
    ${stockDataContext}

    【系统身份与任务】:
    ${config.systemPrompt}
    
    【来自同事/下属的背景信息】:
    ${context ? context : "暂无前序背景，请基于独立视角分析。"}

    【严格执行指令】:
    1. 必须优先参考提供的【实时行情数据】，特别是价格、成交量和买卖盘口。
    2. 如果你是宏观/行业分析师，请结合个股数据与宏观知识。
    3. **输出必须极度精炼、专业，使用Markdown列表格式。**
    4. **严禁废话、客套话，直接给出结论和数据支撑。**
  `;

  try {
    // 1. 调用 GEMINI 模型
    if (config.modelProvider === ModelProvider.GEMINI) {
      // 如果有图片 URL，使用 Vision 端点进行多模态分析
      const endpoint = imageUrl ? `${getBackendUrl()}/gemini-vision` : `${getBackendUrl()}/gemini`;

      const requestBody: Record<string, unknown> = {
        model: config.modelName,
        prompt: prompt,
        temperature: config.temperature,
        apiKey: apiKeys.gemini
      };

      // 如果有图片，添加到请求中
      if (imageUrl) {
        requestBody.imageUrl = imageUrl;
        console.log(`[Gemini Vision] ${config.title} 将分析 K 线图: ${imageUrl}`);
      } else {
        requestBody.tools = [{ googleSearch: {} }];
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`Gemini API 错误: ${response.statusText}`);
      }

      const data = await response.json();
      console.log(`[Gemini] ${config.title} ${imageUrl ? '完成 K 线图分析' : '已启用 Google Search Grounding'}`);
      return data.text || "生成内容失败 (Gemini)";
    }

    // 2. 调用 DEEPSEEK 模型
    if (config.modelProvider === ModelProvider.DEEPSEEK) {
      const response = await fetch(`${getBackendUrl()}/deepseek`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.modelName,
          systemPrompt: config.systemPrompt,
          prompt: prompt,
          temperature: config.temperature,
          apiKey: apiKeys.deepseek // 传递前端 API Key
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(`DeepSeek API 错误: ${err.error || response.statusText}`);
      }

      const data = await response.json();
      return data.text || "生成内容失败 (DeepSeek)";
    }

    // 3. 调用 通义千问 (QWEN) 模型
    if (config.modelProvider === ModelProvider.QWEN) {
      const response = await fetch(`${getBackendUrl()}/qwen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.modelName,
          systemPrompt: config.systemPrompt,
          prompt: prompt,
          temperature: config.temperature,
          apiKey: apiKeys.qwen // 传递前端 API Key
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(`Qwen API 错误: ${err.error || response.statusText}`);
      }

      const data = await response.json();
      return data.text || "生成内容失败 (Qwen)";
    }

    // 4. 调用 OPENAI 模型
    if (config.modelProvider === ModelProvider.OPENAI) {
      const endpoint = `${getBackendUrl()}/openai`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.modelName,
          systemPrompt: config.systemPrompt,
          prompt: prompt,
          temperature: config.temperature,
          apiKey: apiKeys.openai
        })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        // 如果是配额错误，抛出以触发 fallback
        if (err.shouldFallback) {
          throw new Error(`OpenAI 配额不足: ${err.error || response.statusText}`);
        }
        throw new Error(`OpenAI API 错误: ${err.error || response.statusText}`);
      }

      const data = await response.json();
      return data.text || "生成内容失败 (OpenAI)";
    }

    return "不支持的模型提供商";

  } catch (error) {
    console.error(`Error generating response for ${config.title}:`, error);
    throw error; // 抛出错误以便 fallback 逻辑捕获
  }
}

/**
 * 辅助函数：安全生成（带多层降级机制）
 * 如果首选模型失败，按照 MODEL_FALLBACK_CHAIN 顺序尝试备用模型
 */
async function safeGenerate(
  config: AgentConfig,
  stockSymbol: string,
  apiKeys: ApiKeys,
  context: string,
  stockDataContext: string,
  imageUrl?: string
): Promise<string> {
  const { MODEL_FALLBACK_CHAIN, DEFAULT_MODEL_BY_PROVIDER } = await import('../constants');

  // 构建完整的 fallback 链：[主模型, 备用1, 备用2]
  const fallbackChain = [
    config.modelProvider,
    ...MODEL_FALLBACK_CHAIN[config.modelProvider]
  ];

  let lastError: Error | null = null;

  for (let i = 0; i < fallbackChain.length; i++) {
    const provider = fallbackChain[i];
    const isPrimary = i === 0;

    try {
      // 创建当前尝试的配置
      const currentConfig: AgentConfig = isPrimary
        ? config
        : {
          ...config,
          modelProvider: provider,
          modelName: DEFAULT_MODEL_BY_PROVIDER[provider]
        };

      console.log(`[Fallback] ${config.title}: 尝试 ${provider}${isPrimary ? ' (主模型)' : ' (备用)'}`);

      const result = await generateAgentResponse(currentConfig, stockSymbol, apiKeys, context, stockDataContext, imageUrl);

      // 如果不是主模型，添加降级提示
      if (!isPrimary) {
        console.log(`[Fallback] ${config.title}: ${provider} 成功（主模型 ${config.modelProvider} 不可用）`);
        return result + `\n\n*(注: ${config.modelProvider} 不可用，由 ${provider} 备用生成)*`;
      }

      return result;

    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      console.warn(`[Fallback] ${config.title}: ${provider} 失败 - ${lastError.message}`);

      // 继续尝试下一个备用模型
      continue;
    }
  }

  // 所有模型都失败
  console.error(`[Fallback] ${config.title}: 所有模型均失败`);
  return `⚠️ 分析失败：所有模型均不可用\n\n错误详情: ${lastError?.message || '未知错误'}\n\n请检查:\n1. API Key 是否正确配置\n2. 网络连接是否正常\n3. 各服务商是否正常运行`;
}

/**
 * 第一阶段：并行分析师
 * 5位分析师同时根据实时数据进行分析
 * 技术分析师会额外获得 K 线图进行视觉分析
 */
export async function runAnalystsStage(
  stockSymbol: string,
  configs: Record<AgentRole, AgentConfig>,
  apiKeys: ApiKeys,
  stockDataContext: string,
  chartUrl?: string  // K线图 URL，传给技术分析师
) {
  const analystRoles = [
    AgentRole.MACRO,
    AgentRole.INDUSTRY,
    AgentRole.MARKET_INDEX,  // 大盘趋势分析师
    AgentRole.TECHNICAL,
    AgentRole.FUNDS,
    AgentRole.FUNDAMENTAL
  ];

  // 并行执行所有 Promise
  const promises = analystRoles.map(role => {
    // 技术分析师使用 K 线图进行视觉分析
    const imageForRole = (role === AgentRole.TECHNICAL) ? chartUrl : undefined;
    return safeGenerate(configs[role], stockSymbol, apiKeys, "", stockDataContext, imageForRole)
      .then(res => ({ role, res }));
  });

  const results = await Promise.all(promises);
  // 将结果数组转换为对象 { ROLE: content }
  return results.reduce((acc, curr) => ({ ...acc, [curr.role]: curr.res }), {});
}

/**
 * 第二阶段：经理整合
 * 两位总监分别整合 基本面 和 市场动能 信息
 * 注意：同时提供原始数据供经理交叉验证，防止分析师幻觉
 */
export async function runManagersStage(
  stockSymbol: string,
  outputs: WorkflowState['outputs'],
  configs: Record<AgentRole, AgentConfig>,
  apiKeys: ApiKeys,
  stockDataContext: string
) {
  // 基本面上下文：所有6位分析师报告 + 原始数据（供交叉验证）
  const fundContext = `
【第一阶段：6位专业分析师报告】
[宏观政策分析师]: ${outputs[AgentRole.MACRO]}
[行业轮动分析师]: ${outputs[AgentRole.INDUSTRY]}
[大盘趋势分析师]: ${outputs[AgentRole.MARKET_INDEX]}
[技术分析专家]: ${outputs[AgentRole.TECHNICAL]}
[资金流向分析师]: ${outputs[AgentRole.FUNDS]}
[基本面估值分析师]: ${outputs[AgentRole.FUNDAMENTAL]}

【⚠️ 原始数据（请核对上述报告中的数字是否准确）】
${stockDataContext}

【验证提醒】如发现报告中的数字与原始数据不符，请以原始数据为准，并在分析中使用正确数据。
  `;

  // 动能上下文：所有6位分析师报告 + 原始数据（供交叉验证）
  const momContext = `
【第一阶段：6位专业分析师报告】
[宏观政策分析师]: ${outputs[AgentRole.MACRO]}
[行业轮动分析师]: ${outputs[AgentRole.INDUSTRY]}
[大盘趋势分析师]: ${outputs[AgentRole.MARKET_INDEX]}
[技术分析专家]: ${outputs[AgentRole.TECHNICAL]}
[资金流向分析师]: ${outputs[AgentRole.FUNDS]}
[基本面估值分析师]: ${outputs[AgentRole.FUNDAMENTAL]}

【⚠️ 原始数据（请核对上述报告中的数字是否准确）】
${stockDataContext}

【验证提醒】如发现报告中的数字与原始数据不符，请以原始数据为准，并在分析中使用正确数据。
  `;

  const [fundRes, momRes] = await Promise.all([
    safeGenerate(configs[AgentRole.MANAGER_FUNDAMENTAL], stockSymbol, apiKeys, fundContext, ""),
    safeGenerate(configs[AgentRole.MANAGER_MOMENTUM], stockSymbol, apiKeys, momContext, "")
  ]);

  return {
    [AgentRole.MANAGER_FUNDAMENTAL]: fundRes,
    [AgentRole.MANAGER_MOMENTUM]: momRes
  };
}

/**
 * 第三阶段：风控与机会评估
 * 两位风控总监+一位机会分析师，平衡视角
 */
export async function runRiskStage(
  stockSymbol: string,
  outputs: WorkflowState['outputs'],
  configs: Record<AgentRole, AgentConfig>,
  apiKeys: ApiKeys,
  stockDataContext: string
) {
  // 所有3位都看所有8位前序报告
  const sharedContext = `
【第一阶段：6位专业分析师报告】
[宏观政策分析师]: ${outputs[AgentRole.MACRO]}
[行业轮动分析师]: ${outputs[AgentRole.INDUSTRY]}
[大盘趋势分析师]: ${outputs[AgentRole.MARKET_INDEX]}
[技术分析专家]: ${outputs[AgentRole.TECHNICAL]}
[资金流向分析师]: ${outputs[AgentRole.FUNDS]}
[基本面估值分析师]: ${outputs[AgentRole.FUNDAMENTAL]}

【第二阶段：2位研究总监报告】
[基本面研究总监]: ${outputs[AgentRole.MANAGER_FUNDAMENTAL]}
[市场动能总监]: ${outputs[AgentRole.MANAGER_MOMENTUM]}
  `;

  const [sysRes, portRes, oppRes] = await Promise.all([
    safeGenerate(configs[AgentRole.RISK_SYSTEM], stockSymbol, apiKeys, sharedContext, stockDataContext),
    safeGenerate(configs[AgentRole.RISK_PORTFOLIO], stockSymbol, apiKeys, sharedContext, stockDataContext),
    safeGenerate(configs[AgentRole.OPPORTUNITY], stockSymbol, apiKeys, sharedContext, stockDataContext)
  ]);

  return {
    [AgentRole.RISK_SYSTEM]: sysRes,
    [AgentRole.RISK_PORTFOLIO]: portRes,
    [AgentRole.OPPORTUNITY]: oppRes
  };
}

/**
 * 第四阶段：总经理决策
 * 综合所有信息做出最终买卖决定
 * 【重要】总经理看全部9份报告，防止信息在传递中失真
 */
export async function runGMStage(
  stockSymbol: string,
  outputs: WorkflowState['outputs'],
  configs: Record<AgentRole, AgentConfig>,
  apiKeys: ApiKeys,
  stockDataContext: string
) {
  // 总经理看全部10份报告，不只是总监汇总
  const context = `
=== 第一阶段：6位专业分析师原始报告 ===

[宏观政策分析师]:
${outputs[AgentRole.MACRO]}

[行业轮动分析师]:
${outputs[AgentRole.INDUSTRY]}

[大盘趋势分析师]:
${outputs[AgentRole.MARKET_INDEX]}

[技术分析专家]:
${outputs[AgentRole.TECHNICAL]}

[资金流向分析师]:
${outputs[AgentRole.FUNDS]}

[基本面估值分析师]:
${outputs[AgentRole.FUNDAMENTAL]}

=== 第二阶段：2位研究总监整合报告 ===

[基本面研究总监]:
${outputs[AgentRole.MANAGER_FUNDAMENTAL]}

[市场动能总监]:
${outputs[AgentRole.MANAGER_MOMENTUM]}

=== 第三阶段：3位评估专家报告（风控+机会）===

[系统性风险总监]:
${outputs[AgentRole.RISK_SYSTEM]}

[组合风险总监]:
${outputs[AgentRole.RISK_PORTFOLIO]}

[机会分析师]:
${outputs[AgentRole.OPPORTUNITY]}
  `;

  const res = await safeGenerate(configs[AgentRole.GM], stockSymbol, apiKeys, context, stockDataContext);
  return { [AgentRole.GM]: res };
}