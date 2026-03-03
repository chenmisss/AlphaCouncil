/**
 * 基于 JSON 文件的每日使用次数限制器
 * 数据持久化存储，服务器重启后不会丢失
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, 'usage_data.json');
const DAILY_LIMIT = 100; // 每日全网限制100次
const CLIENT_DAILY_LIMIT = 1; // 单个用户每日限制1次

/**
 * 读取使用数据
 */
function loadData() {
    try {
        if (fs.existsSync(DATA_PATH)) {
            const data = fs.readFileSync(DATA_PATH, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error('[RateLimiter] 读取数据失败:', err.message);
    }
    return {};
}

/**
 * 保存使用数据
 */
function saveData(data) {
    try {
        fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('[RateLimiter] 保存数据失败:', err.message);
    }
}

/**
 * 获取今日日期字符串 (YYYY-MM-DD)
 */
function getToday() {
    return new Date().toISOString().split('T')[0];
}

/**
 * 初始化今日数据结构
 */
function initTodayData(data, today) {
    if (!data[today] || typeof data[today] === 'number') {
        // 兼容旧格式或初始化
        data[today] = {
            total: typeof data[today] === 'number' ? data[today] : 0,
            clients: {}
        };
    }
    return data;
}

/**
 * 获取今日全网使用次数
 */
function getTodayUsage() {
    const data = loadData();
    const today = getToday();
    const todayData = data[today];

    if (todayData && typeof todayData === 'object') {
        return todayData.total || 0;
    }
    return typeof todayData === 'number' ? todayData : 0;
}

/**
 * 检查是否还有剩余配额
 * @param {string} clientId 客户端标识 (指纹或IP)
 * @returns {{ allowed: boolean, remaining: number, used: number, limit: number, error?: string }}
 */
export function checkRateLimit(clientId) {
    const data = loadData();
    const today = getToday();

    // 确保今日数据结构存在
    const safeData = initTodayData(data, today);
    const todayStats = safeData[today];

    const globalUsage = todayStats.total;
    const clientUsage = (todayStats.clients && todayStats.clients[clientId]) || 0;

    // 1. 检查全网配额
    if (globalUsage >= DAILY_LIMIT) {
        return {
            allowed: false,
            remaining: 0,
            used: globalUsage,
            limit: DAILY_LIMIT,
            error: '全网今日免费额度已耗尽 (100/100)'
        };
    }

    // 2. 检查个人配额
    if (clientUsage >= CLIENT_DAILY_LIMIT) {
        return {
            allowed: false,
            remaining: 0,
            used: clientUsage,
            limit: CLIENT_DAILY_LIMIT,
            error: `今日全网额度已用完 (${clientUsage}/${CLIENT_DAILY_LIMIT})\n为防止滥用，未付费用户每日限用 ${CLIENT_DAILY_LIMIT} 次。`
        };
    }

    return {
        allowed: true,
        remaining: Math.min(DAILY_LIMIT - globalUsage, CLIENT_DAILY_LIMIT - clientUsage),
        used: clientUsage,
        limit: CLIENT_DAILY_LIMIT
    };
}

/**
 * 增加使用计数
 * @param {string} clientId 客户端标识
 */
export function incrementUsage(clientId) {
    const today = getToday();
    let data = loadData();

    data = initTodayData(data, today);

    // 增加全网计数
    data[today].total = (data[today].total || 0) + 1;

    // 增加个人计数
    if (clientId) {
        if (!data[today].clients) {
            data[today].clients = {};
        }
        data[today].clients[clientId] = (data[today].clients[clientId] || 0) + 1;
    }

    saveData(data);

    console.log(`[RateLimiter] 全网: ${data[today].total}/${DAILY_LIMIT}, 用户(${clientId?.slice(0, 6)}...): ${data[today].clients[clientId]}/${CLIENT_DAILY_LIMIT}`);
    return data[today].total;
}

/**
 * 获取今日使用统计（供前端显示）
 */
export function getUsageStats() {
    const currentUsage = getTodayUsage();
    return {
        totalUsed: currentUsage,
        totalLimit: DAILY_LIMIT,
        remaining: Math.max(0, DAILY_LIMIT - currentUsage)
    };
}

/**
 * 清理7天前的旧数据
 */
export function cleanupOldEntries() {
    const data = loadData();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoffDate = sevenDaysAgo.toISOString().split('T')[0];

    let cleaned = 0;
    for (const date of Object.keys(data)) {
        if (date < cutoffDate) {
            delete data[date];
            cleaned++;
        }
    }

    if (cleaned > 0) {
        saveData(data);
        console.log(`[RateLimiter] 清理了 ${cleaned} 条过期记录`);
    }
}

// 每天清理一次过期数据
setInterval(cleanupOldEntries, 24 * 60 * 60 * 1000);

// 启动时清理一次
cleanupOldEntries();

console.log(`[RateLimiter] JSON 文件存储已初始化: ${DATA_PATH}`);
