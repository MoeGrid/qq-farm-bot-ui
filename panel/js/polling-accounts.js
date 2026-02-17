async function loadAccounts() {
    return runDedupedRequest('loadAccounts', async () => {
        const list = await api('/api/accounts');
        if (list && list.accounts) {
            const prevCurrentId = String(currentAccountId || '');
            accounts = list.accounts;
            renderAccountSelector();
            renderAccountManager();
            renderLogFilterOptions();

            // 当前账号被删除或不存在时，自动回退
            const hasCurrent = currentAccountId && accounts.some(a => a.id === currentAccountId);
            if (!hasCurrent) currentAccountId = null;

            // 如果当前没有选中账号，且有账号，默认选第一个
            if (!currentAccountId && accounts.length > 0) {
                switchAccount(accounts[0].id);
            } else if (accounts.length === 0) {
                $('current-account-name').textContent = '无账号';
                updateTopbarAccount({ name: '无账号' });
                resetDashboardStats();
                clearFarmView('暂无账号，请先添加账号');
                clearFriendsView('暂无账号，请先添加账号');
            } else {
                updateTopbarAccount(accounts.find(a => a.id === currentAccountId) || null);
                if (!hasCurrent && prevCurrentId) {
                    // 当前账号被删除后，农场/好友页数据立即切换到新账号
                    if ($('page-farm').classList.contains('active')) loadFarm();
                    if ($('page-friends').classList.contains('active')) loadFriends();
                }
            }
        }
    });
}

function renderAccountSelector() {
    const dropdown = $('account-dropdown');
    dropdown.innerHTML = accounts.map(acc => `
        <div class="account-option ${acc.id === currentAccountId ? 'active' : ''}" data-id="${acc.id}">
            <i class="fas fa-user-circle"></i>
            <span>${acc.name}</span>
            ${acc.running ? '<span class="dot online"></span>' : '<span class="dot offline"></span>'}
        </div>
    `).join('');
    
    dropdown.querySelectorAll('.account-option').forEach(el => {
        el.addEventListener('click', () => {
            switchAccount(el.dataset.id);
            dropdown.classList.remove('show');
        });
    });
}

function switchAccount(id) {
    currentAccountId = id;
    expHistory = [];
    lastOperationsData = {};
    const acc = accounts.find(a => a.id === id);
    if (acc) {
        $('current-account-name').textContent = acc.name;
        updateTopbarAccount(acc);
    }
    const seedSel = $('seed-select');
    if (seedSel) {
        seedSel.dataset.loaded = '0';
        seedSel.innerHTML = '<option value="0">自动选择 (等级最高)</option>';
    }
    renderOpsList({});
    // 刷新所有数据
    pollStatus();
    pollLogs();
    if ($('page-farm').classList.contains('active')) loadFarm();
    if ($('page-friends').classList.contains('active')) loadFriends();
}

$('current-account-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('account-dropdown').classList.toggle('show');
});

document.addEventListener('click', () => $('account-dropdown').classList.remove('show'));

// ============ 核心轮询 ============
// 限制经验效率更新频率 (每10秒)
let lastRateUpdate = 0;
const LOG_VIRTUAL_ROW_HEIGHT = 28;
const LOG_VIRTUAL_OVERSCAN = 10;
let logVirtualItems = [];
let logVirtualScrollRaf = null;
let logVirtualBoundWrap = null;

function ensureVirtualLogBinding(wrap) {
    if (!wrap || logVirtualBoundWrap === wrap) return;
    logVirtualBoundWrap = wrap;
    wrap.addEventListener('scroll', () => {
        if (logVirtualScrollRaf) return;
        logVirtualScrollRaf = requestAnimationFrame(() => {
            logVirtualScrollRaf = null;
            renderVirtualLogsWindow(wrap);
        });
    }, { passive: true });
}

function buildLogRowHtml(l) {
    const name = l.accountName ? `【${l.accountName}】` : '';
    const timeStr = ((l.time || '').split(' ')[1] || (l.time || ''));
    const eventKey = (l.meta && l.meta.event) ? String(l.meta.event) : '';
    const eventLabel = LOG_EVENT_LABELS[eventKey] || '';
    const ev = eventLabel ? `[${eventLabel}]` : '';
    return `<div class="log-row ${l.isWarn?'warn':''}">
        <span class="log-time">${escapeHtml(timeStr)}</span>
        <span class="log-tag">[${escapeHtml(l.tag || '系统')}]</span>
        <span class="log-msg">${escapeHtml(`${name}${ev} ${l.msg}`)}</span>
    </div>`;
}

