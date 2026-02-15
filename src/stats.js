/**
 * 统计工具 - 重构版
 * 基于状态变化累加收益，而非依赖初始值快照
 */

const logs = [];
const LOG_LIMIT = 200;

// 操作计数
const operations = {
    harvest: 0,
    water: 0,
    weed: 0,
    bug: 0,
    fertilize: 0,
    plant: 0,
    steal: 0,
    helpWater: 0,
    helpWeed: 0,
    helpBug: 0,
    taskClaim: 0,
    sell: 0,
    upgrade: 0,
};

// 状态追踪
let lastState = {
    gold: -1,
    exp: -1,
};

// 本次会话累计收益
const session = {
    goldGained: 0,
    expGained: 0,
    lastExpGain: 0, // 最近一次经验增量
    lastGoldGain: 0, // 最近一次金币增量
};

// 导出操作统计供 worker.js 使用
function getOperations() {
    return { ...operations };
}

function addLog(tag, msg, isWarn = false) {
    const time = new Date().toLocaleTimeString();
    logs.push({ time, tag, msg, isWarn });
    if (logs.length > LOG_LIMIT) logs.shift();
    console.log(`[${time}] [${tag}] ${msg}`);
}

function getLogs(limit = 100, since = 0) {
    return logs.slice(-limit);
}

function recordOperation(type, count = 1) {
    if (operations[type] !== undefined) {
        operations[type] += count;
    }
}

function recordFarmCheck(status) {}
function recordFriendCheck(status) {}

/**
 * 初始化状态 (登录时调用)
 */
function initStats(gold, exp) {
    lastState.gold = gold;
    lastState.exp = exp;
    // 重置收益（可选，如果希望重启脚本后清零）
    // session.goldGained = 0;
    // session.expGained = 0;
}

/**
 * 更新状态并计算增量
 * 只要数值增加，就累加到 sessionGains
 */
function updateStats(currentGold, currentExp) {
    // 首次初始化
    if (lastState.gold === -1) lastState.gold = currentGold;
    if (lastState.exp === -1) lastState.exp = currentExp;

    // 计算金币增量
    if (currentGold > lastState.gold) {
        const delta = currentGold - lastState.gold;
        session.goldGained += delta;
        session.lastGoldGain = delta;
        // console.log(`[Stats] Gold +${delta}`);
    } else if (currentGold < lastState.gold) {
        // 消费了金币，不计入收益，但要更新 lastState
        // console.log(`[Stats] Gold -${lastState.gold - currentGold}`);
    }
    lastState.gold = currentGold;

    // 计算经验增量 (经验通常只增不减)
    if (currentExp > lastState.exp) {
        const delta = currentExp - lastState.exp;
        
        // 防抖: 如果 1秒内 增加了完全相同的 delta，视为重复包忽略
        const now = Date.now();
        if (delta === session.lastExpGain && (now - (session.lastExpTime || 0) < 1000)) {
            console.log(`[系统] 忽略重复经验增量 +${delta}`);
        } else {
            session.expGained += delta;
            session.lastExpGain = delta;
            session.lastExpTime = now;
            console.log(`[系统] 经验 +${delta} (总计: ${currentExp})`);
        }
    }
    lastState.exp = currentExp;
}

// 兼容旧接口，重定向到 updateStats
function recordGoldExp(gold, exp) {
    updateStats(gold, exp);
}

function setInitialValues(gold, exp) {
    initStats(gold, exp);
}

function getStats(statusData, userState, connected, limits) {
    const operationsSnapshot = { ...operations };
    return {
        connection: { connected },
        status: {
            name: userState.name,
            level: statusData.level || userState.level,
            gold: statusData.gold !== null ? statusData.gold : userState.gold,
            exp: statusData.exp !== null ? statusData.exp : userState.exp,
            platform: statusData.platform,
        },
        uptime: process.uptime(),
        operations: operationsSnapshot,
        sessionExpGained: session.expGained,
        sessionGoldGained: session.goldGained,
        lastExpGain: session.lastExpGain,
        lastGoldGain: session.lastGoldGain,
        limits,
    };
}

function resetStats(currentGold, currentExp) {
    for (const k in operations) operations[k] = 0;
    initStats(currentGold, currentExp);
    session.goldGained = 0;
    session.expGained = 0;
}

module.exports = {
    addLog,
    getLogs,
    recordOperation,
    recordFarmCheck,
    recordFriendCheck,
    initStats,
    updateStats,
    setInitialValues, // 兼容旧接口
    recordGoldExp,    // 兼容旧接口
    getStats,
    resetStats,
    getOperations,
};
