import fetch from 'node-fetch';

// ========== API Key 池配置 ==========
// 支持多个 API Key 轮询，当一个达到限额时自动切换
const GEMINI_API_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3
].filter(Boolean); // 过滤掉未配置的 key

const GEMINI_BASE_URL = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';

// API Key 状态追踪（内存中，重启后重置）
const keyStatus = GEMINI_API_KEYS.map((key, index) => ({
  key,
  index,
  failed: false,        // 是否失败
  lastError: null,      // 最后错误
  lastErrorTime: null   // 最后错误时间
}));

let currentKeyIndex = 0; // 当前使用的 Key 索引

if (GEMINI_API_KEYS.length === 0) {
  console.error('[Gemini] ⚠️  未配置任何 GEMINI_API_KEY 环境变量');
} else {
  console.log(`[Gemini] ✅ 已加载 ${GEMINI_API_KEYS.length} 个 API Key`);
}

/**
 * 获取下一个可用的 API Key
 */
function getNextAvailableKey() {
  // 先尝试当前 Key
  if (!keyStatus[currentKeyIndex].failed) {
    return keyStatus[currentKeyIndex];
  }

  // 查找第一个未失败的 Key
  for (let i = 0; i < keyStatus.length; i++) {
    if (!keyStatus[i].failed) {
      currentKeyIndex = i;
      return keyStatus[i];
    }
  }

  // 所有 Key 都失败了，重置状态并从头开始
  console.log('[Gemini] ⚠️  所有 API Key 都已达到限额，重置状态');
  keyStatus.forEach(k => {
    k.failed = false;
    k.lastError = null;
  });
  currentKeyIndex = 0;
  return keyStatus[0];
}

/**
 * 标记当前 Key 为失败状态
 */
function markCurrentKeyFailed(error) {
  const current = keyStatus[currentKeyIndex];
  current.failed = true;
  current.lastError = error;
  current.lastErrorTime = new Date();

  console.log(`[Gemini] ❌ API Key #${currentKeyIndex + 1} 已达到限额，切换到下一个`);
}

/**
 * 使用带重试的 Gemini API 调用
 */
async function callGeminiWithRetry(modelName, prompt, temperature) {
  const maxRetries = GEMINI_API_KEYS.length; // 最多重试的次数 = Key 的数量

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const keyInfo = getNextAvailableKey();
    const apiKey = keyInfo.key;

    try {
      const url = `${GEMINI_BASE_URL}/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

      console.log(`[Gemini] 🔄 尝试 Key #${keyInfo.index + 1}/${GEMINI_API_KEYS.length}: ${modelName}`);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            temperature: temperature || 0.7
          }
        })
      });

      // 成功响应
      if (response.ok) {
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        console.log(`[Gemini] ✅ Key #${keyInfo.index + 1} 成功`);
        return { success: true, text };
      }

      // 检查是否是配额超限错误 (429 或特定错误码)
      const errorData = await response.json().catch(() => ({}));
      const isQuotaError = response.status === 429 ||
        errorData.error?.message?.includes('quota') ||
        errorData.error?.message?.includes('limit') ||
        errorData.error?.message?.includes('RESOURCE_EXHAUSTED');

      if (isQuotaError) {
        console.log(`[Gemini] ⚠️  Key #${keyInfo.index + 1} 达到配额限制`);
        markCurrentKeyFailed(`Quota exceeded: ${errorData.error?.message || 'Unknown'}`);
        // 继续尝试下一个 Key
        continue;
      }

      // 其他API错误（404/403等），直接抛出触发 fallback
      const error = new Error(`Gemini API Error (${response.status}): ${JSON.stringify(errorData)}`);
      error.shouldFallback = true; // 标记应该触发模型 fallback
      throw error;

    } catch (error) {
      // 网络连接失败或其他异常
      if (error.shouldFallback) {
        // API错误，直接抛出触发 fallback
        throw error;
      }

      // 网络错误（ECONNREFUSED, ETIMEDOUT等）
      if (error.code === 'ECONNREFUSED' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ENOTFOUND' ||
        error.message.includes('fetch failed')) {
        console.error(`[Gemini] ❌ 网络连接失败: ${error.message}`);
        const networkError = new Error(`Gemini 网络连接失败: ${error.message}`);
        networkError.shouldFallback = true; // 触发模型 fallback
        throw networkError;
      }

      // 未知错误，也触发 fallback
      console.error(`[Gemini] ❌ 未知错误: ${error.message}`);
      error.shouldFallback = true;
      throw error;
    }
  }

  // 所有Key都达到配额限制
  throw new Error('所有 Gemini API Key 都已达到配额限制，请稍后再试');
}

export default async function handler(req, res) {
  // 设置 CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { model, prompt, temperature, apiKey } = req.body;

  // 如果前端传了自己的 Key，优先使用
  if (apiKey) {
    try {
      const modelName = model || 'gemini-2.5-flash';
      const url = `${GEMINI_BASE_URL}/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: temperature || 0.7 }
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Gemini API Error (${response.status}): ${JSON.stringify(errorData)}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      return res.json({ success: true, text });
    } catch (error) {
      console.error('[Gemini] 用户提供的 Key 请求失败:', error.message);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // 使用服务器端的 Key 池
  if (GEMINI_API_KEYS.length === 0) {
    return res.status(500).json({
      success: false,
      error: '未配置 Gemini API Key。请在服务器环境变量中配置 GEMINI_API_KEY'
    });
  }

  try {
    const modelName = model || 'gemini-2.5-flash';
    const result = await callGeminiWithRetry(modelName, prompt, temperature);

    return res.json(result);
  } catch (error) {
    console.error('[Gemini] 所有重试失败:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
