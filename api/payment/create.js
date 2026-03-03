/**
 * 支付订单创建 API
 */

import { createAlipayOrder } from '../../server/alipay.js';

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const { stockSymbol, paymentMethod = 'alipay' } = req.body;

    if (!stockSymbol) {
        return res.status(400).json({ success: false, error: '缺少股票代码' });
    }

    // 固定价格
    const amount = 9.9;
    const subject = `AlphaCouncil AI分析 - ${stockSymbol}`;

    try {
        if (paymentMethod === 'alipay') {
            const result = await createAlipayOrder({
                amount,
                subject,
                stockSymbol,
            });

            if (result.success) {
                return res.json({
                    success: true,
                    orderId: result.orderId,
                    qrCode: result.qrCode,
                    amount,
                    paymentMethod: 'alipay',
                });
            } else {
                return res.status(500).json({
                    success: false,
                    error: result.error,
                });
            }
        } else {
            // 微信支付待实现
            return res.status(400).json({
                success: false,
                error: '暂不支持该支付方式',
            });
        }
    } catch (error) {
        console.error('[Payment] 创建订单失败:', error);
        return res.status(500).json({
            success: false,
            error: error.message || '创建订单失败',
        });
    }
}
