import fetch from 'node-fetch';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_BASE_URL = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';

/**
 * Gemini Vision 多模态 API - 支持图片分析
 * 用于技术分析师查看 K 线图
 */
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const { model, prompt, temperature, imageUrl, apiKey } = req.body;

    const effectiveApiKey = GEMINI_API_KEY || apiKey;

    if (!effectiveApiKey) {
        return res.status(500).json({
            success: false,
            error: '未配置 Gemini API Key'
        });
    }

    try {
        // 使用最新的 Gemini 3 Pro Preview 进行多模态分析
        const modelName = model || 'gemini-3.1-pro-preview';
        const url = `${GEMINI_BASE_URL}/v1beta/models/${modelName}:generateContent?key=${effectiveApiKey}`;

        console.log(`[Gemini Vision] Requesting: ${modelName} with image from ${imageUrl}`);

        // 构建 multimodal 请求内容
        let parts = [];

        // 如果提供了图片 URL，获取图片并转为 base64
        if (imageUrl) {
            try {
                const imageResponse = await fetch(imageUrl);
                if (imageResponse.ok) {
                    const arrayBuffer = await imageResponse.arrayBuffer();
                    const base64Image = Buffer.from(arrayBuffer).toString('base64');
                    const mimeType = imageResponse.headers.get('content-type') || 'image/png';

                    parts.push({
                        inline_data: {
                            mime_type: mimeType,
                            data: base64Image
                        }
                    });
                    console.log(`[Gemini Vision] Image loaded: ${base64Image.length} bytes (base64)`);
                } else {
                    console.warn(`[Gemini Vision] Failed to fetch image: ${imageResponse.status}`);
                }
            } catch (imgError) {
                console.warn(`[Gemini Vision] Image fetch error: ${imgError.message}`);
            }
        }

        // 添加文本 prompt
        parts.push({ text: prompt });

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{
                    parts: parts
                }],
                generationConfig: {
                    temperature: temperature || 0.7
                }
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`Gemini Vision API Error (${response.status}): ${JSON.stringify(errorData)}`);
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        return res.json({
            success: true,
            text: text
        });

    } catch (error) {
        console.error('[Gemini Vision] 请求失败:', error.message);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
}
