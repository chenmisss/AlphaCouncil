/**
 * 支付宝支付模块
 * 使用支付宝官方 SDK
 */

import AlipaySdk from 'alipay-sdk';
import crypto from 'crypto';

// 从环境变量读取配置
const ALIPAY_APP_ID = process.env.ALIPAY_APP_ID;
const ALIPAY_PRIVATE_KEY = process.env.ALIPAY_PRIVATE_KEY;
const ALIPAY_PUBLIC_KEY = process.env.ALIPAY_PUBLIC_KEY;
const NOTIFY_URL = process.env.ALIPAY_NOTIFY_URL || 'https://your-domain.com/AlphaCouncil/api/payment/notify';

// 订单存储（生产环境应使用数据库）
const orders = new Map();

// 初始化支付宝 SDK
let alipaySdk = null;

function getAlipaySdk() {
    if (!alipaySdk && ALIPAY_APP_ID && ALIPAY_PRIVATE_KEY) {
        alipaySdk = new AlipaySdk({
            appId: ALIPAY_APP_ID,
            privateKey: ALIPAY_PRIVATE_KEY,
            alipayPublicKey: ALIPAY_PUBLIC_KEY,
            signType: 'RSA2',
        });
    }
    return alipaySdk;
}

/**
 * 生成订单号
 */
function generateOrderId() {
    const timestamp = Date.now().toString();
    const random = crypto.randomBytes(4).toString('hex');
    return `AC${timestamp}${random}`;
}

/**
 * 创建支付宝订单（当面付 - 扫码支付）
 * @param {object} params - { amount, subject, stockSymbol }
 * @returns {object} - { success, orderId, qrCode, error }
 */
export async function createAlipayOrder({ amount, subject, stockSymbol }) {
    const sdk = getAlipaySdk();

    if (!sdk) {
        return {
            success: false,
            error: '支付宝未配置，请检查环境变量'
        };
    }

    const orderId = generateOrderId();

    try {
        // 调用支付宝当面付接口
        const result = await sdk.exec('alipay.trade.precreate', {
            bizContent: {
                out_trade_no: orderId,
                total_amount: amount.toFixed(2),
                subject: subject || 'AlphaCouncil AI分析服务',
                body: `股票分析-${stockSymbol}`,
            },
            notifyUrl: NOTIFY_URL,
        });

        if (result.code === '10000') {
            // 保存订单
            orders.set(orderId, {
                orderId,
                amount,
                stockSymbol,
                status: 'pending',
                qrCode: result.qrCode,
                createdAt: new Date(),
            });

            console.log(`[Alipay] 订单创建成功: ${orderId}`);

            return {
                success: true,
                orderId,
                qrCode: result.qrCode,
            };
        } else {
            console.error(`[Alipay] 创建订单失败:`, result);
            return {
                success: false,
                error: result.subMsg || result.msg || '创建订单失败',
            };
        }
    } catch (error) {
        console.error(`[Alipay] 创建订单异常:`, error);
        return {
            success: false,
            error: error.message || '支付宝接口调用失败',
        };
    }
}

/**
 * 查询订单状态
 * @param {string} orderId - 订单号
 * @returns {object} - { success, paid, status, error }
 */
export async function queryOrderStatus(orderId) {
    const sdk = getAlipaySdk();

    if (!sdk) {
        return { success: false, error: '支付宝未配置' };
    }

    // 先检查本地订单状态
    const order = orders.get(orderId);
    if (order && order.status === 'paid') {
        return { success: true, paid: true, status: 'paid' };
    }

    try {
        // 调用支付宝查询接口
        const result = await sdk.exec('alipay.trade.query', {
            bizContent: {
                out_trade_no: orderId,
            },
        });

        if (result.code === '10000') {
            const tradeStatus = result.tradeStatus;
            const paid = tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED';

            // 更新本地订单状态
            if (paid && order) {
                order.status = 'paid';
                order.paidAt = new Date();
            }

            return {
                success: true,
                paid,
                status: tradeStatus,
            };
        } else if (result.code === '40004') {
            // 订单不存在或未支付
            return { success: true, paid: false, status: 'pending' };
        } else {
            return {
                success: false,
                error: result.subMsg || result.msg,
            };
        }
    } catch (error) {
        console.error(`[Alipay] 查询订单异常:`, error);
        return {
            success: false,
            error: error.message,
        };
    }
}

/**
 * 处理支付宝异步通知
 * @param {object} params - 支付宝回调参数
 * @returns {boolean} - 验证是否成功
 */
export function handleNotify(params) {
    const sdk = getAlipaySdk();

    if (!sdk) {
        console.error('[Alipay] 通知处理失败: SDK未初始化');
        return false;
    }

    try {
        // 验证签名
        const signValid = sdk.checkNotifySign(params);

        if (!signValid) {
            console.error('[Alipay] 签名验证失败');
            return false;
        }

        const { out_trade_no, trade_status } = params;

        if (trade_status === 'TRADE_SUCCESS' || trade_status === 'TRADE_FINISHED') {
            // 更新订单状态
            const order = orders.get(out_trade_no);
            if (order) {
                order.status = 'paid';
                order.paidAt = new Date();
                order.tradeNo = params.trade_no;
                console.log(`[Alipay] 订单支付成功: ${out_trade_no}`);
            }
        }

        return true;
    } catch (error) {
        console.error('[Alipay] 通知处理异常:', error);
        return false;
    }
}

/**
 * 获取订单信息
 */
export function getOrder(orderId) {
    return orders.get(orderId);
}

/**
 * 清理过期订单（超过2小时的未支付订单）
 */
export function cleanupExpiredOrders() {
    const now = Date.now();
    const twoHours = 2 * 60 * 60 * 1000;

    for (const [orderId, order] of orders.entries()) {
        if (order.status === 'pending' && now - order.createdAt.getTime() > twoHours) {
            orders.delete(orderId);
            console.log(`[Alipay] 清理过期订单: ${orderId}`);
        }
    }
}

// 每小时清理一次过期订单
setInterval(cleanupExpiredOrders, 60 * 60 * 1000);
