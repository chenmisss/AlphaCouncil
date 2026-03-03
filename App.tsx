import React, { useState, useEffect } from 'react';
import { AgentRole, AnalysisStatus, WorkflowState, AgentConfig, ApiKeys } from './types';
import { runAnalystsStage, runManagersStage, runRiskStage, runGMStage } from './services/geminiService';
import { fetchStockData, formatStockDataForPrompt, fetchCapitalFlowData, formatCapitalFlowForPrompt, fetchNorthboundData, formatNorthboundForPrompt, fetchKLineData, formatKLineForPrompt, fetchFundamentalData, formatFundamentalForPrompt } from './services/juheService';

import StockInput from './components/StockInput';
import AgentCard from './components/AgentCard';
import { DEFAULT_AGENTS } from './constants';
import { LayoutDashboard, BrainCircuit, ShieldCheck, Gavel, RefreshCw, AlertTriangle, Settings2, Database } from 'lucide-react';

// 初始状态定义
const initialState: WorkflowState = {
  status: AnalysisStatus.IDLE,
  currentStep: 0,
  stockSymbol: '',
  stockDataContext: '',
  outputs: {},
  agentConfigs: JSON.parse(JSON.stringify(DEFAULT_AGENTS)), // 深拷贝默认配置
  apiKeys: {}
};

