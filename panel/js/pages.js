
// 农场加载
async function loadFarm() {
    if (!currentAccountId) {
        clearFarmView('暂无账号，请先添加或选择账号');
        return;
    }
    const data = await api('/api/lands');
    const grid = $('farm-grid');
    const sum = $('farm-summary');
    
    if (!data || !data.lands) { 
        grid.innerHTML = '<div style="padding:20px;text-align:center;color:#666">无法获取数据，请确保账号已登录</div>'; 
        sum.textContent = ''; 
        return; 
    }

    const statusClass = { locked: 'locked', empty: 'empty', harvestable: 'harvestable', growing: 'growing', dead: 'dead', stealable: 'stealable', harvested: 'empty' };
    grid.innerHTML = data.lands.map(l => {
        let cls = statusClass[l.status] || 'empty';
        if (l.status === 'stealable') cls = 'harvestable'; // 复用样式
        const landLevel = Number(l.level || 0);
        const landLevelClass = `land-level-${Math.max(0, Math.min(4, landLevel))}`;
        const landTypeNameMap = {
            0: '未解锁',
            1: '黄土地',
            2: '红土地',
            3: '黑土地',
            4: '金土地'
        };
        const landTypeName = landTypeNameMap[Math.max(0, Math.min(4, landLevel))] || '土地';
        let phaseText = landLevel <= 0 ? '未解锁' : (l.phaseName || '');
        if (landLevel > 0 && Number(l.matureInSec || 0) > 0) {
            phaseText = `${phaseText} · ${fmtRemainSec(l.matureInSec)}后成熟`;
        }
        
        let needs = [];
        if (l.needWater) needs.push('水');
        if (l.needWeed) needs.push('草');
        if (l.needBug) needs.push('虫');
        return `
            <div class="land-cell ${cls} ${landLevelClass}">
                <span class="id">#${l.id}</span>
                <span class="plant-name">${l.plantName || '-'}</span>
                <span class="phase-name">${phaseText}</span>
                <span class="land-meta">${landTypeName}</span>
                ${needs.length ? `<span class="needs">${needs.join(' ')}</span>` : ''}
            </div>`;
    }).join('');
    
    const s = data.summary || {};
    sum.textContent = `可收:${s.harvestable||0} 长:${s.growing||0} 空:${s.empty||0} 枯:${s.dead||0}`;
}

// 好友列表加载
async function loadFriends() {
    if (!currentAccountId) {
        clearFriendsView('暂无账号，请先添加或选择账号');
        return;
    }
    const list = await api('/api/friends');
    const wrap = $('friends-list');
    const summary = $('friend-summary');
    
    if (!list || !list.length) { 
        if (summary) summary.textContent = '共 0 名好友';
        wrap.innerHTML = '<div style="padding:20px;text-align:center;color:#666">暂无好友或数据加载失败</div>'; 
        return; 
    }

    if (summary) summary.textContent = `共 ${list.length} 名好友`;

    wrap.innerHTML = list.map(f => {
        const p = f.plant || {};
        const info = [];
        if (p.stealNum) info.push(`偷${p.stealNum}`);
        if (p.dryNum) info.push(`水${p.dryNum}`);
        if (p.weedNum) info.push(`草${p.weedNum}`);
        if (p.insectNum) info.push(`虫${p.insectNum}`);
        const preview = info.length ? info.join(' ') : '无操作';
        
        return `
            <div class="friend-item">
                <div class="friend-header" onclick="toggleFriend('${f.gid}')">
                    <span class="name">${f.name}</span>
                    <span class="preview ${info.length?'has-work':''}">${preview}</span>
                </div>
                <div class="friend-actions">
                    <button class="btn btn-sm" onclick="friendQuickOp(event, '${f.gid}', 'steal')">一键偷取</button>
                    <button class="btn btn-sm" onclick="friendQuickOp(event, '${f.gid}', 'water')">一键浇水</button>
                    <button class="btn btn-sm" onclick="friendQuickOp(event, '${f.gid}', 'weed')">一键除草</button>
                    <button class="btn btn-sm" onclick="friendQuickOp(event, '${f.gid}', 'bug')">一键除虫</button>
                    <button class="btn btn-sm" onclick="friendQuickOp(event, '${f.gid}', 'bad')">一键捣乱</button>
                </div>
                <div id="friend-lands-${f.gid}" class="friend-lands" style="display:none">
                    <div style="padding:10px;text-align:center;color:#888"><i class="fas fa-spinner fa-spin"></i> 加载中...</div>
                </div>
            </div>
        `;
    }).join('');
}

