import fetch from 'node-fetch';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com'; // 支持代理

if (!OPENAI_API_KEY) {
    console.error('[OpenAI] 未配置 OPENAI_API_KEY 环境变量');
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

    const { model, systemPrompt, prompt, temperature, apiKey } = req.body;

    // 优先使用环境变量，前端传递的 API Key 作为备用
    const effectiveApiKey = OPENAI_API_KEY || apiKey;

    if (!effectiveApiKey) {
        return res.status(400).json({
            success: false,
            error: '未配置 OpenAI API Key'
        });
    }

    try {
        const modelName = model || 'chatgpt-4o-latest';

        console.log(`[OpenAI] 请求模型: ${modelName} via ${OPENAI_BASE_URL}`);

        // OpenAI o1 系列模型有特殊限制
        const isO1Model = modelName.includes('o1');

        const messages = [];

        // o1 模型不支持 system role，需要合并到 user message
        if (isO1Model) {
            const combinedPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
            messages.push({
                role: 'user',
                content: combinedPrompt
            });
        } else {
            if (systemPrompt) {
                messages.push({
                    role: 'system',
                    content: systemPrompt
                });
            }
            messages.push({
                role: 'user',
                content: prompt
            });
        }

        const requestBody = {
            model: modelName,
            messages: messages,
            max_tokens: 4096 // 限制最大输出 token，防止 OpenRouter 预扣费过多导致 402
        };

        // o1 模型不支持 temperature 参数
        if (!isO1Model && temperature !== undefined) {
            requestBody.temperature = temperature;
        }

        const response = await fetch(`${OPENAI_BASE_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${effectiveApiKey}`
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));

            // 检查是否是配额错误
            if (response.status === 429 ||
                errorData.error?.type === 'insufficient_quota' ||
                errorData.error?.code === 'rate_limit_exceeded') {
                const error = new Error(`OpenAI 配额不足: ${errorData.error?.message || 'Unknown'}`);
                error.shouldFallback = true; // 触发 fallback 到 Gemini
                throw error;
            }

            throw new Error(`OpenAI API 错误 (${response.status}): ${JSON.stringify(errorData)}`);
        }

        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || '';

        return res.json({
            success: true,
            text: text
        });

    } catch (error) {
        console.error('[OpenAI] 请求失败:', error.message);

        // 传递 shouldFallback 标记给前端
        return res.status(error.shouldFallback ? 503 : 500).json({
            success: false,
            error: error.message,
            shouldFallback: error.shouldFallback || false
        });
    }
}
