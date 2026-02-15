/**
 * 运行时存储 - 自动化开关、种子偏好、账号管理
 */

const fs = require('fs');
const path = require('path');

const STORE_FILE = path.join(__dirname, '..', 'data', 'store.json');
const ACCOUNTS_FILE = path.join(__dirname, '..', 'data', 'accounts.json');

function ensureDataDir() {
    const dir = path.dirname(STORE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ============ 全局配置 ============
let globalConfig = {
    automation: {
        farm: true,
        farm_push: true,   // 收到 LandsNotify 推送时是否立即触发巡田
        land_upgrade: true, // 是否自动升级土地
        friend: true,
        friend_steal: true, // 偷菜
        friend_help: true,  // 帮忙
        friend_bad: false,  // 捣乱(放虫草)
        task: true,
        sell: true,
        fertilizer: 'both',
    },
    // 种植策略: 'preferred'(偏好), 'level'(最高等级)
    plantingStrategy: 'preferred',
    preferredSeedId: 0,
    // 运行参数
    intervals: {
        farm: 2,   // 秒
        friend: 10, // 秒
    },
    // 好友互动静默时段（在该时间段内不执行好友互动）
    friendQuietHours: {
        enabled: false,
        start: '23:00',
        end: '07:00',
    },
};

// 加载全局配置
function loadGlobalConfig() {
    ensureDataDir();
    try {
        if (fs.existsSync(STORE_FILE)) {
            const data = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
            // 深度合并
            globalConfig.automation = { ...globalConfig.automation, ...data.automation };
            globalConfig.intervals = { ...globalConfig.intervals, ...data.intervals };
            globalConfig.friendQuietHours = { ...globalConfig.friendQuietHours, ...data.friendQuietHours };
            if (data.plantingStrategy && ['preferred', 'level'].includes(String(data.plantingStrategy))) {
                globalConfig.plantingStrategy = String(data.plantingStrategy);
            } else {
                globalConfig.plantingStrategy = 'preferred';
            }
            if (data.preferredSeedId !== undefined && data.preferredSeedId !== null) {
                globalConfig.preferredSeedId = data.preferredSeedId;
            }
        }
    } catch (e) {
        console.error('加载配置失败:', e.message);
    }
}

// 保存全局配置
function saveGlobalConfig() {
    ensureDataDir();
    try {
        console.log('[系统] 正在保存配置到:', STORE_FILE);
        fs.writeFileSync(STORE_FILE, JSON.stringify(globalConfig, null, 2), 'utf8');
    } catch (e) {
        console.error('保存配置失败:', e.message);
    }
}

// 初始化加载
loadGlobalConfig();

function getAutomation() { return { ...globalConfig.automation }; }

function getConfigSnapshot() {
    return {
        automation: { ...globalConfig.automation },
        plantingStrategy: globalConfig.plantingStrategy,
        preferredSeedId: globalConfig.preferredSeedId,
        intervals: { ...globalConfig.intervals },
        friendQuietHours: { ...globalConfig.friendQuietHours },
    };
}

function applyConfigSnapshot(snapshot, options = {}) {
    const cfg = snapshot || {};
    const persist = options.persist !== false;

    if (cfg.automation && typeof cfg.automation === 'object') {
        for (const [k, v] of Object.entries(cfg.automation)) {
            if (globalConfig.automation[k] === undefined) continue;
            if (k === 'fertilizer') {
                const allowed = ['both', 'normal', 'organic', 'none'];
                globalConfig.automation[k] = allowed.includes(v) ? v : globalConfig.automation[k];
            } else {
                globalConfig.automation[k] = !!v;
            }
        }
    }

    if (cfg.plantingStrategy && ['preferred', 'level'].includes(cfg.plantingStrategy)) {
        globalConfig.plantingStrategy = cfg.plantingStrategy;
    }

    if (cfg.preferredSeedId !== undefined && cfg.preferredSeedId !== null) {
        globalConfig.preferredSeedId = Math.max(0, parseInt(cfg.preferredSeedId) || 0);
    }

    if (cfg.intervals && typeof cfg.intervals === 'object') {
        for (const [type, sec] of Object.entries(cfg.intervals)) {
            if (globalConfig.intervals[type] === undefined) continue;
            globalConfig.intervals[type] = Math.max(1, parseInt(sec) || 60);
        }
    }

    if (cfg.friendQuietHours && typeof cfg.friendQuietHours === 'object') {
        const old = globalConfig.friendQuietHours || {};
        globalConfig.friendQuietHours = {
            enabled: cfg.friendQuietHours.enabled !== undefined ? !!cfg.friendQuietHours.enabled : !!old.enabled,
            start: normalizeTimeString(cfg.friendQuietHours.start, old.start || '23:00'),
            end: normalizeTimeString(cfg.friendQuietHours.end, old.end || '07:00'),
        };
    }

    if (persist) saveGlobalConfig();
    return getConfigSnapshot();
}

function setAutomation(key, value) {
    return applyConfigSnapshot({ automation: { [key]: value } });
}

function isAutomationOn(key) { return !!globalConfig.automation[key]; }

function getPreferredSeed() { return globalConfig.preferredSeedId; }

function setPreferredSeed(seedId) {
    return applyConfigSnapshot({ preferredSeedId: seedId });
}

function getPlantingStrategy() { return globalConfig.plantingStrategy; }

function setPlantingStrategy(strategy) {
    return applyConfigSnapshot({ plantingStrategy: strategy });
}

function getIntervals() { return { ...globalConfig.intervals }; }

function setIntervals(type, seconds) {
    return applyConfigSnapshot({ intervals: { [type]: seconds } });
}

function normalizeTimeString(v, fallback) {
    const s = String(v || '').trim();
    const m = s.match(/^(\d{1,2}):(\d{1,2})$/);
    if (!m) return fallback;
    const hh = Math.max(0, Math.min(23, parseInt(m[1], 10)));
    const mm = Math.max(0, Math.min(59, parseInt(m[2], 10)));
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function getFriendQuietHours() {
    return { ...globalConfig.friendQuietHours };
}

function setFriendQuietHours(cfg) {
    return applyConfigSnapshot({ friendQuietHours: cfg || {} });
}

// ============ 账号管理 ============
function loadAccounts() {
    ensureDataDir();
    try {
        if (fs.existsSync(ACCOUNTS_FILE)) {
            return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
        }
    } catch (e) {}
    return { accounts: [], nextId: 1 };
}

function saveAccounts(data) {
    ensureDataDir();
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getAccounts() {
    return loadAccounts();
}

function addOrUpdateAccount(acc) {
    const data = loadAccounts();
    if (acc.id) {
        const idx = data.accounts.findIndex(a => a.id === acc.id);
        if (idx >= 0) {
            data.accounts[idx] = { ...data.accounts[idx], ...acc, updatedAt: Date.now() };
        }
    } else {
        const id = data.nextId++;
        data.accounts.push({
            id: String(id),
            name: acc.name || `账号${id}`,
            code: acc.code || '',
            platform: acc.platform || 'qq',
            uin: acc.uin ? String(acc.uin) : '',
            qq: acc.qq ? String(acc.qq) : (acc.uin ? String(acc.uin) : ''),
            avatar: acc.avatar || acc.avatarUrl || '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
    }
    saveAccounts(data);
    return data;
}

function deleteAccount(id) {
    const data = loadAccounts();
    data.accounts = data.accounts.filter(a => a.id !== String(id));
    saveAccounts(data);
    return data;
}

module.exports = {
    getConfigSnapshot,
    applyConfigSnapshot,
    getAutomation,
    setAutomation,
    isAutomationOn,
    getPreferredSeed,
    setPreferredSeed,
    getPlantingStrategy,
    setPlantingStrategy,
    getIntervals,
    setIntervals,
    getFriendQuietHours,
    setFriendQuietHours,
    getAccounts,
    addOrUpdateAccount,
    deleteAccount,
};