window.toggleFriend = async (gid) => {
    const el = document.getElementById(`friend-lands-${gid}`);
    if (el.style.display === 'block') {
        el.style.display = 'none';
        return;
    }
    
    // 收起其他
    document.querySelectorAll('.friend-lands').forEach(e => e.style.display = 'none');
    
    el.style.display = 'block';
    
    const data = await api(`/api/friend/${gid}/lands`);
    if (!data || !data.lands) {
        el.innerHTML = '<div style="padding:10px;text-align:center;color:#F44336">加载失败</div>';
        return;
    }
    
    const statusClass = { empty: 'empty', locked: 'empty', stealable: 'harvestable', harvested: 'empty', dead: 'dead', growing: 'growing' };
    const landTypeNameMap = {
        0: '未解锁',
        1: '黄土地',
        2: '红土地',
        3: '黑土地',
        4: '金土地'
    };
    el.innerHTML = `
        <div class="farm-grid mini">
            ${data.lands.map(l => {
                let cls = statusClass[l.status] || 'empty';
                const landLevel = Number(l.level || 0);
                const landLevelClass = `land-level-${Math.max(0, Math.min(4, landLevel))}`;
                const landTypeName = landTypeNameMap[Math.max(0, Math.min(4, landLevel))] || '土地';
                let phaseText = landLevel <= 0 ? '未解锁' : (l.phaseName || '');
                if (landLevel > 0 && Number(l.matureInSec || 0) > 0) {
                    phaseText = `${phaseText} · ${fmtRemainSec(l.matureInSec)}后成熟`;
                }
                let needs = [];
                if (l.needWater) needs.push('水');
                if (l.needWeed) needs.push('草');
                if (l.needBug) needs.push('虫');
                return `
                    <div class="land-cell ${cls} ${landLevelClass}">
                        <span class="id">#${l.id}</span>
                        <span class="plant-name">${l.plantName || '-'}</span>
                        <span class="phase-name">${phaseText}</span>
                        <span class="land-meta">${landTypeName}</span>
                         ${needs.length ? `<span class="needs">${needs.join(' ')}</span>` : ''}
                    </div>`;
            }).join('')}
        </div>
    `;
};

window.friendQuickOp = async (event, gid, opType) => {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    if (!currentAccountId) return;
    const opMap = { steal: '偷取', water: '浇水', weed: '除草', bug: '除虫', bad: '捣乱' };
    const btn = event && event.currentTarget ? event.currentTarget : null;
    if (btn) btn.disabled = true;
    try {
        const ret = await api(`/api/friend/${gid}/op`, 'POST', { opType });
        if (!ret) {
            alert(`一键${opMap[opType] || '操作'}失败`);
            return;
        }
        if (ret.message) alert(ret.message);
        const landsEl = document.getElementById(`friend-lands-${gid}`);
        if (landsEl && landsEl.style.display === 'block') {
            landsEl.innerHTML = '<div style="padding:10px;text-align:center;color:#888"><i class="fas fa-spinner fa-spin"></i> 刷新中...</div>';
            const data = await api(`/api/friend/${gid}/lands`);
            if (data && data.lands) {
                const statusClass = { empty: 'empty', locked: 'empty', stealable: 'harvestable', harvested: 'empty', dead: 'dead', growing: 'growing' };
                const landTypeNameMap = { 0: '未解锁', 1: '黄土地', 2: '红土地', 3: '黑土地', 4: '金土地' };
                landsEl.innerHTML = `
                    <div class="farm-grid mini">
                        ${data.lands.map(l => {
                            const cls = statusClass[l.status] || 'empty';
                            const landLevel = Number(l.level || 0);
                            const landLevelClass = `land-level-${Math.max(0, Math.min(4, landLevel))}`;
                            const landTypeName = landTypeNameMap[Math.max(0, Math.min(4, landLevel))] || '土地';
                            let phaseText = landLevel <= 0 ? '未解锁' : (l.phaseName || '');
                            if (landLevel > 0 && Number(l.matureInSec || 0) > 0) {
                                phaseText = `${phaseText} · ${fmtRemainSec(l.matureInSec)}后成熟`;
                            }
                            const needs = [];
                            if (l.needWater) needs.push('水');
                            if (l.needWeed) needs.push('草');
                            if (l.needBug) needs.push('虫');
                            return `
                                <div class="land-cell ${cls} ${landLevelClass}">
                                    <span class="id">#${l.id}</span>
                                    <span class="plant-name">${l.plantName || '-'}</span>
                                    <span class="phase-name">${phaseText}</span>
                                    <span class="land-meta">${landTypeName}</span>
                                    ${needs.length ? `<span class="needs">${needs.join(' ')}</span>` : ''}
                                </div>`;
                        }).join('')}
                    </div>
                `;
            }
        }
        loadFriends();
    } finally {
        if (btn) btn.disabled = false;
    }
};

