/**
 * 支付宝异步通知回调 API
 */

import { handleNotify } from '../../server/alipay.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).send('Method not allowed');
    }

    console.log('[Payment Notify] 收到支付宝回调:', req.body);

    try {
        const success = handleNotify(req.body);

        if (success) {
            // 支付宝要求返回 "success" 字符串
            return res.status(200).send('success');
        } else {
            return res.status(400).send('fail');
        }
    } catch (error) {
        console.error('[Payment Notify] 处理回调失败:', error);
        return res.status(500).send('fail');
    }
}
