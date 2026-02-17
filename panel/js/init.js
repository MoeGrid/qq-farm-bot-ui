function updateUptimeDisplay() {
    if (lastSyncTimestamp > 0) {
        const elapsed = (Date.now() - lastSyncTimestamp) / 1000;
        const currentUptime = lastServerUptime + elapsed;
        const el = $('stat-uptime');
        if (el) el.textContent = fmtTime(currentUptime);
    }
}

function updateTime() {
    const now = new Date();
    const el = document.getElementById('sys-time');
    if (el) el.textContent = now.toLocaleTimeString();
}
setInterval(() => {
    updateTime();
    updateUptimeDisplay();
}, 1000);
updateTime();
lockHorizontalSwipeOnMobile();
applyFontScale();
window.addEventListener('resize', applyFontScale);
window.addEventListener('resize', syncOpsRowsMode);
updateTopbarAccount(null);
initTheme();

// 初始化
$('btn-refresh').addEventListener('click', () => { window.location.reload(); });

$('btn-theme').addEventListener('click', () => {
    const isLight = !document.body.classList.contains('light-theme');
    const mode = isLight ? 'light' : 'dark';
    applyTheme(mode);
    localStorage.setItem(THEME_STORAGE_KEY, mode);
    if (isLoggedIn) {
        api('/api/settings/theme', 'POST', { theme: mode });
    }
});

const loginBtn = $('btn-login');
if (loginBtn) loginBtn.addEventListener('click', doLogin);
const loginInput = $('login-password');
if (loginInput) {
    loginInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doLogin();
    });
}

const logsFilterSel = $('logs-account-filter');
if (logsFilterSel) {
    logsFilterSel.value = logFilterAccountId;
    logsFilterSel.addEventListener('change', () => {
        logFilterAccountId = logsFilterSel.value || 'all';
        localStorage.setItem('logFilterAccountId', logFilterAccountId);
        pollLogs();
    });
}

const logsModuleSel = $('logs-module-filter');
if (logsModuleSel) {
    logsModuleSel.value = logFilters.module;
    logsModuleSel.addEventListener('change', () => {
        logFilters.module = logsModuleSel.value || '';
        localStorage.setItem('logFilterModule', logFilters.module);
        pollLogs();
    });
}

const logsWarnSel = $('logs-warn-filter');
if (logsWarnSel) {
    logsWarnSel.value = logFilters.isWarn;
    logsWarnSel.addEventListener('change', () => {
        logFilters.isWarn = logsWarnSel.value || '';
        localStorage.setItem('logFilterIsWarn', logFilters.isWarn);
        pollLogs();
    });
}

const logsEventInput = $('logs-event-filter');
if (logsEventInput) {
    logsEventInput.value = logFilters.event;
    logsEventInput.addEventListener('change', () => {
        logFilters.event = logsEventInput.value.trim();
        localStorage.setItem('logFilterEvent', logFilters.event);
        pollLogs();
    });
}

const logsKeywordInput = $('logs-keyword-filter');
if (logsKeywordInput) {
    logsKeywordInput.value = logFilters.keyword;
    let keywordTimer = null;
    const onKeywordChange = () => {
        if (keywordTimer) clearTimeout(keywordTimer);
        keywordTimer = setTimeout(() => {
            logFilters.keyword = logsKeywordInput.value.trim();
            localStorage.setItem('logFilterKeyword', logFilters.keyword);
            pollLogs();
        }, 250);
    };
    logsKeywordInput.addEventListener('input', onKeywordChange);
    logsKeywordInput.addEventListener('change', onKeywordChange);
}

const logsTimeFromInput = $('logs-time-from-filter');
if (logsTimeFromInput) {
    logsTimeFromInput.value = logFilters.timeFrom;
    logsTimeFromInput.addEventListener('change', () => {
        logFilters.timeFrom = logsTimeFromInput.value || '';
        localStorage.setItem('logFilterTimeFrom', logFilters.timeFrom);
        pollLogs();
    });
}

const logsTimeToInput = $('logs-time-to-filter');
if (logsTimeToInput) {
    logsTimeToInput.value = logFilters.timeTo;
    logsTimeToInput.addEventListener('change', () => {
        logFilters.timeTo = logsTimeToInput.value || '';
        localStorage.setItem('logFilterTimeTo', logFilters.timeTo);
        pollLogs();
    });
}

initLogFiltersUI();

checkLogin();