// 种子加载
async function loadSeeds(preferredSeed) {
    if (seedLoadPromise) return seedLoadPromise;
    seedLoadPromise = (async () => {
    const list = await api('/api/seeds');
    const sel = $('seed-select');
    sel.innerHTML = '<option value="0">自动选择 (等级最高)</option>';
    if (list && list.length) {
        list.forEach(s => {
            const o = document.createElement('option');
            o.value = s.seedId;
            const levelText = (s.requiredLevel === null || s.requiredLevel === undefined) ? 'Lv?' : `Lv${s.requiredLevel}`;
            const priceText = (s.price === null || s.price === undefined) ? '价格未知' : `${s.price}金`;
            let text = `${levelText} ${s.name} (${priceText})`;
            if (s.locked) {
                text += ' [未解锁]';
                o.disabled = true;
                o.style.color = '#666';
            } else if (s.soldOut) {
                text += ' [售罄]';
                o.disabled = true;
                o.style.color = '#666';
            }
            o.textContent = text;
            sel.appendChild(o);
        });
    }
    sel.dataset.loaded = '1';
    if (preferredSeed !== undefined && preferredSeed !== null) {
        const preferredVal = String(preferredSeed || 0);
        if (preferredVal !== '0' && !Array.from(sel.options).some(opt => opt.value === preferredVal)) {
            const fallbackOption = document.createElement('option');
            fallbackOption.value = preferredVal;
            fallbackOption.textContent = `种子${preferredVal} (当前不可购买/详情未知)`;
            sel.appendChild(fallbackOption);
        }
        sel.value = preferredVal;
    }
    })().finally(() => {
        seedLoadPromise = null;
    });
    return seedLoadPromise;
}

// 绑定自动化开关
$('fertilizer-select').addEventListener('change', async () => {
    if (!currentAccountId) return;
    queueAutomationUpdate('fertilizer', $('fertilizer-select').value);
});

['auto-farm', 'auto-farm-push', 'auto-land-upgrade', 'auto-friend', 'auto-task', 'auto-sell', 'auto-friend-steal', 'auto-friend-help', 'auto-friend-bad'].forEach((id, i) => {
    // 这里原来的 id 是数组里的元素，key 需要处理
    // id: auto-farm -> key: farm
    // id: auto-friend-steal -> key: friend_steal
    const key = id.replace('auto-', '').replace(/-/g, '_');
    const el = document.getElementById(id);
    if(el) {
        el.addEventListener('change', async () => {
            if (!currentAccountId) return;
            queueAutomationUpdate(key, !!el.checked);
            if (id === 'auto-friend') {
                updateFriendSubControlsState();
            }
        });
    }
});
updateFriendSubControlsState();

