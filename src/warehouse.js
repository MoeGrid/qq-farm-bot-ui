/**
 * 仓库系统 - 自动出售果实
 * 协议说明：BagReply 使用 item_bag（ItemBag），item_bag.items 才是背包物品列表
 */

const { types } = require('./proto');
const { sendMsgAsync, networkEvents, getUserState } = require('./network');
const { toLong, toNum, log, logWarn, sleep } = require('./utils');
const { getFruitName } = require('./gameConfig');
const { isAutomationOn } = require('./store');

// ============ 物品类型 ============
// 果实 ID 范围：Plant.json 中 fruit.id 为 4xxxx；部分接口可能用 3xxx，两段都视为果实
const FRUIT_ID_MIN = 3001;
const FRUIT_ID_MAX = 49999;

const SELL_BATCH_SIZE = 15;

// ============ 内部状态 ============
let sellTimer = null;
let sellInterval = 60000;  // 默认1分钟

// ============ API ============

async function getBag() {
    const body = types.BagRequest.encode(types.BagRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.itempb.ItemService', 'Bag', body);
    return types.BagReply.decode(replyBody);
}

function toSellItem(item) {
    const id = item.id != null ? toLong(item.id) : undefined;
    const count = item.count != null ? toLong(item.count) : undefined;
    const uid = item.uid != null ? toLong(item.uid) : undefined;
    return { id, count, uid };
}

async function sellItems(items) {
    const payload = items.map(toSellItem);
    const body = types.SellRequest.encode(types.SellRequest.create({ items: payload })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.itempb.ItemService', 'Sell', body);
    return types.SellReply.decode(replyBody);
}

function getBagItems(bagReply) {
    if (bagReply && bagReply.item_bag && bagReply.item_bag.items && bagReply.item_bag.items.length) {
        return bagReply.item_bag.items;
    }
    return bagReply && bagReply.items ? bagReply.items : [];
}

// ============ 出售逻辑 ============

/**
 * 检查并出售所有果实
 */
async function sellAllFruits() {
    const sellEnabled = isAutomationOn('sell');
    if (!sellEnabled) {
        return;
    }
    try {
        const bagReply = await getBag();
        const items = getBagItems(bagReply);

        const toSell = [];
        const names = [];
        for (const item of items) {
            const id = toNum(item.id);
            const count = toNum(item.count);
            const uid = item.uid ? toNum(item.uid) : 0;
            if (id >= FRUIT_ID_MIN && id <= FRUIT_ID_MAX && count > 0) {
                if (uid === 0) {
                    logWarn('仓库', `跳过无效物品: ID=${id} Count=${count} (UID丢失)`);
                    continue;
                }
                toSell.push(item);
                names.push(`${getFruitName(id)}x${count}`);
            }
        }

        if (toSell.length === 0) {
            log('仓库', '无果实可出售');
            return;
        }

        const goldBefore = (getUserState() && getUserState().gold) ? getUserState().gold : 0;
        for (let i = 0; i < toSell.length; i += SELL_BATCH_SIZE) {
            const batch = toSell.slice(i, i + SELL_BATCH_SIZE);
            await sellItems(batch);
            if (i + SELL_BATCH_SIZE < toSell.length) await sleep(300);
        }
        // 等待金币通知更新（最多 2s）
        let goldAfter = goldBefore;
        const startWait = Date.now();
        while (Date.now() - startWait < 2000) {
            const currentGold = (getUserState() && getUserState().gold) ? getUserState().gold : goldAfter;
            if (currentGold !== goldBefore) {
                goldAfter = currentGold;
                break;
            }
            await sleep(200);
        }
        const totalGoldDelta = goldAfter > goldBefore ? (goldAfter - goldBefore) : 0;
        if (totalGoldDelta > 0) {
            log('仓库', `出售 ${names.join(', ')}，获得 ${totalGoldDelta} 金币`);
        } else {
            logWarn('仓库', `金币变动未收到，稍后将在状态栏更新`);
        }
        
        // 发送出售事件，用于统计金币收益
        if (totalGoldDelta > 0) {
            networkEvents.emit('sell', totalGoldDelta);
        }
    } catch (e) {
        logWarn('仓库', `出售失败: ${e.message}`);
    }
}

// 手动触发一次出售（用于调试）
async function debugSellFruits() {
    try {
        log('仓库', '正在检查背包...');
        const bagReply = await getBag();
        const items = getBagItems(bagReply);
        log('仓库', `背包共 ${items.length} 种物品`);

        // 显示所有物品（包含 uid）
        for (const item of items) {
            const id = toNum(item.id);
            const count = toNum(item.count);
            const uid = item.uid ? toNum(item.uid) : 0;
            const isFruit = id >= FRUIT_ID_MIN && id <= FRUIT_ID_MAX;
            const name = isFruit ? getFruitName(id) : '非果实';
            log('仓库', `  [${isFruit ? '果实' : '物品'}] ${name}(${id}) x${count} uid=${uid}`);
        }

        const toSell = [];
        const names = [];
        for (const item of items) {
            const id = toNum(item.id);
            const count = toNum(item.count);
            const uid = item.uid ? toNum(item.uid) : 0;
            if (id >= FRUIT_ID_MIN && id <= FRUIT_ID_MAX && count > 0) {
                if (uid === 0) {
                    logWarn('仓库', `跳过无效物品: ID=${id} Count=${count} (UID丢失)`);
                    continue;
                }
                toSell.push(item);
                names.push(`${getFruitName(id)}x${count}`);
            }
        }

        if (toSell.length === 0) {
            log('仓库', '没有果实可出售');
            return;
        }

        log('仓库', `准备出售 ${toSell.length} 种果实，每批 ${SELL_BATCH_SIZE} 条...`);
        let totalGold = 0;
        for (let i = 0; i < toSell.length; i += SELL_BATCH_SIZE) {
            const batch = toSell.slice(i, i + SELL_BATCH_SIZE);
            const reply = await sellItems(batch);
            const g = toNum(reply.gold || 0);
            totalGold += g;
            log('仓库', `  第 ${Math.floor(i / SELL_BATCH_SIZE) + 1} 批: 获得 ${g} 金币`);
            if (i + SELL_BATCH_SIZE < toSell.length) await sleep(300);
        }
        log('仓库', `出售 ${names.join(', ')}，获得 ${totalGold} 金币`);
        
        // 发送出售事件，用于统计金币收益
        if (totalGold > 0) {
            networkEvents.emit('sell', totalGold);
        }
    } catch (e) {
        logWarn('仓库', `调试出售失败: ${e.message}`);
        console.error(e);
    }
}

// ============ 定时任务 ============

function startSellLoop(interval = 60000) {
    if (sellTimer) return;
    sellInterval = interval;

    // 启动后延迟 10 秒执行第一次
    setTimeout(() => {
        log('仓库', `自动出售任务已启动，间隔 ${sellInterval / 1000}s`);
        sellAllFruits();
        sellTimer = setInterval(() => sellAllFruits(), sellInterval);
    }, 10000);
}

function stopSellLoop() {
    if (sellTimer) {
        clearInterval(sellTimer);
        sellTimer = null;
    }
}

module.exports = {
    getBag,
    sellItems,
    sellAllFruits,
    debugSellFruits,
    getBagItems,
    startSellLoop,
    stopSellLoop,
};
