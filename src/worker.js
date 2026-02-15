/**
 * 子进程 Worker - 负责运行单个账号的挂机逻辑
 */
const { CONFIG } = require('./config');
const { loadProto } = require('./proto');
const { connect, reconnect, cleanup, getWs, getUserState, networkEvents } = require('./network');
const { checkFarm, startFarmCheckLoop, stopFarmCheckLoop, refreshFarmCheckLoop, getLandsDetail, getAvailableSeeds, runFarmOperation } = require('./farm');
const { checkFriends, startFriendCheckLoop, stopFriendCheckLoop, refreshFriendCheckLoop, getFriendsList, getFriendLandsDetail, doFriendOperation, getOperationLimits } = require('./friend');
const { initTaskSystem, cleanupTaskSystem, claimTaskReward } = require('./task');
const { initStatusBar, cleanupStatusBar, setStatusPlatform, statusData } = require('./status');
const { getOperations, recordGoldExp, getStats } = require('./stats');
const { startSellLoop, stopSellLoop, debugSellFruits } = require('./warehouse');
const { processInviteCodes } = require('./invite');
const { setLogHook, log } = require('./utils');
const { setRecordGoldExpHook } = require('./status');
const { getLevelExpProgress } = require('./gameConfig');
const { getAutomation, getPreferredSeed, getConfigSnapshot, applyConfigSnapshot } = require('./store');

// 捕获日志发送给主进程
setLogHook((tag, msg, isWarn, meta) => {
    if (process.send) {
        process.send({ 
            type: 'log', 
            data: { 
                time: new Date().toLocaleString(), 
                tag, 
                msg, 
                isWarn,
                meta: meta || {},
            } 
        });
    }
});

// 捕获金币经验变化
setRecordGoldExpHook((gold, exp) => {
    // 更新内部统计
    const { recordGoldExp } = require('./stats');
    recordGoldExp(gold, exp);
    
    // 发送给主进程
    if (process.send) {
        process.send({ type: 'stat_update', data: { gold, exp } });
    }
});

let isRunning = false;
let loginReady = false;
let statusSyncTimer = null;
let appliedConfigRevision = 0;
let unifiedSchedulerTimer = null;
let unifiedSchedulerRunning = false;
let unifiedTaskRunning = false;
let nextFarmRunAt = 0;
let nextFriendRunAt = 0;
let farmIdleRounds = 0;
let friendIdleRounds = 0;
let lastStatusHash = '';
let lastStatusSentAt = 0;

function resetUnifiedSchedule() {
    nextFarmRunAt = Date.now() + 2000;
    nextFriendRunAt = Date.now() + 5000;
    farmIdleRounds = 0;
    friendIdleRounds = 0;
}

async function runUnifiedTick() {
    if (!unifiedSchedulerRunning || unifiedTaskRunning || !loginReady) return;
    const now = Date.now();
    const dueFarm = now >= nextFarmRunAt;
    const dueFriend = now >= nextFriendRunAt;
    if (!dueFarm && !dueFriend) return;

    unifiedTaskRunning = true;
    try {
        const intervals = require('./store').getIntervals();
        const auto = getAutomation();
        const farmMs = Math.max(1000, Math.max(1, intervals.farm || 2) * 1000);
        const friendMs = Math.max(1000, Math.max(1, intervals.friend || 10) * 1000);

        if (dueFarm) {
            const farmWorked = auto.farm ? !!(await checkFarm()) : false;
            farmIdleRounds = farmWorked ? 0 : Math.min(4, farmIdleRounds + 1);
            const farmFactor = farmWorked ? 1 : Math.pow(2, farmIdleRounds);
            const nextFarmDelay = Math.min(60000, farmMs * farmFactor);
            nextFarmRunAt = Date.now() + nextFarmDelay;
        }
        if (dueFriend) {
            const friendWorked = auto.friend ? !!(await checkFriends()) : false;
            friendIdleRounds = friendWorked ? 0 : Math.min(4, friendIdleRounds + 1);
            const friendFactor = friendWorked ? 1 : Math.pow(2, friendIdleRounds);
            const nextFriendDelay = Math.min(120000, friendMs * friendFactor);
            nextFriendRunAt = Date.now() + nextFriendDelay;
        }
    } catch (e) {
        log('系统', `统一调度执行失败: ${e.message}`, { module: 'scheduler', event: 'tick', result: 'error' });
    } finally {
        unifiedTaskRunning = false;
    }
}