$('btn-save-settings').addEventListener('click', async () => {
    const strategy = $('strategy-select').value;
    let farmMin = parseInt($('interval-farm-min').value, 10);
    let farmMax = parseInt($('interval-farm-max').value, 10);
    let friendMin = parseInt($('interval-friend-min').value, 10);
    let friendMax = parseInt($('interval-friend-max').value, 10);
    const seedId = parseInt($('seed-select').value) || 0;
    const friendQuietEnabled = !!$('friend-quiet-enabled').checked;
    const friendQuietStart = $('friend-quiet-start').value || '23:00';
    const friendQuietEnd = $('friend-quiet-end').value || '07:00';

    farmMin = Math.max(1, Number.isFinite(farmMin) ? farmMin : 2);
    farmMax = Math.max(1, Number.isFinite(farmMax) ? farmMax : farmMin);
    if (farmMin > farmMax) {
        alert('农场巡查间隔：最大值不能小于最小值');
        $('interval-farm-max').focus();
        return;
    }

    friendMin = Math.max(1, Number.isFinite(friendMin) ? friendMin : 10);
    friendMax = Math.max(1, Number.isFinite(friendMax) ? friendMax : friendMin);
    if (friendMin > friendMax) {
        alert('好友巡查间隔：最大值不能小于最小值');
        $('interval-friend-max').focus();
        return;
    }

    $('interval-farm-min').value = String(farmMin);
    $('interval-farm-max').value = String(farmMax);
    $('interval-friend-min').value = String(friendMin);
    $('interval-friend-max').value = String(friendMax);
    
    updateRevisionState(await api('/api/settings/save', 'POST', {
        strategy,
        seedId,
        intervals: {
            farm: farmMin,
            friend: friendMin,
            farmMin,
            farmMax,
            friendMin,
            friendMax,
        },
        friendQuietHours: {
            enabled: friendQuietEnabled,
            start: friendQuietStart,
            end: friendQuietEnd,
        }
    }));
    await loadSettings();
    alert('设置已保存');
});

// 加载额外设置
async function loadSettings() {
    const data = await api('/api/settings');
    if (data) {
        if (data.strategy) $('strategy-select').value = data.strategy;
        if (data.intervals) {
            const farmBase = Number(data.intervals.farm || 2);
            const friendBase = Number(data.intervals.friend || 10);
            const farmMin = Number(data.intervals.farmMin || farmBase || 2);
            const farmMax = Number(data.intervals.farmMax || farmMin || 2);
            const friendMin = Number(data.intervals.friendMin || friendBase || 10);
            const friendMax = Number(data.intervals.friendMax || friendMin || 10);
            $('interval-farm-min').value = String(farmMin);
            $('interval-farm-max').value = String(farmMax);
            $('interval-friend-min').value = String(friendMin);
            $('interval-friend-max').value = String(friendMax);
        }
        if (data.preferredSeed !== undefined) {
            const sel = $('seed-select');
            if (currentAccountId && sel.dataset.loaded !== '1') {
                await loadSeeds(data.preferredSeed);
            } else {
                sel.value = String(data.preferredSeed || 0);
            }
        }
        if (data.friendQuietHours) {
            $('friend-quiet-enabled').checked = !!data.friendQuietHours.enabled;
            $('friend-quiet-start').value = data.friendQuietHours.start || '23:00';
            $('friend-quiet-end').value = data.friendQuietHours.end || '07:00';
        }
        if (data.ui && (data.ui.theme === 'light' || data.ui.theme === 'dark')) {
            localStorage.setItem(THEME_STORAGE_KEY, data.ui.theme);
            applyTheme(data.ui.theme);
        }
        const enabled = !!$('friend-quiet-enabled').checked;
        $('friend-quiet-start').disabled = !enabled;
        $('friend-quiet-end').disabled = !enabled;
    }
}

const friendQuietEnabledEl = document.getElementById('friend-quiet-enabled');
if (friendQuietEnabledEl) {
    friendQuietEnabledEl.addEventListener('change', () => {
        const enabled = !!friendQuietEnabledEl.checked;
        $('friend-quiet-start').disabled = !enabled;
        $('friend-quiet-end').disabled = !enabled;
    });
}

