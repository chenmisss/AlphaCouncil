/**
 * 增强版浏览器指纹生成器
 * 包含 Canvas, AudioContext, WebGL, 字体等特征
 * 旨在即使在无痕模式下也能生成相对稳定的唯一标识
 */

export async function generateFingerprint(): Promise<string> {
    const components: string[] = [];

    // 1. 基本环境信息
    components.push(`UA:${navigator.userAgent}`);
    components.push(`Lang:${navigator.language}`);
    components.push(`Plat:${navigator.platform}`);
    components.push(`CPU:${navigator.hardwareConcurrency || 'unknown'}`);
    components.push(`Mem:${(navigator as any).deviceMemory || 'unknown'}`);
    components.push(`Touch:${navigator.maxTouchPoints || 0}`);
    components.push(`Screen:${screen.width}x${screen.height}x${screen.colorDepth}`);
    components.push(`Timezone:${Intl.DateTimeFormat().resolvedOptions().timeZone}`);

    // 2. 高级 Canvas 指纹 (包含更多的绘图操作)
    try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
            // 文本混淆
            ctx.textBaseline = 'top';
            ctx.font = '14px "Arial"';
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = '#f60';
            ctx.fillRect(125, 1, 62, 20);
            ctx.fillStyle = '#069';
            ctx.fillText('AlphaCouncil_Fingerprint_v2', 2, 15);
            ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
            ctx.fillText('AlphaCouncil_Fingerprint_v2', 4, 17);

            // 绘图混淆 (Winding Rule)
            ctx.beginPath();
            ctx.arc(50, 50, 50, 0, Math.PI * 2, true);
            ctx.closePath();
            ctx.fill();

            components.push(`Canvas:${canvas.toDataURL().slice(-50)}`);
        }
    } catch (e) {
        components.push('Canvas:Error');
    }

    // 3. AudioContext 指纹 (音频处理差异)
    try {
        // 在某些浏览器（尤其是Safari）中，AudioContext 需要用户交互才能启动，
        // 但 OfflineAudioContext 不需要，适合做指纹
        const AudioContext = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
        if (AudioContext) {
            const context = new AudioContext(1, 44100, 44100);
            const oscillator = context.createOscillator();
            oscillator.type = 'triangle';
            oscillator.frequency.value = 10000;

            const compressor = context.createDynamicsCompressor();
            compressor.threshold.value = -50;
            compressor.knee.value = 40;
            compressor.ratio.value = 12;
            compressor.reduction.value = -20; // 这里的计算差异很大
            compressor.attack.value = 0;
            compressor.release.value = 0.25;

            oscillator.connect(compressor);
            compressor.connect(context.destination);
            oscillator.start(0);

            const renderPromise = context.startRendering();
            // 设置超时防止卡死
            const timeoutPromise = new Promise(resolve => setTimeout(() => resolve('timeout'), 200));

            const result = await Promise.race([renderPromise, timeoutPromise]);

            if (result !== 'timeout' && result instanceof AudioBuffer) {
                // 计算音频数据的哈希（取部分样本）
                const output = result.getChannelData(0);
                let sum = 0;
                // 取中间段的数据进行累加，减少两端的不稳定性
                for (let i = 4500; i < 5000; i++) {
                    sum += Math.abs(output[i]);
                }
                components.push(`Audio:${sum.toFixed(6)}`);
            } else {
                components.push('Audio:Timeout');
            }
        }
    } catch (e) {
        components.push('Audio:Error');
    }

    // 4. WebGL Renderer (显卡信息)
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (gl) {
            const debugInfo = (gl as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info');
            if (debugInfo) {
                const vendor = (gl as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
                const renderer = (gl as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
                components.push(`WebGL:${vendor}||${renderer}`);
            }
        }
    } catch (e) {
        components.push('WebGL:Error');
    }

    // 5. 存储特性探测 (无痕模式下 quota 通常不同)
    try {
        if (navigator.storage && navigator.storage.estimate) {
            // 这一步往往是异步的，为了速度我们可能跳过实际值，或者仅记录是否存在 API
            // 实际上 quota 的具体数值在某些无痕模式下会是特定的整数
            components.push('Storage:API_Available');
        }
    } catch (e) { }

    // 生成最终指纹
    const fingerprintString = components.join('|||');
    return await hashString(fingerprintString);
}


/**
 * 字符串哈希函数 (SHA-256)
 */
async function hashString(str: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);

    try {
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
        // 降级方案
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash).toString(16);
    }
}