function startUnifiedScheduler() {
    if (unifiedSchedulerRunning) return;
    unifiedSchedulerRunning = true;
    resetUnifiedSchedule();
    if (unifiedSchedulerTimer) clearInterval(unifiedSchedulerTimer);
    unifiedSchedulerTimer = setInterval(() => {
        runUnifiedTick();
    }, 300);
}

function stopUnifiedScheduler() {
    unifiedSchedulerRunning = false;
    unifiedTaskRunning = false;
    if (unifiedSchedulerTimer) {
        clearInterval(unifiedSchedulerTimer);
        unifiedSchedulerTimer = null;
    }
}

function applyRuntimeConfig(snapshot, syncNow = false) {
    applyConfigSnapshot(snapshot || {}, { persist: false });
    const rev = Number((snapshot || {}).__revision || 0);
    if (rev > 0) appliedConfigRevision = rev;

    const intervals = require('./store').getIntervals();
    if (intervals.farm) CONFIG.farmCheckInterval = Math.max(1, intervals.farm) * 1000;
    if (intervals.friend) CONFIG.friendCheckInterval = Math.max(1, intervals.friend) * 1000;

    if (loginReady) {
        refreshFarmCheckLoop(200);
        refreshFriendCheckLoop(200);
        resetUnifiedSchedule();

        stopSellLoop();
        if (getAutomation().sell !== false) {
            startSellLoop(60000);
        }
    }

    if (syncNow) syncStatus();
}

// 接收主进程指令
process.on('message', async (msg) => {
    try {
        if (msg.type === 'start') {
            await startBot(msg.config);
        } else if (msg.type === 'stop') {
            await stopBot();
        } else if (msg.type === 'api_call') {
            handleApiCall(msg);
        } else if (msg.type === 'config_sync') {
            applyRuntimeConfig(msg.config || {}, true);
        }
    } catch (e) {
        if (process.send) process.send({ type: 'error', error: e.message });
    }
});

async function startBot(config) {
    if (isRunning) return;
    isRunning = true;

    const { code, platform, farmInterval, friendInterval } = config;

    CONFIG.platform = platform || 'qq';
    if (farmInterval) CONFIG.farmCheckInterval = farmInterval;
    if (friendInterval) CONFIG.friendCheckInterval = friendInterval;

    await loadProto();
    
    log('系统', '正在连接服务器...');

    // 加载保存的配置
    applyRuntimeConfig(getConfigSnapshot(), false);

    initStatusBar();
    setStatusPlatform(CONFIG.platform);

    networkEvents.on('kickout', onKickout);

    const onLoginSuccess = async () => {
        loginReady = true;
        // 登录成功后启动各模块
        await processInviteCodes();
        startFarmCheckLoop({ externalScheduler: true });
        startFriendCheckLoop({ externalScheduler: true });
        startUnifiedScheduler();
        initTaskSystem();
        // 根据配置启动售卖循环
        if (getAutomation().sell !== false) {
            startSellLoop(60000);
        }
        
        // 立即发送一次状态
        syncStatus();
    };

    connect(code, onLoginSuccess);

    // 启动定时状态同步
    if (statusSyncTimer) clearInterval(statusSyncTimer);
    statusSyncTimer = setInterval(syncStatus, 3000);
}

async function stopBot() {
    if (!isRunning) process.exit(0);
    isRunning = false;
    loginReady = false;
    stopUnifiedScheduler();
    networkEvents.off('kickout', onKickout);
    stopFarmCheckLoop();
    stopFriendCheckLoop();
    cleanupTaskSystem();
    stopSellLoop();
    if (statusSyncTimer) {
        clearInterval(statusSyncTimer);
        statusSyncTimer = null;
    }
    cleanup();
    const ws = getWs();
    if (ws) ws.close();
    process.exit(0);
}

