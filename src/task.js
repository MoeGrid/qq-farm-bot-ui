/**
 * 任务系统 - 自动领取任务奖励
 */

const { types } = require('./proto');
const { sendMsgAsync, networkEvents } = require('./network');
const { recordOperation } = require('./stats');
const { isAutomationOn } = require('./store');
const { toLong, toNum, log, logWarn, sleep } = require('./utils');

// ============ 任务 API ============

async function getTaskInfo() {
    const body = types.TaskInfoRequest.encode(types.TaskInfoRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.taskpb.TaskService', 'TaskInfo', body);
    return types.TaskInfoReply.decode(replyBody);
}

async function claimTaskReward(taskId, doShared = false) {
    const body = types.ClaimTaskRewardRequest.encode(types.ClaimTaskRewardRequest.create({
        id: toLong(taskId),
        do_shared: doShared,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.taskpb.TaskService', 'ClaimTaskReward', body);
    return types.ClaimTaskRewardReply.decode(replyBody);
}

// ============ 任务分析 ============

function formatTask(t) {
    return {
        id: toNum(t.id),
        desc: t.desc || `任务#${toNum(t.id)}`,
        progress: toNum(t.progress),
        totalProgress: toNum(t.total_progress),
        isClaimed: t.is_claimed,
        isUnlocked: t.is_unlocked,
        shareMultiple: toNum(t.share_multiple),
        rewards: (t.rewards || []).map(r => ({ id: toNum(r.id), count: toNum(r.count) })),
        canClaim: t.is_unlocked && !t.is_claimed && toNum(t.progress) >= toNum(t.total_progress) && toNum(t.total_progress) > 0
    };
}

/**
 * 获取所有任务列表（供前端展示）
 */
async function getAllTasks() {
    try {
        const reply = await getTaskInfo();
        if (!reply.task_info) return {};
        
        const ti = reply.task_info;
        return {
            daily: (ti.daily_tasks || []).map(formatTask),
            growth: (ti.growth_tasks || []).map(formatTask),
            main: (ti.tasks || []).map(formatTask),
        };
    } catch (e) {
        logWarn('任务', `获取列表失败: ${e.message}`);
        return {};
    }
}

/**
 * 分析任务列表，找出可领取的任务
 */
function analyzeTaskList(tasks) {
    const claimable = [];
    for (const task of tasks) {
        const t = formatTask(task);
        if (t.canClaim) {
            claimable.push(t);
        }
    }
    return claimable;
}

/**
 * 计算奖励摘要
 */
function getRewardSummary(items) {
    const summary = [];
    for (const item of items) {
        const id = toNum(item.id);
        const count = toNum(item.count);
        if (id === 1) summary.push(`金币${count}`);
        else if (id === 2) summary.push(`经验${count}`);
        else summary.push(`物品#${id}x${count}`);
    }
    return summary.join('/');
}

// ============ 自动领取 ============

async function checkAndClaimTasks() {
    if (!isAutomationOn('task')) return;
    try {
        const reply = await getTaskInfo();
        if (!reply.task_info) return;

        const taskInfo = reply.task_info;
        const allTasks = [
            ...(taskInfo.growth_tasks || []),
            ...(taskInfo.daily_tasks || []),
            ...(taskInfo.tasks || []),
        ];

        const claimable = analyzeTaskList(allTasks);
        if (claimable.length === 0) return;

        log('任务', `发现 ${claimable.length} 个可领取任务`);

        for (const task of claimable) {
            await doClaim(task);
        }
    } catch (e) {
        // 静默失败
    }
}

async function doClaim(task) {
    try {
        const useShare = task.shareMultiple > 1;
        const multipleStr = useShare ? ` (${task.shareMultiple}倍)` : '';

        const claimReply = await claimTaskReward(task.id, useShare);
        const items = claimReply.items || [];
        const rewardStr = items.length > 0 ? getRewardSummary(items) : '无';

        log('任务', `领取: ${task.desc}${multipleStr} → ${rewardStr}`);
        recordOperation('taskClaim', 1);
        await sleep(300);
        return true;
    } catch (e) {
        logWarn('任务', `领取失败 #${task.id}: ${e.message}`);
        return false;
    }
}

function onTaskInfoNotify(taskInfo) {
    if (!taskInfo) return;

    const allTasks = [
        ...(taskInfo.growth_tasks || []),
        ...(taskInfo.daily_tasks || []),
        ...(taskInfo.tasks || []),
    ];

    const claimable = analyzeTaskList(allTasks);
    if (claimable.length === 0) return;

    log('任务', `有 ${claimable.length} 个任务可领取，准备自动领取...`);
    setTimeout(() => claimTasksFromList(claimable), 1000);
}

async function claimTasksFromList(claimable) {
    if (!isAutomationOn('task')) return;
    for (const task of claimable) {
        await doClaim(task);
    }
}

// ============ 初始化 ============

function initTaskSystem() {
    networkEvents.on('taskInfoNotify', onTaskInfoNotify);
    setTimeout(() => checkAndClaimTasks(), 4000);
}

function cleanupTaskSystem() {
    networkEvents.off('taskInfoNotify', onTaskInfoNotify);
}

module.exports = {
    checkAndClaimTasks,
    initTaskSystem,
    cleanupTaskSystem,
    getAllTasks,
    claimTaskReward,
    doClaim, // 供手动领取使用
};