async function loadBag() {
    const listEl = $('bag-list');
    const sumEl = $('bag-summary');
    if (!listEl || !sumEl) return;
    if (!currentAccountId) {
        sumEl.textContent = '请选择账号';
        listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#666">请选择账号后查看背包</div>';
        return;
    }
    sumEl.textContent = '加载中...';
    listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#888"><i class="fas fa-spinner fa-spin"></i> 加载中...</div>';
    const data = await api('/api/bag');
    const items = data && Array.isArray(data.items) ? data.items : [];
    sumEl.textContent = `共 ${Number(data && data.totalKinds || items.length)} 种物品`;
    if (!items.length) {
        listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#666">背包为空</div>';
        return;
    }
    listEl.innerHTML = items.map(it => `
      <div class="bag-item">
        <div class="name">${escapeHtml(String(it.name || ('物品' + (it.id || ''))))}</div>
        <div class="meta">ID: ${Number(it.id || 0)}${it.uid ? ` · UID: ${Number(it.uid)}` : ''}</div>
        <div class="meta">类型: ${Number(it.itemType || 0)}${Number(it.level || 0) > 0 ? ` · 等级: ${Number(it.level)}` : ''}${Number(it.price || 0) > 0 ? ` · 价格: ${Number(it.price)}` : ''}</div>
        ${it.hoursText
            ? `<div class="count" style="color:var(--primary)">${escapeHtml(String(it.hoursText))}</div>`
            : `<div class="count">x${Number(it.count || 0)}</div>`}
      </div>
    `).join('');
}

// ============ UI 交互 ============
// 导航切换
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
        e.preventDefault();
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        item.classList.add('active');
        const pageId = 'page-' + item.dataset.page;
        const page = document.getElementById(pageId);
        if (page) page.classList.add('active');
        
        $('page-title').textContent = item.textContent.trim();
        if (item.dataset.page === 'dashboard') renderOpsList(lastOperationsData);
        
        if (item.dataset.page === 'farm') loadFarm();
        if (item.dataset.page === 'bag') loadBag();
        if (item.dataset.page === 'friends') loadFriends();
        if (item.dataset.page === 'analytics') loadAnalytics();
        if (item.dataset.page === 'settings') loadSettings();
        if (item.dataset.page === 'accounts') {
            renderAccountManager();
            pollAccountLogs();
        }
    });
});

// 数据分析
async function loadAnalytics() {
    const container = $('analytics-list');
    if (!container) return;
    container.innerHTML = '<div style="padding:20px;text-align:center;color:#888"><i class="fas fa-spinner fa-spin"></i> 加载中...</div>';
    
    const sort = $('analytics-sort').value;
    const list = await api(`/api/analytics?sort=${sort}`);
    
    if (!list || !list.length) {
        container.innerHTML = '<div style="padding:24px;text-align:center;color:#666;font-size:16px">暂无数据</div>';
        return;
    }

    // 前端兜底：始终按当前指标倒序显示
    const metricMap = {
        exp: 'expPerHour',
        fert: 'normalFertilizerExpPerHour',
        profit: 'profitPerHour',
        fert_profit: 'normalFertilizerProfitPerHour',
        level: 'level',
    };
    const metric = metricMap[sort];
    if (metric) {
        list.sort((a, b) => {
            const av = Number(a && a[metric]);
            const bv = Number(b && b[metric]);
            if (!Number.isFinite(av) && !Number.isFinite(bv)) return 0;
            if (!Number.isFinite(av)) return 1;
            if (!Number.isFinite(bv)) return -1;
            return bv - av;
        });
    }
    
    // 表格头
    let html = `
    <table style="width:100%;border-collapse:collapse;color:var(--text-main)">
        <thead>
            <tr style="border-bottom:1px solid var(--border);text-align:left;color:var(--text-sub)">
                <th>作物 (Lv)</th>
                <th>时间</th>
                <th>经验/时</th>
                <th>普通肥经验/时</th>
                <th>净利润/时</th>
                <th>普通肥净利润/时</th>
            </tr>
        </thead>
        <tbody>
    `;
    
    list.forEach((item, index) => {
        const lvText = (item.level === null || item.level === undefined || item.level === '' || Number(item.level) < 0)
            ? '未知'
            : String(item.level);
        html += `
            <tr style="border-bottom:1px solid var(--border);">
                <td>
                    <div>${item.name}</div>
                    <div style="font-size:13px;color:var(--text-sub)">Lv${lvText}</div>
                </td>
                <td>${item.growTimeStr}</td>
                <td style="font-weight:bold;color:var(--accent)">${item.expPerHour}</td>
                <td style="font-weight:bold;color:var(--primary)">${item.normalFertilizerExpPerHour ?? '-'}</td>
                <td style="font-weight:bold;color:#f0b84f">${item.profitPerHour ?? '-'}</td>
                <td style="font-weight:bold;color:#74d39a">${item.normalFertilizerProfitPerHour ?? '-'}</td>
            </tr>
        `;
    });
    
    html += '</tbody></table>';
    container.innerHTML = html;
}