function onKickout(payload) {
    const reason = payload && payload.reason ? payload.reason : '未知';
    log('系统', `检测到踢下线，准备自动删除账号。原因: ${reason}`);
    if (process.send) {
        process.send({ type: 'account_kicked', reason });
    }
    setTimeout(() => {
        stopBot().catch(() => process.exit(0));
    }, 200);
}

// 处理来自 Admin 面板的直接调用请求 (如: 购买种子、开关设置等)
async function handleApiCall(msg) {
    const { id, method, args } = msg;
    let result = null;
    let error = null;

    try {
        switch (method) {
            case 'getLands':
                result = await getLandsDetail();
                break;
            case 'getFriends':
                result = await getFriendsList();
                break;
            case 'getFriendLands':
                result = await getFriendLandsDetail(args[0]);
                break;
            case 'doFriendOp':
                result = await doFriendOperation(args[0], args[1]);
                break;
            case 'getSeeds':
                result = await getAvailableSeeds();
                break;
            case 'setAutomation': {
                const payload = args && args[0] ? args[0] : {};
                applyRuntimeConfig({ automation: { [payload.key]: payload.value } }, true);
                result = getAutomation();
                break;
            }
            case 'setSeed':
                applyRuntimeConfig({ preferredSeedId: (args && args[0] ? args[0] : {}).seedId }, true);
                result = { preferredSeed: getPreferredSeed() };
                break;
            case 'reconnect':
                reconnect((args && args[0] ? args[0] : {}).code);
                result = { ok: true };
                break;
            case 'doFarmOp':
                result = await runFarmOperation(args[0]); // opType
                break;
            case 'getAnalytics': {
                const { getPlantRankings } = require('./analytics');
                result = getPlantRankings(args[0]); // sortBy
                break;
            }
            case 'getIntervals':
                result = require('./store').getIntervals();
                break;
            case 'getPlantingStrategy':
                result = require('./store').getPlantingStrategy();
                break;
            case 'setIntervals': {
                const payload = args && args[0] ? args[0] : {};
                applyRuntimeConfig({ intervals: { [payload.type]: payload.value } }, true);
                result = require('./store').getIntervals();
                break;
            }
            case 'setPlantingStrategy': {
                const strategy = (args && args[0] ? args[0] : {}).strategy;
                applyRuntimeConfig({ plantingStrategy: strategy }, true);
                result = { plantingStrategy: require('./store').getPlantingStrategy() };
                break;
            }
            case 'setFriendQuietHours': {
                applyRuntimeConfig({ friendQuietHours: (args && args[0] ? args[0] : {}) }, true);
                result = { friendQuietHours: require('./store').getFriendQuietHours() };
                break;
            }
            case 'debugSellFruits':
                await require('./warehouse').debugSellFruits();
                result = { ok: true };
                break;
            default:
                error = 'Unknown method';
        }
    } catch (e) {
        error = e.message;
    }

    if (process.send) {
        process.send({ type: 'api_response', id, result, error });
    }
}

function syncStatus() {
    if (!process.send) return;

    const userState = getUserState();
    const ws = getWs();
    const connected = ws && ws.readyState === 1;
    
    let expProgress = null;
    const level = statusData.level || userState.level;
    const exp = statusData.exp ?? userState.exp ?? 0;
    
    if (level > 0 && exp >= 0) {
        expProgress = getLevelExpProgress(level, exp);
    }

    const limits = require('./friend').getOperationLimits();
    const fullStats = require('./stats').getStats(statusData, userState, connected, limits);
    
    fullStats.automation = getAutomation();
    fullStats.preferredSeed = getPreferredSeed();
    fullStats.expProgress = expProgress;
    fullStats.configRevision = appliedConfigRevision;
    const hash = JSON.stringify(fullStats);
    const now = Date.now();
    if (hash !== lastStatusHash || now - lastStatusSentAt > 8000) {
        lastStatusHash = hash;
        lastStatusSentAt = now;
        process.send({ type: 'status_sync', data: fullStats });
    }
}