function renderVirtualLogsWindow(wrap) {
    if (!wrap) return;
    ensureVirtualLogBinding(wrap);
    if (!logVirtualItems.length) {
        wrap.innerHTML = '<div class="log-row">暂无日志</div>';
        return;
    }

    const total = logVirtualItems.length;
    const viewportH = Math.max(1, wrap.clientHeight || 320);
    const visibleCount = Math.max(1, Math.ceil(viewportH / LOG_VIRTUAL_ROW_HEIGHT) + LOG_VIRTUAL_OVERSCAN * 2);
    const start = Math.max(0, Math.floor(wrap.scrollTop / LOG_VIRTUAL_ROW_HEIGHT) - LOG_VIRTUAL_OVERSCAN);
    const end = Math.min(total, start + visibleCount);
    const topPad = start * LOG_VIRTUAL_ROW_HEIGHT;
    const bottomPad = Math.max(0, (total - end) * LOG_VIRTUAL_ROW_HEIGHT);
    const rows = logVirtualItems.slice(start, end).map(buildLogRowHtml).join('');
    wrap.innerHTML = `<div style="height:${topPad}px"></div>${rows}<div style="height:${bottomPad}px"></div>`;
}

async function pollStatus() {
    if (!currentAccountId) {
        $('conn-text').textContent = '请添加账号';
        $('conn-dot').className = 'dot offline';
        resetDashboardStats();
        return;
    }
    const key = `pollStatus:${currentAccountId}`;
    return runDedupedRequest(key, async () => {
        const data = await api('/api/status');
        
        if (!data) {
            $('conn-text').textContent = '未连接';
            $('conn-dot').className = 'dot offline';
            lastServerUptime = 0;
            lastSyncTimestamp = 0;
            renderOpsList({});
            if (currentAccountId) {
                loadAccounts();
            }
            return;
        }

    const isConnected = data.connection?.connected;
    const statusRevision = Number(data.configRevision || 0);
    if (statusRevision > latestConfigRevision) latestConfigRevision = statusRevision;
    if (expectedConfigRevision > 0 && statusRevision >= expectedConfigRevision) {
        pendingAutomationKeys.clear();
    }
    $('conn-text').textContent = isConnected ? '运行中' : '未连接';
    $('conn-dot').className = 'dot ' + (isConnected ? 'online' : 'offline');

    // Stats
    $('level').textContent = data.status?.level ? 'Lv' + data.status.level : '-';
    
    updateValueWithAnim('gold', String(data.status?.gold ?? '-'), 'value-changed-gold');
    
    if (data.uptime !== undefined) {
        lastServerUptime = data.uptime;
        lastSyncTimestamp = Date.now();
        updateUptimeDisplay();
    }
    
    // Exp
    const ep = data.expProgress;
    if (ep && ep.needed > 0) {
        const pct = Math.min(100, (ep.current / ep.needed) * 100);
        $('exp-fill').style.width = pct + '%';
        $('exp-num').textContent = ep.current + '/' + ep.needed;
    }

    // Session Gains & History
    const expGain = toSafeNumber(data.sessionExpGained, 0);
    const goldGain = toSafeNumber(data.sessionGoldGained, 0);
    
    // stat-exp 显示会话总增量
    updateValueWithAnim('stat-exp', (expGain >= 0 ? '+' : '') + Math.floor(expGain));
    updateValueWithAnim('stat-gold', (goldGain >= 0 ? '+' : '') + Math.floor(goldGain), 'value-changed-gold');
    const goldGainEl = $('stat-gold');
    if (goldGainEl) {
        goldGainEl.classList.toggle('negative', goldGain < 0);
    }
    
    // 记录历史数据用于图表 (每分钟记录一次)
    const now = new Date();
    const timeLabel = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (expHistory.length === 0 || expHistory[expHistory.length - 1].time !== timeLabel) {
        expHistory.push({ time: timeLabel, exp: expGain, ts: now.getTime() });
        if (expHistory.length > 60) expHistory.shift();
    }

    // 效率计算 (每10秒更新一次)
    if (Date.now() - lastRateUpdate > 10000) {
        lastRateUpdate = Date.now();
        if (data.uptime > 0) { // 只要运行时间大于0就显示
            const hours = data.uptime / 3600;
            const finalRatePerHour = hours > 0 ? (expGain / hours) : 0;
            const rateDisplay = Math.floor(finalRatePerHour) + '/时';
            $('exp-rate').textContent = rateDisplay;
            
            // 预计升级
            if (data.expProgress && data.expProgress.needed > 0 && finalRatePerHour > 0) {
                // 计算还需要多少经验
                const expNeeded = data.expProgress.needed - data.expProgress.current;
                if (expNeeded > 0) {
                    const minsToLevel = expNeeded / (finalRatePerHour / 60);
                    if (minsToLevel < 60) {
                        $('time-to-level').textContent = `约 ${Math.ceil(minsToLevel)} 分钟升级`;
                    } else {
                        $('time-to-level').textContent = `约 ${(minsToLevel/60).toFixed(1)} 小时升级`;
                    }
                } else {
                    $('time-to-level').textContent = '即将升级';
                }
            } else if (finalRatePerHour <= 0) {
                $('time-to-level').textContent = '等待收益...';
            }
        } else {
            $('exp-rate').textContent = '等待数据...';
            $('time-to-level').textContent = '';
        }
    }

    // Automation Switches
    const auto = data.automation || {};
    if (!pendingAutomationKeys.has('farm')) $('auto-farm').checked = !!auto.farm;
    if (!pendingAutomationKeys.has('farm_push')) $('auto-farm-push').checked = !!auto.farm_push;
    if (!pendingAutomationKeys.has('land_upgrade')) $('auto-land-upgrade').checked = !!auto.land_upgrade;
    if (!pendingAutomationKeys.has('friend')) $('auto-friend').checked = !!auto.friend;
    if (!pendingAutomationKeys.has('task')) $('auto-task').checked = !!auto.task;
    if (!pendingAutomationKeys.has('sell')) $('auto-sell').checked = !!auto.sell;
    
    // 只有当用户没有正在操作时才更新下拉框，避免打断用户
    if (!pendingAutomationKeys.has('fertilizer') && document.activeElement !== $('fertilizer-select') && auto.fertilizer) {
        $('fertilizer-select').value = auto.fertilizer;
    }
    
    // 好友细分开关
    if (!pendingAutomationKeys.has('friend_steal')) $('auto-friend-steal').checked = !!auto.friend_steal;
    if (!pendingAutomationKeys.has('friend_help')) $('auto-friend-help').checked = !!auto.friend_help;
    if (!pendingAutomationKeys.has('friend_bad')) $('auto-friend-bad').checked = !!auto.friend_bad;
    updateFriendSubControlsState();

    // Operations Stats
    const opsPayload = (data.operations && typeof data.operations === 'object')
        ? data.operations
        : lastOperationsData;
    renderOpsList(opsPayload || {});

    // Seed Pref
        if (document.activeElement !== $('seed-select') && data.preferredSeed !== undefined) {
            const sel = $('seed-select');
            if (sel.dataset.loaded !== '1') {
                await loadSeeds(data.preferredSeed);
            } else {
                sel.value = String(data.preferredSeed || 0);
            }
        }
    });
}

