/**
 * 支付路由
 * /api/pay/*
 */

import express from 'express';
import {
  createAlipayQROrder,
  createAlipayPCOrder,
  createAlipayH5Order,
  queryAlipayOrder,
  verifyAlipayNotify,
} from './alipayService.js';
import {
  generateOrderId,
  createOrder,
  getOrder,
  completeOrder,
  getLatestPaidOrderByFingerprint,
  OrderStatus,
} from './orderService.js';

const router = express.Router();

// 产品价格（分）
const PRODUCT_PRICE = 880; // 8.8 元 (单位: 分)
const PRODUCT_NAME = 'AlphaCouncil 完整分析报告';

// 防重复请求
const recentRequests = new Map();
const REQUEST_COOLDOWN = 3000; // 3秒冷却

setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of recentRequests.entries()) {
    if (now - timestamp > REQUEST_COOLDOWN) {
      recentRequests.delete(key);
    }
  }
}, 60000);

/**
 * POST /api/pay/create
 * 创建支付订单
 */
router.post('/create', async (req, res) => {
  console.log('[PAY CREATE] Starting...');
  try {
    const { fingerprint, stockSymbol, analysisData, isMobile } = req.body;

    if (!fingerprint) {
      return res.status(400).json({ error: '缺少用户标识' });
    }

    // 防重复请求
    const now = Date.now();
    const lastRequest = recentRequests.get(fingerprint);
    if (lastRequest && now - lastRequest < REQUEST_COOLDOWN) {
      return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
    }
    recentRequests.set(fingerprint, now);

    // 生成订单
    const orderId = generateOrderId();
    console.log('[PAY CREATE] Order ID:', orderId);

    // 保存订单（含第一阶段分析数据缓存）
    createOrder({
      orderId,
      fingerprint,
      stockSymbol,
      amount: PRODUCT_PRICE,
      analysisData, // 缓存第一阶段分析结果，PC 端跳转后恢复用
    });

    // 创建支付宝订单
    let paymentResult;
    if (isMobile) {
      // 移动端：使用 H5 支付，直接拉起支付宝 APP
      // 不设置 return_url，支付完成后不跳转，用户手动返回
      paymentResult = await createAlipayH5Order({
        orderId,
        amount: PRODUCT_PRICE,
        subject: PRODUCT_NAME,
        noReturn: true,  // 标记不需要返回跳转
      });
    } else {
      // PC 端：使用当面付二维码
      paymentResult = await createAlipayQROrder({
        orderId,
        amount: PRODUCT_PRICE,
        subject: PRODUCT_NAME,
      });
    }

    if (!paymentResult.success) {
      return res.status(500).json({
        error: '创建支付订单失败',
        message: paymentResult.error,
      });
    }

    console.log('[PAY CREATE] Payment created successfully');
    res.json({
      orderId,
      qrCode: paymentResult.qrCode, // 移动端二维码
      payUrl: paymentResult.payUrl, // PC 端跳转链接
      amount: PRODUCT_PRICE,
      isMobile,
    });
  } catch (error) {
    console.error('[PAY CREATE ERROR]', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/pay/status
 * 查询订单状态（前端轮询用）
 */
router.get('/status', async (req, res) => {
  try {
    const { orderId } = req.query;

    if (!orderId) {
      return res.status(400).json({ error: '缺少订单号' });
    }

    const order = getOrder(orderId);
    if (!order) {
      return res.status(404).json({ error: '订单不存在' });
    }

    // 如果订单仍是 PENDING，主动查询支付宝
    if (order.status === OrderStatus.PENDING) {
      console.log('[PAY STATUS] Order PENDING, querying Alipay...');
      const alipayResult = await queryAlipayOrder(orderId);

      if (alipayResult.success &&
        (alipayResult.tradeStatus === 'TRADE_SUCCESS' || alipayResult.tradeStatus === 'TRADE_FINISHED')) {
        console.log('[PAY STATUS] Payment confirmed by Alipay');
        completeOrder(orderId, alipayResult.tradeNo);

        const updatedOrder = getOrder(orderId);
        return res.json({
          orderId: updatedOrder.orderId,
          status: updatedOrder.status,
          analysisData: updatedOrder.analysisData, // 返回缓存的分析数据
          paidAt: updatedOrder.paidAt,
        });
      }
    }

    res.json({
      orderId: order.orderId,
      status: order.status,
      analysisData: order.status === OrderStatus.SUCCESS ? order.analysisData : null,
      paidAt: order.paidAt,
    });
  } catch (error) {
    console.error('[PAY STATUS ERROR]', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/pay/restore
 * 恢复支付后的分析数据（PC 端跳转回来后用）
 */
router.get('/restore', async (req, res) => {
  try {
    const { orderId, fingerprint } = req.query;

    let order = null;

    if (orderId) {
      // 优先用订单号查询
      order = getOrder(orderId);
    } else if (fingerprint) {
      // 没有订单号，用指纹查最近的已支付订单
      order = getLatestPaidOrderByFingerprint(fingerprint);
    }

    if (!order) {
      return res.status(404).json({ error: '未找到订单' });
    }

    if (order.status !== OrderStatus.SUCCESS) {
      // 再查一次支付宝
      const alipayResult = await queryAlipayOrder(order.orderId);
      if (alipayResult.success &&
        (alipayResult.tradeStatus === 'TRADE_SUCCESS' || alipayResult.tradeStatus === 'TRADE_FINISHED')) {
        completeOrder(order.orderId, alipayResult.tradeNo);
        order = getOrder(order.orderId);
      } else {
        return res.status(400).json({ error: '订单未支付' });
      }
    }

    res.json({
      orderId: order.orderId,
      status: order.status,
      stockSymbol: order.stockSymbol,
      analysisData: order.analysisData,
      paidAt: order.paidAt,
    });
  } catch (error) {
    console.error('[PAY RESTORE ERROR]', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/pay/alipay/notify
 * 支付宝异步回调
 */
router.post('/alipay/notify', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    console.log('[ALIPAY NOTIFY] Received:', req.body);

    // 验证签名
    const verified = verifyAlipayNotify(req.body);
    if (!verified) {
      console.error('[ALIPAY NOTIFY] Signature verification failed');
      return res.send('fail');
    }

    const { out_trade_no, trade_status, trade_no, total_amount } = req.body;

    if (trade_status !== 'TRADE_SUCCESS' && trade_status !== 'TRADE_FINISHED') {
      console.log('[ALIPAY NOTIFY] Trade not success:', trade_status);
      return res.send('success');
    }

    const order = getOrder(out_trade_no);
    if (!order) {
      console.error('[ALIPAY NOTIFY] Order not found:', out_trade_no);
      return res.send('fail');
    }

    // 验证金额
    const amountInCents = Math.round(parseFloat(total_amount) * 100);
    if (order.amount !== amountInCents) {
      console.error('[ALIPAY NOTIFY] Amount mismatch:', order.amount, amountInCents);
      return res.send('fail');
    }

    // 完成订单
    const result = completeOrder(out_trade_no, trade_no);
    if (!result.success) {
      console.log('[ALIPAY NOTIFY] Order already processed');
    } else {
      console.log('[ALIPAY NOTIFY] Order completed:', out_trade_no);
    }

    res.send('success');
  } catch (error) {
    console.error('[ALIPAY NOTIFY ERROR]', error);
    res.send('fail');
  }
});

export default router;
