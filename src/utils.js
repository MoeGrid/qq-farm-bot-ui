/**
 * 通用工具函数
 */

const Long = require('long');

// ============ 服务器时间状态 ============
let serverTimeMs = 0;
let localTimeAtSync = 0;

// ============ 类型转换 ============
function toLong(val) {
    return Long.fromNumber(val);
}

function toNum(val) {
    if (Long.isLong(val)) return val.toNumber();
    return val || 0;
}

// ============ 时间相关 ============
function now() {
    return new Date().toLocaleTimeString();
}

/** 获取当前推算的服务器时间(秒) */
function getServerTimeSec() {
    if (!serverTimeMs) return Math.floor(Date.now() / 1000);
    const elapsed = Date.now() - localTimeAtSync;
    return Math.floor((serverTimeMs + elapsed) / 1000);
}

/** 同步服务器时间 */
function syncServerTime(ms) {
    serverTimeMs = ms;
    localTimeAtSync = Date.now();
}

/**
 * 将时间戳归一化为秒级
 * 大于 1e12 认为是毫秒级，转换为秒级
 */
function toTimeSec(val) {
    const n = toNum(val);
    if (n <= 0) return 0;
    if (n > 1e12) return Math.floor(n / 1000);
    return n;
}

// ============ 日志 ============
let logHook = null;
function setLogHook(hook) { logHook = hook; }

function normalizeMeta(meta) {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
    return { ...meta };
}

function log(tag, msg, meta = null) {
    console.log(`[${now()}] [${tag}] ${msg}`);
    if (logHook) {
        try { logHook(tag, msg, false, normalizeMeta(meta)); } catch (e) {}
    }
}

function logWarn(tag, msg, meta = null) {
    console.log(`[${now()}] [${tag}] ⚠ ${msg}`);
    if (logHook) {
        try { logHook(tag, msg, true, normalizeMeta(meta)); } catch (e) {}
    }
}

// ============ 异步工具 ============
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

module.exports = {
    toLong, toNum, now,
    setLogHook,
    getServerTimeSec, syncServerTime, toTimeSec,
    log, logWarn, sleep,
};
