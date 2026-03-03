/**
 * 支付宝支付服务（官方 SDK）
 * 与 prod-new 共用同一套证书
 */

import AlipaySdk from 'alipay-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 获取支付宝配置
const getAlipayConfig = () => {
  return {
    appId: process.env.ALIPAY_APP_ID || '',
    privateKey: process.env.ALIPAY_PRIVATE_KEY || '',
    gateway: process.env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do',
    notifyUrl: process.env.ALIPAY_NOTIFY_URL || '',
    appCertPath: process.env.ALIPAY_APP_CERT_PATH,
    alipayCertPath: process.env.ALIPAY_ALIPAY_CERT_PATH,
    rootCertPath: process.env.ALIPAY_ROOT_CERT_PATH,
  };
};

// 初始化支付宝 SDK
const initAlipaySDK = () => {
  const config = getAlipayConfig();

  const sdkConfig = {
    appId: config.appId,
    privateKey: config.privateKey,
    gateway: config.gateway,
  };

  // 如果使用证书模式
  if (config.appCertPath && config.alipayCertPath && config.rootCertPath) {
    try {
      sdkConfig.appCertContent = fs.readFileSync(path.resolve(config.appCertPath), 'utf-8');
      sdkConfig.alipayPublicCertContent = fs.readFileSync(path.resolve(config.alipayCertPath), 'utf-8');
      sdkConfig.alipayRootCertContent = fs.readFileSync(path.resolve(config.rootCertPath), 'utf-8');
      console.log('[ALIPAY] Using certificate mode');
    } catch (error) {
      console.error('[ALIPAY] Failed to load certificates:', error);
      throw new Error('Failed to load Alipay certificates');
    }
  } else {
    console.log('[ALIPAY] Using public key mode');
  }

  return new AlipaySdk(sdkConfig);
};

/**
 * 创建支付宝当面付订单（扫码支付，页面轮询，移动端/PC端通用）
 */
export const createAlipayQROrder = async (params) => {
  const alipaySdk = initAlipaySDK();
  const config = getAlipayConfig();

  try {
    const result = await alipaySdk.exec('alipay.trade.precreate', {
      bizContent: {
        out_trade_no: params.orderId,
        total_amount: (params.amount / 100).toFixed(2), // 分转元
        subject: params.subject,
      },
      notify_url: config.notifyUrl,
    });

    console.log('[ALIPAY] QR order created:', params.orderId);
    console.log('[ALIPAY] QR order result:', JSON.stringify(result, null, 2));

    if (result.code === '10000' && result.qrCode) {
      return {
        success: true,
        qrCode: result.qrCode,
      };
    } else {
      return {
        success: false,
        error: result.msg || result.subMsg || '创建二维码失败',
      };
    }
  } catch (error) {
    console.error('[ALIPAY] Create QR order failed:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * 创建支付宝 PC 支付订单（跳转支付页）
 */
export const createAlipayPCOrder = async (params) => {
  const alipaySdk = initAlipaySDK();
  const config = getAlipayConfig();

  try {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const returnUrl = params.returnUrl || `${baseUrl}/AlphaCouncil/?paymentSuccess=true&orderId=${params.orderId}`;

    const result = await alipaySdk.pageExec('alipay.trade.page.pay', {
      method: 'GET',
      bizContent: {
        out_trade_no: params.orderId,
        total_amount: (params.amount / 100).toFixed(2), // 分转元
        subject: params.subject,
        product_code: 'FAST_INSTANT_TRADE_PAY',
      },
      notify_url: config.notifyUrl,
      return_url: returnUrl,
    });

    console.log('[ALIPAY] PC order created:', params.orderId);
    return {
      success: true,
      payUrl: result,
    };
  } catch (error) {
    console.error('[ALIPAY] Create PC order failed:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * 创建支付宝 H5 支付订单（移动端跳转）
 */
export const createAlipayH5Order = async (params) => {
  const alipaySdk = initAlipaySDK();
  const config = getAlipayConfig();

  try {
    // 构建请求参数
    const requestParams = {
      method: 'GET',
      bizContent: {
        out_trade_no: params.orderId,
        total_amount: (params.amount / 100).toFixed(2), // 分转元
        subject: params.subject,
        product_code: 'QUICK_WAP_WAY',
      },
      notify_url: config.notifyUrl,
    };

    // 只有不需要返回跳转时才不设置 return_url
    // 支付完成后用户留在支付宝，手动返回原页面
    if (!params.noReturn) {
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      requestParams.return_url = params.returnUrl || `${baseUrl}/AlphaCouncil/?paymentSuccess=true&orderId=${params.orderId}`;
    }

    const result = await alipaySdk.pageExec('alipay.trade.wap.pay', requestParams);

    console.log('[ALIPAY] H5 order created:', params.orderId, params.noReturn ? '(no return)' : '(with return)');

    // 使用 alipays:// 协议包装，可以直接调起支付宝 APP
    const alipaySchemeUrl = `alipays://platformapi/startapp?appId=20000067&url=${encodeURIComponent(result)}`;

    return {
      success: true,
      payUrl: alipaySchemeUrl, // 直接调起支付宝 APP
      originalUrl: result,    // 保留原始 URL 作为降级方案
    };
  } catch (error) {
    console.error('[ALIPAY] Create H5 order failed:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * 查询支付宝订单状态
 */
export const queryAlipayOrder = async (orderId) => {
  const alipaySdk = initAlipaySDK();

  try {
    const result = await alipaySdk.exec('alipay.trade.query', {
      bizContent: {
        out_trade_no: orderId,
      },
    });

    console.log('[ALIPAY] Query order result:', result);
    return {
      success: true,
      tradeStatus: result.tradeStatus,
      tradeNo: result.tradeNo,
      totalAmount: result.totalAmount,
    };
  } catch (error) {
    console.error('[ALIPAY] Query order failed:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * 验证支付宝回调签名
 */
export const verifyAlipayNotify = (params) => {
  const alipaySdk = initAlipaySDK();

  try {
    const verified = alipaySdk.checkNotifySign(params);
    console.log('[ALIPAY] Notify signature verified:', verified);
    return verified;
  } catch (error) {
    console.error('[ALIPAY] Verify notify signature failed:', error);
    return false;
  }
};