$('analytics-sort').addEventListener('change', loadAnalytics);

// 农场操作
window.doFarmOp = async (type) => {
    if (!currentAccountId) return;
    if (confirm('确定执行此操作吗?')) {
        await api('/api/farm/operate', 'POST', { opType: type });
        loadFarm(); // 刷新
    }
};

// 任务列表相关代码已删除

// 账号管理页面
function renderAccountManager() {
    const wrap = $('accounts-list');
    const summary = $('account-summary');
    if (summary) summary.textContent = `共 ${accounts.length} 个账号`;
    wrap.innerHTML = accounts.map(a => `
        <div class="acc-item">
            <div class="name">${a.name}</div>
            <div class="acc-actions">
                ${a.running 
                    ? `<button class="btn acc-btn acc-btn-stop" onclick="stopAccount('${a.id}')">停止</button>`
                    : `<button class="btn btn-primary acc-btn" onclick="startAccount('${a.id}')">启动</button>`
                }
                <button class="btn btn-primary acc-btn" onclick="editAccount('${a.id}')">编辑</button>
                <button class="btn acc-btn acc-btn-danger" onclick="deleteAccount('${a.id}')">删除</button>
            </div>
        </div>
    `).join('');
}

async function pollAccountLogs() {
    return runDedupedRequest('pollAccountLogs', async () => {
        const wrap = $('account-logs-list');
        if (!wrap) return;
        const list = await api('/api/account-logs?limit=100');
        const normalized = Array.isArray(list) ? list : [];
        if (!normalized.length) {
            lastAccountLogsRenderKey = '';
            wrap.innerHTML = '<div class="log-row">暂无账号日志</div>';
            return;
        }
        const renderKey = JSON.stringify(normalized.map(l => [l.time, l.action, l.msg, l.reason || '']));
        if (renderKey === lastAccountLogsRenderKey) return;
        lastAccountLogsRenderKey = renderKey;
        wrap.innerHTML = normalized.slice().reverse().map(l => {
            const actionMap = {
                add: '添加',
                update: '更新',
                delete: '删除',
                kickout_delete: '踢下线删除',
            };
            const action = actionMap[l.action] || l.action || '操作';
            const timeStr = ((l.time || '').split(' ')[1] || (l.time || ''));
            const reason = l.reason ? ` (原因: ${escapeHtml(String(l.reason))})` : '';
            return `<div class="log-row">
                <span class="log-time">${escapeHtml(timeStr)}</span>
                <span class="log-tag">[${action}]</span>
                <span class="log-msg">${escapeHtml(l.msg || '')}${reason}</span>
            </div>`;
        }).join('');
    });
}

window.startAccount = async (id) => {
    await api(`/api/accounts/${id}/start`, 'POST');
    loadAccounts();
    pollAccountLogs();
    setTimeout(loadAccounts, 1000);
};

window.stopAccount = async (id) => {
    await api(`/api/accounts/${id}/stop`, 'POST');
    loadAccounts();
    pollAccountLogs();
    setTimeout(loadAccounts, 1000);
};

// 模态框逻辑
const modal = $('modal-add-acc');
