# 支付宝支付功能集成文档

## 概述
AlphaCouncil 项目集成了支付宝支付功能，支持移动端和 PC 端两种支付流程。

## 架构设计

### 移动端流程
1. 用户完成第一阶段分析
2. 点击支付按钮 → 直接调用 `handlePremiumUnlock()`（不显示弹窗）
3. 后端生成 H5 支付单，返回 `alipays://` scheme 链接
4. 前端 `window.location.href` 跳转拉起支付宝 APP
5. 用户在支付宝 APP 中完成支付
6. 支付完成后，支付宝返回到原页面（通过 return_url）
7. 前端轮询 `/api/pay/status` 确认支付状态
8. 支付成功后恢复缓存数据，继续第二、三阶段分析

### PC 端流程
1. 用户完成第一阶段分析
2. 点击支付按钮 → 显示支付方式选择弹窗
3. 用户选择支付宝支付
4. 后端生成 PC 网页支付单，返回支付页面 HTML
5. 前端新窗口打开支付页面
6. 用户在支付宝网页中完成支付
7. 支付完成后，支付宝重定向回主页面（通过 return_url，带上 orderId）
8. 前端从 URL 中取得 orderId，轮询 `/api/pay/status` 从缓存恢复分析数据
9. 支付成功后继续第二、三阶段分析

## 技术实现

### 后端修改

#### 1. `server/alipayService.js` - 支付宝 SDK 服务
支付宝 SDK 初始化使用**证书模式**，与 prod-new 共用同一套证书。

**关键函数：**
- `createAlipayQROrder()` - 当面付（扫码支付）
- `createAlipayH5Order()` - H5 支付（移动端，返回 `alipays://` scheme）
- `createAlipayH5Order()` 的关键逻辑：
  ```javascript
  // 使用 alipays:// 协议包装，可以直接调起支付宝 APP
  const alipaySchemeUrl = `alipays://platformapi/startapp?appId=20000067&url=${encodeURIComponent(result)}`;
  return {
    success: true,
    payUrl: alipaySchemeUrl, // 直接调起支付宝 APP
    originalUrl: result,    // 保留原始 URL 作为降级方案
  };
  ```
- `createAlipayPCOrder()` - PC 网页支付
- `queryAlipayOrder()` - 查询订单状态
- `verifyAlipayNotify()` - 验证异步回调签名

#### 2. `server/orderService.js` - 订单管理
使用 JSON 文件存储订单数据（`orders_data.json`），不需要数据库。

**关键字段：**
- `orderId` - 订单号
- `fingerprint` - 浏览器指纹（用户标识）
- `stockSymbol` - 股票代码
- `amount` - 金额（单位：分）
- `status` - 订单状态（PENDING/SUCCESS/FAILED/EXPIRED）
- `analysisData` - 第一阶段分析结果（用于 PC 端支付后恢复）
- `tradeNo` - 支付宝交易号
- `paidAt` - 支付完成时间

**关键函数：**
- `generateOrderId()` - 生成唯一订单号
- `createOrder()` - 创建订单
- `getLatestPaidOrderByFingerprint()` - 获取指纹对应的最新成功订单

#### 3. `server/paymentRoutes.js` - 支付 API

**核心端点：**

| 端点 | 方法 | 说明 |
|-----|------|------|
| `/api/pay/create` | POST | 创建支付订单 |
| `/api/pay/status` | GET | 查询订单状态（前端轮询用） |
| `/api/pay/restore` | GET | 恢复支付后的分析数据（PC 端用） |
| `/api/pay/alipay/notify` | POST | 支付宝异步回调 |

**关键逻辑：**
- 防重复请求：3 秒冷却期
- 移动端判断：通过 `isMobile` 参数决定使用 H5 支付
- 缓存第一阶段分析数据在订单中
- 查询订单时主动查一次支付宝，确保状态准确

### 前端修改

#### 1. `App.tsx` - 支付流程集成

**支付按钮逻辑：**
```typescript
if (isMobile) {
  // 移动端：直接发起支付，跳转拉起支付宝
  handlePremiumUnlock();
} else {
  // PC端：显示支付方式选择弹窗
  setShowPaymentDialog(true);
}
```

**移动端跳转逻辑：**
```typescript
// 开始轮询
startPaymentPolling(data.orderId);
// 延迟跳转，确保轮询已启动
setTimeout(() => {
  window.location.href = data.payUrl; // alipays:// 链接
}, 300);
```

**关键缓存恢复逻辑（PC 端）：**
- URL 参数中有 `paymentSuccess=true&orderId=xxx`
- 从 localStorage 中取出 `alphacouncil_pending_payment`
- 调用 `/api/pay/restore` 恢复分析数据
- 继续第二、三阶段分析

#### 2. `services/fingerprint.ts` - 浏览器指纹
生成基于 UA、语言、屏幕、时区等信息的 SHA-256 指纹，用于用户标识。

### 证书配置

从 `prod-new` 复制的证书文件（位于 `certs/` 目录）：
- `appCertPublicKey_your_alipay_app_id.crt`
- `alipayCertPublicKey_RSA2.crt`
- `alipayRootCert.crt`

在 `.env` 中配置证书路径和私钥：
```
ALIPAY_APP_ID=your_alipay_app_id
ALIPAY_PRIVATE_KEY=your_alipay_private_key_here
ALIPAY_APP_CERT_PATH=./certs/appCertPublicKey_your_alipay_app_id.crt
ALIPAY_ALIPAY_CERT_PATH=./certs/alipayCertPublicKey_RSA2.crt
ALIPAY_ROOT_CERT_PATH=./certs/alipayRootCert.crt
ALIPAY_NOTIFY_URL=http://localhost:3001/AlphaCouncil/api/pay/alipay/notify
BASE_URL=http://localhost:3000
```

## 本地测试

1. 启动开发服务器：`npm run server`
2. 修改金额为 0.01 元测试：`server/paymentRoutes.js` 中 `PRODUCT_PRICE = 1`
3. **移动端测试**：
   - 真机访问：`http://192.168.x.x:3001/AlphaCouncil/`
   - 或浏览器模拟：F12 → 设备模拟 → 选择手机型号
4. **PC 端测试**：直接访问本地 URL
5. 测试完成后改回金额：`PRODUCT_PRICE = 990`

## 生产部署

1. 更新 `.env` 中的 `ALIPAY_NOTIFY_URL` 为生产域名
2. 确保生产服务器能接收支付宝回调（需要公网 IP）
3. 订单数据存储在 JSON 文件中，需要定期备份
4. 可选：迁移到数据库以支持更大规模部署

