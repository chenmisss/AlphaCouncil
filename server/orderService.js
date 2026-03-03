/**
 * 订单服务 - 使用 JSON 文件存储
 * 简化版实现，不需要数据库
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORDERS_PATH = path.join(__dirname, 'orders_data.json');

// 订单状态
export const OrderStatus = {
  PENDING: 'PENDING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
};

/**
 * 读取所有订单
 */
function loadOrders() {
  try {
    if (fs.existsSync(ORDERS_PATH)) {
      const data = fs.readFileSync(ORDERS_PATH, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('[OrderService] 读取订单数据失败:', err.message);
  }
  return {};
}

/**
 * 保存所有订单
 */
function saveOrders(orders) {
  try {
    fs.writeFileSync(ORDERS_PATH, JSON.stringify(orders, null, 2));
  } catch (err) {
    console.error('[OrderService] 保存订单数据失败:', err.message);
  }
}

/**
 * 生成订单号
 */
export function generateOrderId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `AC_${timestamp}_${random}`;
}

/**
 * 创建订单
 */
export function createOrder(params) {
  const { orderId, fingerprint, stockSymbol, amount, analysisData } = params;

  const orders = loadOrders();

  orders[orderId] = {
    orderId,
    fingerprint,
    stockSymbol,
    amount,
    status: OrderStatus.PENDING,
    analysisData, // 第一阶段分析结果缓存
    createdAt: new Date().toISOString(),
    paidAt: null,
    tradeNo: null,
  };

  saveOrders(orders);
  console.log(`[OrderService] 订单创建成功: ${orderId}`);
  return orders[orderId];
}

/**
 * 获取订单
 */
export function getOrder(orderId) {
  const orders = loadOrders();
  return orders[orderId] || null;
}

/**
 * 更新订单状态为已支付
 */
export function completeOrder(orderId, tradeNo) {
  const orders = loadOrders();

  if (!orders[orderId]) {
    console.error(`[OrderService] 订单不存在: ${orderId}`);
    return { success: false, message: '订单不存在' };
  }

  if (orders[orderId].status === OrderStatus.SUCCESS) {
    console.log(`[OrderService] 订单已处理过: ${orderId}`);
    return { success: false, message: '订单已处理' };
  }

  orders[orderId].status = OrderStatus.SUCCESS;
  orders[orderId].paidAt = new Date().toISOString();
  orders[orderId].tradeNo = tradeNo;

  saveOrders(orders);
  console.log(`[OrderService] 订单支付完成: ${orderId}`);
  return { success: true, order: orders[orderId] };
}

/**
 * 根据指纹获取用户最近的有效订单（用于 PC 端支付后恢复）
 */
export function getLatestPaidOrderByFingerprint(fingerprint) {
  const orders = loadOrders();

  // 找到该用户最近已支付的订单
  const userOrders = Object.values(orders)
    .filter(order => order.fingerprint === fingerprint && order.status === OrderStatus.SUCCESS)
    .sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt));

  return userOrders[0] || null;
}

/**
 * 清理过期订单（7天前的待支付订单）
 */
export function cleanupExpiredOrders() {
  const orders = loadOrders();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  let cleaned = 0;
  for (const [orderId, order] of Object.entries(orders)) {
    if (order.status === OrderStatus.PENDING && new Date(order.createdAt) < sevenDaysAgo) {
      orders[orderId].status = OrderStatus.EXPIRED;
      cleaned++;
    }
  }

  if (cleaned > 0) {
    saveOrders(orders);
    console.log(`[OrderService] 清理了 ${cleaned} 个过期订单`);
  }
}

// 每天清理一次过期订单
setInterval(cleanupExpiredOrders, 24 * 60 * 60 * 1000);

// 启动时清理一次
cleanupExpiredOrders();

console.log(`[OrderService] JSON 文件存储已初始化: ${ORDERS_PATH}`);