const App: React.FC = () => {
  const [state, setState] = useState<WorkflowState>(initialState);

  // useRef to always have the latest state in async callbacks
  const stateRef = React.useRef(state);
  React.useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // API 使用次数限制功能
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');

  // 💎 付费解锁功能（每次分析需要重新付费）
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [isPremiumUnlocked, setIsPremiumUnlocked] = useState<boolean>(false); // 每次分析需重新付费
  const [paymentOrderId, setPaymentOrderId] = useState<string | null>(null);
  const [paymentQrCode, setPaymentQrCode] = useState<string | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentPolling, setPaymentPolling] = useState(false);

  // 检查是否已解锁或超过限制
  const API_LIMIT = 1; // 第二次使用就需要密码
  const UNLOCK_PASSWORD = 'alphacouncil'; // 修改为你自己的密码
  const PREMIUM_PRICE = 8.8; // 产品价格

  // 设备检测
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  // 微信浏览器检测
  const isWeChatBrowser = /MicroMessenger/i.test(navigator.userAgent);
  const [showWeChatPrompt, setShowWeChatPrompt] = useState(isWeChatBrowser);

  const getApiUsageCount = (): number => {
    const today = new Date().toISOString().split('T')[0];
    const stored = localStorage.getItem('alphacouncil_api_usage');
    if (stored) {
      const data = JSON.parse(stored);
      if (data.date === today) {
        return data.count;
      }
    }
    return 0;
  };

  const incrementApiUsage = () => {
    const today = new Date().toISOString().split('T')[0];
    const count = getApiUsageCount() + 1;
    localStorage.setItem('alphacouncil_api_usage', JSON.stringify({ date: today, count }));
  };

  const isUnlocked = (): boolean => {
    return localStorage.getItem('alphacouncil_unlocked') === 'true';
  };

  const handlePasswordSubmit = () => {
    if (passwordInput === UNLOCK_PASSWORD) {
      localStorage.setItem('alphacouncil_unlocked', 'true');
      setShowPasswordDialog(false);
      setPasswordInput('');
      setPasswordError('');
    } else {
      setPasswordError('密码错误');
    }
  };

  // 💎 处理付费解锁 - 创建支付订单
  const handlePremiumUnlock = async () => {
    setPaymentLoading(true);
    try {
      // 获取浏览器指纹
      const { generateFingerprint } = await import('./services/fingerprint');
      const fingerprint = await generateFingerprint();

      // 缓存第一阶段分析数据
      const analysisData = {
        stockSymbol: state.stockSymbol,
        stockDataContext: state.stockDataContext,
        outputs: state.outputs,
        agentConfigs: state.agentConfigs,
        apiKeys: state.apiKeys,
      };

      // 创建支付订单
      const response = await fetch(`${window.location.origin}/AlphaCouncil/api/pay/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fingerprint,
          stockSymbol: state.stockSymbol,
          analysisData,
          isMobile,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '创建订单失败');
      }

      setPaymentOrderId(data.orderId);

      if (isMobile && data.payUrl) {
        // 移动端：跳转拉起支付宝 APP
        // 支付完成后用户手动返回，页面持续轮询检测支付状态
        startPaymentPolling(data.orderId);
        // 延迟跳转，确保轮询已启动
        setTimeout(() => {
          window.location.href = data.payUrl;
        }, 300);
      } else if (data.qrCode) {
        // PC端：显示二维码，用户用手机扫码支付
        setPaymentQrCode(data.qrCode);
        startPaymentPolling(data.orderId);
      } else {
        throw new Error('未获取到支付信息');
      }
    } catch (error) {
      console.error('创建支付订单失败:', error);
      alert(error instanceof Error ? error.message : '创建订单失败');
    } finally {
      setPaymentLoading(false);
    }
  };

  // 轮询支付状态
  const startPaymentPolling = (orderId: string) => {
    setPaymentPolling(true);
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`${window.location.origin}/AlphaCouncil/api/pay/status?orderId=${orderId}`);
        const data = await response.json();

        if (data.status === 'SUCCESS') {
          clearInterval(pollInterval);
          setPaymentPolling(false);
          setShowPaymentDialog(false);
          setPaymentOrderId(null);
          setPaymentQrCode(null);
          setIsPremiumUnlocked(true);

          // 先读取缓存判断场景，再清除
          const pendingPayment = localStorage.getItem('alphacouncil_pending_payment');
          localStorage.removeItem('alphacouncil_pending_payment');

          // 💎 根据场景决定后续动作
          if (pendingPayment) {
            const pendingData = JSON.parse(pendingPayment);
            if (pendingData.type === 'QUOTA_UNLOCK') {
              // 限流场景：需要从头开始分析（Stage 1 尚未执行）
              console.log('[Payment] QUOTA_UNLOCK: Restarting full analysis for:', pendingData.stockSymbol);
              await handleAnalyze(pendingData.stockSymbol, state.apiKeys);
              return; // 提前返回，不执行下面的 continueAnalysisAfterUnlock
            }
          }

          // 常规场景：Stage 1 已完成，继续执行 Stage 2+
          await continueAnalysisAfterUnlock();
        }
      } catch (error) {
        console.error('查询支付状态失败:', error);
      }
    }, 2000);

    // 5分钟超时
    setTimeout(() => {
      clearInterval(pollInterval);
      setPaymentPolling(false);
    }, 300000);
  };

  // 手动查询支付状态
  const manualCheckPayment = async () => {
    if (!paymentOrderId) return;
    setPaymentLoading(true);
    try {
      const response = await fetch(`${window.location.origin}/AlphaCouncil/api/pay/status?orderId=${paymentOrderId}`);
      const data = await response.json();

      if (data.status === 'SUCCESS') {
        setShowPaymentDialog(false);
        setPaymentOrderId(null);
        setPaymentQrCode(null);
        setIsPremiumUnlocked(true);

        // 先读取缓存判断场景，再清除
        const pendingPayment = localStorage.getItem('alphacouncil_pending_payment');
        localStorage.removeItem('alphacouncil_pending_payment');

        // 💎 根据场景决定后续动作
        if (pendingPayment) {
          const pendingData = JSON.parse(pendingPayment);
          if (pendingData.type === 'QUOTA_UNLOCK') {
            // 限流场景：需要从头开始分析（Stage 1 尚未执行）
            console.log('[Payment] Manual check - QUOTA_UNLOCK: Restarting full analysis');
            await handleAnalyze(pendingData.stockSymbol, state.apiKeys);
            return;
          }
        }

        // 常规场景：Stage 1 已完成，继续执行 Stage 2+
        await continueAnalysisAfterUnlock();
      } else {
        alert('订单尚未支付，请完成支付后再试');
      }
    } catch (error) {
      alert('查询失败，请稍后重试');
    } finally {
      setPaymentLoading(false);
    }
  };

  // PC 端支付跳转回来后恢复
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const paymentSuccess = urlParams.get('paymentSuccess');
    const orderId = urlParams.get('orderId');

    if (paymentSuccess === 'true' && orderId) {
      // 清除 URL 参数
      window.history.replaceState({}, '', window.location.pathname);

      // 检查是否是弹出窗口（window.opener 存在表示是从其他页面打开的）
      if (window.opener && !window.opener.closed) {
        // 通知原始窗口支付成功
        try {
          window.opener.postMessage({ type: 'PAYMENT_SUCCESS', orderId }, '*');
        } catch (e) {
          // 跨域可能失败，忽略
        }

        // 显示成功消息并提示关闭
        document.body.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:white;font-family:system-ui;">
            <div style="font-size:64px;margin-bottom:20px;">✅</div>
            <h1 style="font-size:24px;margin-bottom:12px;">支付成功！</h1>
            <p style="color:#94a3b8;margin-bottom:20px;">请关闭此窗口，返回原页面继续分析</p>
            <button onclick="window.close()" style="padding:12px 24px;background:#3b82f6;color:white;border:none;border-radius:8px;font-size:16px;cursor:pointer;">关闭此窗口</button>
          </div>
        `;

        // 尝试自动关闭（某些浏览器可能不允许）
        setTimeout(() => {
          try { window.close(); } catch (e) { }
        }, 3000);
        return;
      }

      // 如果不是弹出窗口，正常恢复流程
      const pendingPayment = localStorage.getItem('alphacouncil_pending_payment');
      if (pendingPayment) {
        const pendingPaymentData = JSON.parse(pendingPayment);
        localStorage.removeItem('alphacouncil_pending_payment');

        // 恢复状态或重新开始
        if (pendingPaymentData.type === 'QUOTA_UNLOCK') {
          // 这种情况是“先付费后使用”，需要重新触发分析
          console.log('[Payment] Quota unlock successful, restarting analysis for:', pendingPaymentData.stockSymbol);
          setIsPremiumUnlocked(true);
          // 延迟一点时间让状态更新
          setTimeout(() => {
            handleAnalyze(pendingPaymentData.stockSymbol, state.apiKeys);
          }, 500);
        } else {
          // 这种情况是“先使用后付费”（常规流程），恢复之前的分析结果
          const { analysisData } = pendingPaymentData;
          setState(prev => ({
            ...prev,
            stockSymbol: analysisData.stockSymbol,
            stockDataContext: analysisData.stockDataContext,
            outputs: analysisData.outputs,
            agentConfigs: analysisData.agentConfigs,
            apiKeys: analysisData.apiKeys,
            status: AnalysisStatus.COMPLETED,
            currentStep: 2,
          }));
          setIsPremiumUnlocked(true);
          // 延迟执行继续分析
          setTimeout(() => continueAnalysisAfterUnlock(), 500);
        }

        // 查询订单状态确认支付成功 (二次校验)
        fetch(`${window.location.origin}/AlphaCouncil/api/pay/status?orderId=${orderId}`)
          .then(res => res.json())
          .then(data => {
            if (data.status === 'SUCCESS') {
              // 状态已通过前端逻辑设置，此处可仅记录日志或做额外校验
              console.log('[Payment] Server confirmed order success:', orderId);
            }
          });
      }
    }
  }, []);

  // 监听来自支付窗口的消息
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'PAYMENT_SUCCESS' && event.data?.orderId) {
        console.log('[Payment] Received success message from popup:', event.data.orderId);
        // 支付成功，触发继续分析
        setShowPaymentDialog(false);
        setPaymentOrderId(null);
        setPaymentQrCode(null);
        setPaymentPolling(false);
        setIsPremiumUnlocked(true);
        localStorage.removeItem('alphacouncil_pending_payment');
        continueAnalysisAfterUnlock();
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [state.stockSymbol, state.stockDataContext, state.outputs, state.agentConfigs, state.apiKeys]);

  // 🚀 解锁后继续分析
  const continueAnalysisAfterUnlock = async () => {
    // 使用 stateRef 获取最新状态，避免闭包陷阱
    const currentState = stateRef.current;
    const symbol = currentState.stockSymbol;
    const apiKeys = currentState.apiKeys;
    const stockDataContext = currentState.stockDataContext;
    const outputs = currentState.outputs;
    const agentConfigs = currentState.agentConfigs;

    console.log('[continueAnalysisAfterUnlock] Starting with symbol:', symbol, 'outputs:', Object.keys(outputs));

    try {
      setState(prev => ({
        ...prev,
        status: AnalysisStatus.RUNNING,
        currentStep: 2,
      }));

      // 步骤 2: 2位总监整合报告 (Managers)
      const managerResults = await runManagersStage(symbol, outputs, agentConfigs, apiKeys, stockDataContext);
      setState(prev => ({
        ...prev,
        currentStep: 3,
        outputs: { ...prev.outputs, ...managerResults }
      }));

      // 步骤 3: 风控团队评估 (Risk)
      const outputsAfterStep2 = { ...outputs, ...managerResults };
      const riskResults = await runRiskStage(symbol, outputsAfterStep2, agentConfigs, apiKeys, stockDataContext);
      setState(prev => ({
        ...prev,
        currentStep: 4,
        outputs: { ...prev.outputs, ...riskResults }
      }));

      // 步骤 4: 总经理最终决策 (GM)
      const outputsAfterStep3 = { ...outputsAfterStep2, ...riskResults };
      const gmResult = await runGMStage(symbol, outputsAfterStep3, agentConfigs, apiKeys, stockDataContext);

      setState(prev => ({
        ...prev,
        status: AnalysisStatus.COMPLETED,
        currentStep: 5,
        outputs: { ...prev.outputs, ...gmResult }
      }));
    } catch (error) {
      console.error("继续分析失败", error);
      setState(prev => ({
        ...prev,
        status: AnalysisStatus.ERROR,
        error: error instanceof Error ? error.message : "发生未知错误"
      }));
    }
  };

  // 服务器端 API 使用次数（聚合 API）
  const [serverApiUsage, setServerApiUsage] = useState<number>(0);

  // 获取服务器端 API 使用状态（使用专门的状态端点，不消耗配额）
  const fetchServerApiUsage = async () => {
    try {
      const response = await fetch(`${window.location.origin}/AlphaCouncil/api/stock/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: 'status' })
      });
      const data = await response.json();
      if (data.success && data.totalUsed !== undefined) {
        setServerApiUsage(data.totalUsed);
        // 直接更新 DOM
        const countEl = document.getElementById('api-usage-count');
        if (countEl) {
          countEl.textContent = String(data.totalUsed);
        }
      }
    } catch {
      // 忽略错误
    }
  };

  // 页面加载时获取使用状态（只执行一次）
  useEffect(() => {
    fetchServerApiUsage();
  }, []);

  // 处理空闲状态下的配置修改（温度、模型等）
  const handleConfigChange = (role: AgentRole, newConfig: AgentConfig) => {
    setState(prev => ({
      ...prev,
      agentConfigs: {
        ...prev.agentConfigs,
        [role]: newConfig
      }
    }));
  };

  // 验证股票代码是否为沪深股市代码
  const validateStockCode = (symbol: string): { valid: boolean; message?: string } => {
    const code = symbol.trim().toLowerCase();

    // 带前缀的验证
    if (code.startsWith('sh') || code.startsWith('sz')) {
      const num = code.substring(2);
      if (!/^\d{6}$/.test(num)) {
        return { valid: false, message: '股票代码格式错误，应为6位数字（如: sh600519, sz000001）' };
      }
      return { valid: true };
    }

    // 不带前缀的验证
    if (!/^\d{6}$/.test(code)) {
      return { valid: false, message: '股票代码应为6位数字（如: 600519, 000001, 300750）' };
    }

    // 验证沪深市场代码规则
    const firstDigit = code.charAt(0);
    if (!['0', '1', '2', '3', '6', '8', '9'].includes(firstDigit)) {
      return { valid: false, message: '不是有效的沪深股市代码（沪市以6/9开头，深市以0/2/3开头）' };
    }

    return { valid: true };
  };

  // 主分析流程触发函数
  const handleAnalyze = async (symbol: string, apiKeys: ApiKeys) => {
    // 💎 每次新分析重置付费状态（每次分析需单独付费）
    setIsPremiumUnlocked(false);

    // 1. 验证股票代码
    const validation = validateStockCode(symbol);
    if (!validation.valid) {
      setState(prev => ({
        ...prev,
        status: AnalysisStatus.ERROR,
        error: validation.message
      }));
      return;
    }

    // 2. 初始化状态
    setState(prev => ({
      ...prev,
      status: AnalysisStatus.FETCHING_DATA,
      currentStep: 0,
      stockSymbol: symbol,
      outputs: {},
      apiKeys: apiKeys,
      error: undefined
    }));

    let stockDataContext = "";
    try {
      // 步骤 0: 从聚合数据 API 获取实时行情，传递 API Key
      // 注意: fetchStockData 内部如果遇到 429 错误会抛出异常，这里需要捕获
      try {
        var stockData = await fetchStockData(symbol, apiKeys.juhe);
      } catch (err: any) {
        // 💎 拦截配额错误
        const errMsg = err.message || String(err);
        if (errMsg.includes('额度') || errMsg.includes('限用') || errMsg.includes('配额')) {
          console.log("拦截到配额限制错误，触发付费弹窗");
          // 保存待处理的股票代码
          localStorage.setItem('alphacouncil_pending_payment', JSON.stringify({
            type: 'QUOTA_UNLOCK',
            stockSymbol: symbol
          }));

          // 触发支付流程
          setShowPaymentDialog(true);
          handlePremiumUnlock();

          // 重置状态防止显示错误BANNER
          setState(prev => ({ ...prev, status: AnalysisStatus.IDLE, error: undefined }));
          return;
        }
        throw err; // 其他错误继续抛出
      }

      // 3. 检查数据获取是否成功
      if (!stockData) {
        setState(prev => ({
          ...prev,
          status: AnalysisStatus.ERROR,
          error: `无法获取股票 ${symbol.toUpperCase()} 的实时数据。请检查：\n1. 股票代码是否正确（如: 600519, 000001, 300750）\n2. 是否为沪深股市代码（不支持港股/美股）\n3. API服务是否正常`
        }));
        return; // 停止分析流程
      }

      stockDataContext = formatStockDataForPrompt(stockData);
      console.log(`[前端] 成功获取 ${stockData.name} (${stockData.gid}) 的实时数据`);

      // 记录 API 使用次数
      incrementApiUsage();
      fetchServerApiUsage(); // 刷新服务器端统计数据

      // 同时获取东方财富资金流向数据（不阻塞主流程）
      try {
        const capitalFlowData = await fetchCapitalFlowData(symbol);
        if (capitalFlowData) {
          const capitalFlowContext = formatCapitalFlowForPrompt(capitalFlowData);
          stockDataContext += capitalFlowContext;
          console.log(`[前端] 成功获取 ${capitalFlowData.name} 的资金流向数据`);
        }
      } catch (e) {
        console.warn('[前端] 资金流向数据获取失败，继续分析');
      }

      // 获取北向资金数据（外资动向）
      try {
        const northboundData = await fetchNorthboundData();
        if (northboundData) {
          const northboundContext = formatNorthboundForPrompt(northboundData);
          stockDataContext += northboundContext;
          console.log(`[前端] 成功获取北向资金数据: ${northboundData.direction}`);
        }
      } catch (e) {
        console.warn('[前端] 北向资金数据获取失败，继续分析');
      }

      // 获取K线历史数据（技术分析用）
      try {
        const klineData = await fetchKLineData(symbol, 10);
        if (klineData) {
          const klineContext = formatKLineForPrompt(klineData);
          stockDataContext += klineContext;
          console.log(`[前端] 成功获取 ${klineData.name} 近${klineData.klines.length}天K线数据`);
        }
      } catch (e) {
        console.warn('[前端] K线数据获取失败，继续分析');
      }

      // 获取大盘指数K线（用于大盘趋势分析）
      try {
        // 根据股票代码判断对应的大盘指数
        let indexSymbol = 'sh000001'; // 默认上证指数
        if (symbol.startsWith('00') || symbol.startsWith('30')) {
          // 深圳主板或创业板
          if (symbol.startsWith('30')) {
            indexSymbol = 'sz399006'; // 创业板指
          } else {
            indexSymbol = 'sz399001'; // 深证成指
          }
        }

        const indexKlineData = await fetchKLineData(indexSymbol, 10);
        if (indexKlineData) {
          const indexKlineContext = `
╔═══════════════════════════════════════════════════════════╗
║      大盘指数K线数据 (${indexKlineData.name}，近10日)      ║
╚═══════════════════════════════════════════════════════════╝
**指数名称**: ${indexKlineData.name}
**数据用途**: 供大盘趋势分析师分析大盘走势，勿与个股混淆

${formatKLineForPrompt(indexKlineData)}
`;
          stockDataContext += indexKlineContext;
          console.log(`[前端] 成功获取 ${indexKlineData.name} 近${indexKlineData.klines.length}天K线数据`);
        }
      } catch (e) {
        console.warn('[前端] 大盘K线数据获取失败，继续分析');
      }

      // 获取基本面财务数据（Baostock）
      let fundamentalData: any = null;
      try {
        fundamentalData = await fetchFundamentalData(symbol);
        if (fundamentalData) {
          const fundamentalContext = formatFundamentalForPrompt(fundamentalData);
          stockDataContext += fundamentalContext;
          console.log(`[前端] 成功获取基本面数据: ROE=${fundamentalData.roe}`);

          // 添加估值上下文（供机会分析师使用）
          const { formatValuationContext } = await import('./services/valuationContext');
          const currentPE = fundamentalData.epsTTM ? (parseFloat(stockData.nowPri) / fundamentalData.epsTTM) : 0;
          const currentPB = fundamentalData.pb || 0;
          const valuationContext = formatValuationContext(
            currentPE,
            currentPB,
            fundamentalData.roe || 0,
            "default" // 可以后续从行业分析师获取
          );
          stockDataContext += valuationContext;
          console.log(`[前端] 成功生成估值上下文: PE=${currentPE.toFixed(2)}`);
        }
      } catch (e) {
        console.warn('[前端] 基本面数据获取失败，继续分析');
      }

      // 更新状态，准备开始第一阶段分析
      setState(prev => ({
        ...prev,
        status: AnalysisStatus.RUNNING,
        currentStep: 1,
        stockDataContext: stockDataContext
      }));

      // 生成 K 线图 URL 供技术分析师使用
      const chartUrl = `${window.location.origin}/AlphaCouncil/api/kline-chart/${symbol}`;
      console.log(`[前端] 技术分析师将使用 K 线图: ${chartUrl}`);

      // 步骤 1: 5位分析师并行分析 (Analysts)
      // 技术分析师会收到 chartUrl 用于 Gemini Vision 分析 K 线形态
      const analystResults = await runAnalystsStage(symbol, state.agentConfigs, apiKeys, stockDataContext, chartUrl);
      setState(prev => ({
        ...prev,
        currentStep: 2,
        outputs: { ...prev.outputs, ...analystResults }
      }));

      // 步骤 2: 2位总监整合报告 (Managers)
      // 💎 如果未付费，在第一阶段后停止（不自动弹窗，等待用户点击按钮）
      if (!isPremiumUnlocked) {
        setState(prev => ({
          ...prev,
          status: AnalysisStatus.COMPLETED,
          currentStep: 2, // 停在第一阶段完成
        }));
        // 不自动弹窗，等用户点击第一阶段下方的按钮
        return;
      }

      // 需要将步骤1的结果传递给经理
      const outputsAfterStep1 = { ...state.outputs, ...analystResults };
      const managerResults = await runManagersStage(symbol, outputsAfterStep1, state.agentConfigs, apiKeys, stockDataContext);
      setState(prev => ({
        ...prev,
        currentStep: 3,
        outputs: { ...prev.outputs, ...managerResults }
      }));

      // 步骤 3: 风控团队评估 (Risk)
      const outputsAfterStep2 = { ...outputsAfterStep1, ...managerResults };
      const riskResults = await runRiskStage(symbol, outputsAfterStep2, state.agentConfigs, apiKeys, stockDataContext);
      setState(prev => ({
        ...prev,
        currentStep: 4,
        outputs: { ...prev.outputs, ...riskResults }
      }));

      // 步骤 4: 总经理最终决策 (GM)
      const outputsAfterStep3 = { ...outputsAfterStep2, ...riskResults };
      const gmResult = await runGMStage(symbol, outputsAfterStep3, state.agentConfigs, apiKeys, stockDataContext);

      setState(prev => ({
        ...prev,
        status: AnalysisStatus.COMPLETED,
        currentStep: 5, // 流程结束
        outputs: { ...prev.outputs, ...gmResult }
      }));

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // 💎 检查是否为配额超限错误 (包含 "限用" 或 "额度" 关键字)
      if (errorMessage.includes('限用') || errorMessage.includes('额度') || errorMessage.includes('配额')) {
        // 保存待处理的股票代码，以便支付成功后继续
        localStorage.setItem('alphacouncil_pending_payment', JSON.stringify({
          type: 'QUOTA_UNLOCK',
          stockSymbol: symbol
        }));

        // 触发支付流程 (强制弹窗)
        setShowPaymentDialog(true);
        handlePremiumUnlock(); // 自动创建订单

        // 提示用户
        // const msg = "今日免费试用次数已达上限 (2次/天)。\n\n请支付 ¥8.88 解锁：\n1. 无限次使用\n2. 深度分析报告\n3. 12位 AI 专家完整推演";
        // alert(msg); 
        // 不弹 alert，直接显示支付框体验更好

        // 不显示错误状态，而是保持 IDLE 或重置
        setState(prev => ({
          ...prev,
          status: AnalysisStatus.IDLE,
          error: undefined
        }));
        return;
      }

      console.error("工作流执行失败", error);
      setState(prev => ({
        ...prev,
        status: AnalysisStatus.ERROR,
        error: errorMessage
      }));
    }
  };

  // 重置系统状态
  const reset = () => {
    // 保留用户自定义的配置(agentConfigs)和key，仅重置输出和状态
    setState(prev => ({
      ...initialState,
      agentConfigs: prev.agentConfigs,
      apiKeys: prev.apiKeys
    }));
    // 💎 重置付费状态（每次分析需重新付费）
    setIsPremiumUnlocked(false);
  };

  // 辅助函数：判断当前阶段是否正在加载
  const isStepLoading = (stepIndex: number) => state.status === AnalysisStatus.RUNNING && state.currentStep === stepIndex;
  // 辅助函数：判断当前阶段是否等待中
  const isStepPending = (stepIndex: number) => state.status === AnalysisStatus.IDLE || state.status === AnalysisStatus.FETCHING_DATA || (state.status === AnalysisStatus.RUNNING && state.currentStep < stepIndex);

  return (
    <div className="min-h-screen bg-slate-950 pb-20 overflow-x-hidden">
      {/* 微信浏览器提示 */}
      {showWeChatPrompt && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[200] flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
            {/* 图标 */}
            <div className="w-20 h-20 mx-auto mb-6 bg-blue-100 rounded-full flex items-center justify-center">
              <svg className="w-10 h-10 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </div>

            {/* 标题 */}
            <h2 className="text-2xl font-bold text-gray-900 mb-3">请在浏览器中打开</h2>

            {/* 说明 */}
            <p className="text-gray-600 mb-6 leading-relaxed">
              由于微信限制，请点击右上角 <span className="font-bold">···</span> 菜单，选择「在浏览器中打开」以使用完整功能
            </p>

            {/* 步骤说明 */}
            <div className="bg-gray-50 rounded-xl p-4 text-left mb-6">
              <p className="text-gray-500 text-sm font-medium mb-3">操作步骤：</p>
              <div className="space-y-2 text-gray-700 text-sm">
                <p>1. 点击右上角 <span className="font-bold">···</span> 按钮</p>
                <p>2. 选择「在浏览器中打开」</p>
                <p>3. 在浏览器中继续使用</p>
              </div>
            </div>

            {/* 继续按钮（可选，允许用户忽略） */}
            <button
              onClick={() => setShowWeChatPrompt(false)}
              className="text-gray-400 text-sm underline hover:text-gray-600"
            >
              我知道了，仍然继续
            </button>
          </div>
        </div>
      )}

      {/* 密码验证对话框 */}
      {showPasswordDialog && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-2">🔐 需要验证密码</h3>
            <p className="text-slate-400 text-sm mb-4">
              今日免费分析次数已达上限（{API_LIMIT}次）。
              <br />如需继续使用，请输入访问密码。
            </p>
            <input
              type="password"
              placeholder="请输入密码"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()}
              className="w-full px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 mb-3"
            />
            {passwordError && <p className="text-red-400 text-sm mb-3">{passwordError}</p>}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowPasswordDialog(false);
                  setPasswordInput('');
                  setPasswordError('');
                }}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handlePasswordSubmit}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 💎 付费解锁对话框 - 任何状态下只要 showPaymentDialog 为 true 均显示 */}
      {showPaymentDialog && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl border border-amber-500/30 p-6 max-w-md w-full shadow-2xl">
            {/* 未创建订单时：显示产品信息 */}
            {!paymentOrderId ? (
              <>
                <div className="text-center mb-6">
                  <div className="text-5xl mb-4">💎</div>

                  {state.status === AnalysisStatus.COMPLETED ? (
                    // 常规流程：解锁深研报
                    <>
                      <h3 className="text-2xl font-bold text-white mb-2">解锁完整分析报告</h3>
                      <p className="text-slate-400 text-sm">
                        第一阶段分析已完成！支付后可查看：
                      </p>
                    </>
                  ) : (
                    // 限流流程：解锁额度 (状态为 IDLE 或其他)
                    <>
                      <h3 className="text-2xl font-bold text-white mb-2">解锁今日无限畅享</h3>
                      <p className="text-slate-400 text-sm">
                        今日免费次数(2次)已耗尽。支付一次即可：
                      </p>
                      <p className="text-amber-400 text-xs mt-1 font-bold">
                        🔥 尊享 24小时内无限次免费开局
                      </p>
                    </>
                  )}
                </div>

                <div className="bg-slate-800/50 rounded-xl p-4 mb-6 space-y-2">
                  <div className="flex items-center gap-3 text-slate-300">
                    <span className="text-green-400">✓</span>
                    <span>第二阶段：研究总监策略整合</span>
                  </div>
                  <div className="flex items-center gap-3 text-slate-300">
                    <span className="text-green-400">✓</span>
                    <span>第三阶段：风控团队评估</span>
                  </div>
                  <div className="flex items-center gap-3 text-slate-300">
                    <span className="text-green-400">✓</span>
                    <span>第四阶段：总经理最终决策</span>
                  </div>
                  <div className="flex items-start gap-3 text-amber-400/90 font-medium mt-3 pt-3 border-t border-slate-700">
                    <span className="shrink-0">⚠️</span>
                    <span className="text-xs leading-relaxed">本平台所有分析由AI生成，仅供参考学习，不构成任何投资建议。股市有风险，投资需谨慎。用户需自行判断并承担全部责任。使用本服务即表示您已阅读并同意以上条款。</span>
                  </div>
                </div>

                <div className="text-center mb-6">
                  <div className="text-slate-500 text-sm line-through mb-1">原价 ¥29.9</div>
                  <div className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-500">
                    ¥{PREMIUM_PRICE}
                  </div>
                  <div className="text-slate-400 text-xs mt-1">限时优惠</div>
                </div>

                <div className="space-y-3">
                  <button
                    onClick={handlePremiumUnlock}
                    disabled={paymentLoading}
                    className="w-full py-3 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white font-bold rounded-xl transition-all transform hover:scale-[1.02] shadow-lg shadow-amber-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {paymentLoading ? '正在创建订单...' : '🔓 支付宝支付'}
                  </button>
                  <button
                    onClick={() => setShowPaymentDialog(false)}
                    className="w-full py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl transition-colors text-sm"
                  >
                    稍后再说
                  </button>
                </div>
              </>
            ) : (
              /* 已创建订单：显示支付状态 */
              <>
                <div className="text-center mb-4">
                  <div className="text-4xl mb-3">💳</div>
                  <h3 className="text-xl font-bold text-white mb-2">
                    {isMobile ? '请使用支付宝扫码支付' : '请在新窗口完成支付'}
                  </h3>
                </div>

                {/* 订单号 */}
                <div className="bg-slate-800/50 rounded-lg p-3 mb-4">
                  <p className="text-xs text-slate-500 mb-1">订单号（请保存）</p>
                  <p className="text-sm font-mono font-semibold text-blue-400">{paymentOrderId}</p>
                </div>

                {/* 显示二维码（PC端和移动端都显示） */}
                {paymentQrCode && (
                  <div className="flex flex-col items-center mb-4">
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(paymentQrCode)}`}
                      alt="支付二维码"
                      className="w-48 h-48 border border-slate-600 rounded-lg bg-white p-2"
                    />
                    <p className="text-slate-400 text-sm mt-3">
                      {isMobile ? '长按二维码或截图保存后用支付宝扫码' : '请用支付宝扫描二维码完成支付'}
                    </p>
                  </div>
                )}

                {/* 金额显示 */}
                <div className="text-center mb-4">
                  <span className="text-3xl font-bold text-amber-400">¥{PREMIUM_PRICE}</span>
                </div>

                {/* 轮询状态 */}
                {paymentPolling && (
                  <div className="flex items-center justify-center gap-2 text-slate-400 text-sm mb-4">
                    <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
                    <span>等待支付确认...</span>
                  </div>
                )}

                <div className="space-y-2">
                  <button
                    onClick={manualCheckPayment}
                    disabled={paymentLoading}
                    className="w-full py-2 bg-green-600 hover:bg-green-500 text-white font-bold rounded-xl transition-colors disabled:opacity-50"
                  >
                    {paymentLoading ? '查询中...' : '我已付款，点击同步'}
                  </button>
                  <button
                    onClick={() => {
                      setShowPaymentDialog(false);
                      setPaymentOrderId(null);
                      setPaymentQrCode(null);
                      setPaymentPolling(false);
                    }}
                    className="w-full py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl transition-colors text-sm"
                  >
                    取消支付
                  </button>
                </div>

                <p className="text-center text-slate-500 text-xs mt-4">
                  支付遇到问题？请联系客服
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* 顶部导航栏 */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 md:gap-3">
            <div className="w-7 h-7 md:w-8 md:h-8 rounded bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center text-white font-bold text-xs md:text-sm shrink-0">
              AC
            </div>
            <h1 className="text-base md:text-lg font-bold text-slate-100 tracking-tight whitespace-nowrap">
              AlphaCouncil <span className="text-blue-500">AI</span>
            </h1>
          </div>
          <div className="flex items-center gap-2 md:gap-4">
            {state.status !== AnalysisStatus.IDLE && (
              <button onClick={reset} className="flex items-center gap-1 md:gap-2 text-xs md:text-sm text-slate-400 hover:text-white transition-colors border border-slate-700 rounded px-2 py-1 md:border-none">
                <RefreshCw className="w-3 h-3 md:w-4 md:h-4" />
                <span className="hidden md:inline">重置系统</span>
                <span className="md:hidden">重置</span>
              </button>
            )}
            <div className="hidden md:block h-4 w-[1px] bg-slate-700"></div>
            <div className="flex items-center gap-2 text-[10px] md:text-xs font-mono text-slate-500">
              <span className={`w-1.5 h-1.5 md:w-2 md:h-2 rounded-full ${state.status === AnalysisStatus.RUNNING || state.status === AnalysisStatus.FETCHING_DATA ? 'bg-green-500 animate-pulse' : 'bg-slate-700'}`}></span>
              <span className="hidden md:inline">状态: </span>
              {
                state.status === AnalysisStatus.IDLE ? '系统就绪' :
                  state.status === AnalysisStatus.FETCHING_DATA ? '获取数据...' :
                    state.status === AnalysisStatus.RUNNING ? '正在分析...' :
                      state.status === AnalysisStatus.COMPLETED ? '分析完成' :
                        state.status === AnalysisStatus.ERROR ? '发生错误' : state.status
              }
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 md:px-6 py-6 md:py-12">
        {/* 输入区域：仅在空闲时显示 */}
        {state.status === AnalysisStatus.IDLE && (
          <div className="flex flex-col items-center justify-center mb-8 md:mb-16 animate-fade-in-up mt-4 md:mt-10">
            <h2 className="text-2xl md:text-5xl font-bold text-center text-white mb-4 md:mb-6 tracking-tight leading-tight">
              多智能体分析决策系统
            </h2>
            <div className="flex flex-col md:flex-row items-center gap-3 md:gap-6 mb-4 md:mb-6">
              <span className="text-base md:text-lg text-amber-400 font-medium">
                🔥 全网每日限量 100 次分析
              </span>
              <div className="flex items-center gap-2 bg-gradient-to-r from-red-600 to-orange-500 px-4 py-2 rounded-full shadow-lg animate-pulse">
                <span className="text-white font-bold text-lg md:text-xl">
                  今日已用: <span id="api-usage-count" className="text-yellow-300">{serverApiUsage}</span>/100
                </span>
              </div>
            </div>
            <p className="text-slate-400 max-w-xl text-center mb-4 md:mb-6 text-sm md:text-lg px-2">
              融合 ChatGPT 5.2 Pro、Gemini 3.1 Pro、DeepSeek R1、通义千问3.5 四大顶级AI模型，12位专家相互印证，给出综合研判。
            </p>
            <p className="text-slate-500 max-w-lg text-center mb-6 md:mb-8 text-xs md:text-sm px-2">
              ⚠️ 免责声明：本系统仅供娱乐，展示AI分析能力，不构成任何投资建议。
            </p>
            <StockInput
              onAnalyze={handleAnalyze}
              disabled={false}
              apiUsageCount={serverApiUsage}
              apiUsageMax={100}
            />
          </div>
        )}

        {/* 结果展示区域 */}
        <div className="space-y-8 md:space-y-12 animate-fade-in">
          {state.status !== AnalysisStatus.IDLE && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                <h2 className="text-xl md:text-2xl font-bold text-white flex items-center gap-2 md:gap-3">
                  分析标的: <span className="font-mono text-blue-400 bg-blue-400/10 px-3 py-1 rounded">{state.stockSymbol.toUpperCase()}</span>
                </h2>
                {state.error && (
                  <div className="flex items-center gap-2 text-red-400 bg-red-400/10 px-3 py-1.5 rounded border border-red-500/20 text-xs md:text-sm">
                    <AlertTriangle className="w-4 h-4" />
                    {state.error}
                  </div>
                )}
              </div>
              {/* 数据源状态指示器 */}
              <div className="flex items-center gap-2 text-[10px] md:text-xs text-slate-400 bg-slate-900/50 p-2 rounded border border-slate-800 w-fit">
                <Database className="w-3 h-3 text-blue-500" />
                <span>数据源: 聚合数据 API (Juhe Data) {state.stockDataContext.includes("无法获取") ? "(连接失败 - 使用AI估算)" : "(连接成功 - 实时数据已注入)"}</span>
              </div>
            </div>
          )}

          {/* 第一阶段：5位分析师 */}
          <section>
            <div className="flex items-center justify-between mb-3 md:mb-4">
              <div className="flex items-center gap-2 text-slate-400 text-xs md:text-sm font-semibold uppercase tracking-wider">
                <LayoutDashboard className="w-4 h-4" /> 第一阶段：并行专业分析
              </div>
              {state.status === AnalysisStatus.IDLE && (
                <div className="text-[10px] md:text-xs text-slate-500 flex items-center gap-1">
                  <Settings2 className="w-3 h-3" /> 可配置参数
                </div>
              )}
            </div>
            {/* 移动端: 自动高度; 桌面端: 自动高度以适应内容 */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3 md:gap-4">
              {[AgentRole.MACRO, AgentRole.INDUSTRY, AgentRole.MARKET_INDEX, AgentRole.TECHNICAL, AgentRole.FUNDS, AgentRole.FUNDAMENTAL].map(role => (
                <div key={role} className="h-[400px] md:h-[450px]">
                  <AgentCard
                    config={state.agentConfigs[role]}
                    content={state.outputs[role]}
                    isLoading={isStepLoading(1)}
                    isPending={isStepPending(1)}
                    isConfigMode={state.status === AnalysisStatus.IDLE}
                    onConfigChange={(newConfig) => handleConfigChange(role, newConfig)}
                  />
                </div>
              ))}
            </div>

            {/* 💎 付费解锁按钮 - 仅在第一阶段完成且未付费时显示 */}
            {!isPremiumUnlocked && state.status === AnalysisStatus.COMPLETED && state.currentStep === 2 && (
              <div className="mt-6 md:mt-8">
                <button
                  onClick={() => {
                    // 移动端和PC端都先显示免责声明弹窗
                    setShowPaymentDialog(true);
                  }}
                  className="w-full py-4 md:py-5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white font-bold text-base md:text-lg rounded-xl shadow-lg shadow-amber-500/30 transition-all transform hover:scale-[1.02] flex items-center justify-center gap-3"
                >
                  <span className="text-2xl">💎</span>
                  <span>请支付 ¥8.88 解锁全部分析师</span>
                  <span className="text-sm opacity-80">→</span>
                </button>
                <p className="text-center text-slate-500 text-xs mt-3">
                  解锁后可查看：研究总监策略 + 风控团队评估 + 总经理决策
                </p>
              </div>
            )}
          </section>

          {/* 第二阶段：2位经理 */}
          <section className="relative">
            <div className="flex items-center gap-2 mb-3 md:mb-4 text-slate-400 text-xs md:text-sm font-semibold uppercase tracking-wider">
              <BrainCircuit className="w-4 h-4" /> 第二阶段：策略整合
              {!isPremiumUnlocked && <span className="ml-2 text-amber-400">🔒</span>}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              {[AgentRole.MANAGER_FUNDAMENTAL, AgentRole.MANAGER_MOMENTUM].map(role => (
                <div key={role} className="h-[400px]">
                  <AgentCard
                    config={state.agentConfigs[role]}
                    content={state.outputs[role]}
                    isLoading={isStepLoading(2)}
                    isPending={isStepPending(2)}
                    isConfigMode={state.status === AnalysisStatus.IDLE}
                    isLocked={!isPremiumUnlocked}
                    onConfigChange={(newConfig) => handleConfigChange(role, newConfig)}
                  />
                </div>
              ))}
            </div>
            {/* 锁定遮罩 - 无按钮，通过中央对话框付费 */}
            {!isPremiumUnlocked && state.status !== AnalysisStatus.IDLE && (
              <div className="absolute inset-0 pointer-events-none z-10"></div>
            )}
          </section>

          {/* 第三阶段：2位风控 */}
          <section className="relative">
            <div className="flex items-center gap-2 mb-3 md:mb-4 text-slate-400 text-xs md:text-sm font-semibold uppercase tracking-wider">
              <ShieldCheck className="w-4 h-4" /> 第三阶段：风控与机会评估
              {!isPremiumUnlocked && <span className="ml-2 text-amber-400">🔒</span>}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
              {[AgentRole.RISK_SYSTEM, AgentRole.RISK_PORTFOLIO, AgentRole.OPPORTUNITY].map(role => (
                <div key={role} className="h-[400px]">
                  <AgentCard
                    config={state.agentConfigs[role]}
                    content={state.outputs[role]}
                    isLoading={isStepLoading(3)}
                    isPending={isStepPending(3)}
                    isConfigMode={state.status === AnalysisStatus.IDLE}
                    isLocked={!isPremiumUnlocked}
                    onConfigChange={(newConfig) => handleConfigChange(role, newConfig)}
                  />
                </div>
              ))}
            </div>
            {/* 锁定遮罩 - 无按钮，通过中央对话框付费 */}
            {!isPremiumUnlocked && state.status !== AnalysisStatus.IDLE && (
              <div className="absolute inset-0 pointer-events-none z-10"></div>
            )}
          </section>

          {/* 第四阶段：总经理 */}
          <section className="relative">
            <div className="flex items-center gap-2 mb-3 md:mb-4 text-slate-400 text-xs md:text-sm font-semibold uppercase tracking-wider">
              <Gavel className="w-4 h-4" /> 第四阶段：最终决策
              {!isPremiumUnlocked && <span className="ml-2 text-amber-400">🔒</span>}
            </div>
            <div className="h-[400px]">
              <AgentCard
                config={state.agentConfigs[AgentRole.GM]}
                content={state.outputs[AgentRole.GM]}
                isLoading={isStepLoading(4)}
                isPending={isStepPending(4)}
                isConfigMode={state.status === AnalysisStatus.IDLE}
                isLocked={!isPremiumUnlocked}
                onConfigChange={(newConfig) => handleConfigChange(AgentRole.GM, newConfig)}
              />
            </div>
            {/* 锁定遮罩 - 无按钮，通过中央对话框付费 */}
            {!isPremiumUnlocked && state.status !== AnalysisStatus.IDLE && (
              <div className="absolute inset-0 pointer-events-none z-10"></div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
};

export default App;