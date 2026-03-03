# AlphaCouncil 支付逻辑文档

## 📊 业务模式概览

### 免费 vs 付费

| 内容 | 免费 | 付费 (¥9.9) |
|------|------|-------------|
| 第一阶段：6位分析师 | ✅ | ✅ |
| 第二阶段：2位总监整合 | ❌ | ✅ |
| 第三阶段：3位评估专家 | ❌ | ✅ |
| 第四阶段：总经理决策 | ❌ | ✅ |
| 买入点位/止损建议 | ❌ | ✅ |

---

## 🔄 支付流程图

```
用户输入股票代码
    ↓
启动分析（免费）
    ↓
第一阶段：6位分析师并行分析
    ↓
第一阶段完成 → 暂停
    ↓
显示付费按钮 "解锁完整报告 ¥9.9"
    ↓
用户点击付费 → 弹出付费对话框
    ↓
付费成功 → setIsPremiumUnlocked(true)
    ↓
自动继续执行 第二/三/四阶段
    ↓
分析完成，显示完整报告
    ↓
用户点击"重新分析" → 付费状态重置
```

---

## 💻 核心代码逻辑

### 1. 状态定义

文件: `App.tsx` (第30-37行)

```typescript
// 付费状态（每次分析需重新付费）
const [showPaymentDialog, setShowPaymentDialog] = useState(false);
const [isPremiumUnlocked, setIsPremiumUnlocked] = useState<boolean>(false);

// 定价
const PREMIUM_PRICE = 9.9;
```

### 2. 分析流程暂停点

文件: `App.tsx` (第364-374行)

```typescript
// 第一阶段完成后检查付费状态
if (!isPremiumUnlocked) {
  setState(prev => ({
    ...prev,
    status: AnalysisStatus.COMPLETED,
    currentStep: 2, // 停在第一阶段完成
  }));
  // 不自动弹窗，等用户点击按钮
  return;
}
```

### 3. 付费处理函数

文件: `App.tsx` (第72-82行)

```typescript
const handlePremiumUnlock = async () => {
  // 设置付费状态（仅本次有效，不保存到localStorage）
  setIsPremiumUnlocked(true);
  setShowPaymentDialog(false);

  // 自动继续分析
  if (state.stockSymbol && state.currentStep === 2 && state.status === AnalysisStatus.COMPLETED) {
    await continueAnalysisAfterUnlock();
  }
};
```

### 4. 解锁后继续分析

文件: `App.tsx` (第84-131行)

```typescript
const continueAnalysisAfterUnlock = async () => {
  // 继续执行 第二阶段（总监）
  const managerResults = await runManagersStage(...);
  
  // 继续执行 第三阶段（风控+机会）
  const riskResults = await runRiskStage(...);
  
  // 继续执行 第四阶段（总经理）
  const gmResult = await runGMStage(...);
};
```

### 5. 重置付费状态

文件: `App.tsx` (第415-425行)

```typescript
const reset = () => {
  setState(prev => ({
    ...initialState,
    agentConfigs: prev.agentConfigs,
    apiKeys: prev.apiKeys
  }));
  // 每次分析需重新付费
  setIsPremiumUnlocked(false);
};
```

---

## 🎨 付费对话框 UI

文件: `App.tsx` (第475-533行)

### 显示条件
```typescript
{showPaymentDialog && state.status === AnalysisStatus.COMPLETED && (...)}
```

### 对话框内容
- 💎 标题："解锁完整分析报告"
- 价值说明：第二/三/四阶段内容
- 定价：原价 ¥29.9，现价 ¥9.9
- 按钮：
  - "🔓 立即解锁（演示）" → `handlePremiumUnlock()`
  - "稍后再说" → 关闭对话框

---

## 🔐 锁定状态传递

付费状态通过 `isLocked` 属性传递给 AgentCard 组件：

```typescript
<AgentCard
  config={state.agentConfigs[AgentRole.MANAGER_FUNDAMENTAL]}
  output={state.outputs[AgentRole.MANAGER_FUNDAMENTAL]}
  isLocked={!isPremiumUnlocked}  // 未付费时锁定
  isLoading={isStepLoading(2)}
/>
```

**AgentCard 中的锁定效果**（已移除毛玻璃）：
- 显示专家信息和模型介绍
- 不运行分析
- 显示"等待数据..."

---

## 💰 接入真实支付

### 当前状态：演示模式

目前点击"立即解锁"直接调用 `handlePremiumUnlock()`，无真实支付。

### 接入微信/支付宝

#### Step 1: 后端创建支付订单

```javascript
// server/payment.js
app.post('/api/payment/create', async (req, res) => {
  const { stockSymbol, fingerprint } = req.body;
  
  // 调用微信/支付宝 API 创建订单
  const order = await createWechatPayOrder({
    amount: 9.9,
    description: `AlphaCouncil分析-${stockSymbol}`,
    outTradeNo: generateOrderId()
  });
  
  res.json({
    success: true,
    payUrl: order.code_url,  // 二维码链接
    orderId: order.out_trade_no
  });
});
```

#### Step 2: 前端显示支付二维码

```typescript
const handleRealPayment = async () => {
  // 1. 创建订单
  const response = await fetch('/api/payment/create', {
    method: 'POST',
    body: JSON.stringify({ stockSymbol: state.stockSymbol })
  });
  const { payUrl, orderId } = await response.json();
  
  // 2. 显示二维码
  showQRCode(payUrl);
  
  // 3. 轮询订单状态
  pollOrderStatus(orderId);
};

const pollOrderStatus = (orderId: string) => {
  const interval = setInterval(async () => {
    const res = await fetch(`/api/payment/status/${orderId}`);
    const { paid } = await res.json();
    
    if (paid) {
      clearInterval(interval);
      handlePremiumUnlock();  // 解锁
    }
  }, 2000);
};
```

#### Step 3: 支付回调验证

```javascript
// server/payment.js
app.post('/api/payment/notify', async (req, res) => {
  // 验证签名
  if (!verifyWechatSign(req.body)) {
    return res.status(400).send('FAIL');
  }
  
  // 更新订单状态
  await db.updateOrder(req.body.out_trade_no, { paid: true });
  
  res.send('SUCCESS');
});
```

---

## 📊 全网使用限制

### 服务器端配额

文件: `server/rateLimiter.js`

```javascript
const DAILY_LIMIT = 100; // 每日全网限制100次

export function checkRateLimit() {
  const currentUsage = getTodayUsage();
  return {
    allowed: currentUsage < DAILY_LIMIT,
    remaining: Math.max(0, DAILY_LIMIT - currentUsage),
    used: currentUsage,
    limit: DAILY_LIMIT
  };
}
```

### 数据持久化

使用 JSON 文件存储：`server/usage_data.json`

```json
{
  "2026-01-13": 42
}
```

---

## 🎯 关键设计决策

1. **每次分析独立付费**：`isPremiumUnlocked` 不保存到 localStorage
2. **免费内容有价值**：第一阶段6位分析师完整展示
3. **付费门槛在关键节点**：决策阶段需付费
4. **演示友好**：当前无真实支付，便于展示
5. **全网限流**：每日100次，避免滥用

---

## 📞 待开发事项

- [ ] 接入微信支付
- [ ] 接入支付宝支付
- [ ] 订单管理后台
- [ ] 退款机制
- [ ] VIP 会员制度（月卡/年卡）
