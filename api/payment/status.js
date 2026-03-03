/**
 * 订单状态查询 API
 */

import { queryOrderStatus } from '../../server/alipay.js';

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // 支持 GET 和 POST
    const orderId = req.query?.orderId || req.body?.orderId;

    if (!orderId) {
        return res.status(400).json({ success: false, error: '缺少订单号' });
    }

    try {
        const result = await queryOrderStatus(orderId);
        return res.json(result);
    } catch (error) {
        console.error('[Payment] 查询订单状态失败:', error);
        return res.status(500).json({
            success: false,
            error: error.message || '查询订单状态失败',
        });
    }
}