async function pollLogs() {
    const query = buildLogQuery();
    const key = `pollLogs:${query}`;
    return runDedupedRequest(key, async () => {
        const list = await api(`/api/logs?${query}`);
        const wrap = $('logs-list');
        const serverLogs = (Array.isArray(list) ? list : []).filter((l) => !shouldHideLogEntry(l));
        const uiLogs = localUiLogs.filter(matchLogFilters);
        const normalized = [...serverLogs, ...uiLogs].sort((a, b) => toLogTs(a) - toLogTs(b));
        if (!normalized.length) {
            logVirtualItems = [];
            renderVirtualLogsWindow(wrap);
            return;
        }
        const renderKey = JSON.stringify(normalized.map(l => [toLogTs(l), l.time, l.tag, l.msg, !!l.isWarn, l.accountId, (l.meta && l.meta.event) || '', (l.meta && l.meta.module) || '']));
        if (renderKey === lastLogsRenderKey) {
            renderVirtualLogsWindow(wrap);
            return;
        }
        const isNearBottom = wrap ? (wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 12) : false;
        lastLogsRenderKey = renderKey;
        logVirtualItems = normalized;
        renderVirtualLogsWindow(wrap);
        if (isNearBottom && wrap) {
            wrap.scrollTop = wrap.scrollHeight;
            renderVirtualLogsWindow(wrap);
        }
    });
}

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// ============ 功能模块 ============
