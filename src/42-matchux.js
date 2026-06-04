// ============================================================================
//  42-matchux.js  —  Maç UX: olay akışı (A1), gol/olay animasyonu (A2),
//  maç-içi istatistik (A3), maç hızı (A4). 40-match.js'ten SONRA yüklenir.
//  Tüm yeni mantık burada; 05-core/40-match'e sadece çağrı enjekte edilir.
// ============================================================================

// ---- A4: Maç hızı ----
const MATCH_SPEED = { slow: 2400, normal: 1400, fast: 600 };
function currentSpeedMs() {
    const k = (gameState.settings && gameState.settings.matchSpeed) || 'normal';
    return MATCH_SPEED[k] || 1400;
}
function setMatchSpeed(key) {
    if (!MATCH_SPEED[key]) return;
    if (!gameState.settings) gameState.settings = {};
    gameState.settings.matchSpeed = key;
    document.querySelectorAll('.match-speed-btn').forEach(b => b.classList.toggle('active', b.dataset.speed === key));
    // Çalışan ticker'ı yeni hızla yeniden başlat (karar/devre arası/duraklama yoksa)
    const decisionOpen = (document.getElementById('match-decision-box') || {}).style && document.getElementById('match-decision-box').style.display !== 'none';
    if (activeMatch && activeMatch.timerId && !activeMatch.isPaused && !activeMatch.isHalfTime && !activeMatch.isSubbedOut
        && !decisionOpen && activeMatch.minute < 90 && typeof runMatchTicker === 'function') {
        clearInterval(activeMatch.timerId);
        runMatchTicker();
    }
}

// ---- A1: Maç olayları akışı ----
const EVENT_META = {
    goal: { icon: 'fa-futbol', cls: 'ev-goal', label: 'Gol' },
    assist: { icon: 'fa-handshake-angle', cls: 'ev-assist', label: 'Asist' },
    yellow: { icon: 'fa-square', cls: 'ev-yellow', label: 'Sarı Kart' },
    red: { icon: 'fa-square', cls: 'ev-red', label: 'Kırmızı Kart' },
    'penalty-scored': { icon: 'fa-bullseye', cls: 'ev-goal', label: 'Penaltı Gol' },
    'penalty-missed': { icon: 'fa-ban', cls: 'ev-miss', label: 'Penaltı Kaçtı' },
    injury: { icon: 'fa-kit-medical', cls: 'ev-injury', label: 'Sakatlık' },
    sub: { icon: 'fa-right-left', cls: 'ev-sub', label: 'Değişiklik' },
    save: { icon: 'fa-hand-fist', cls: 'ev-save', label: 'Kurtarış' },
};
function pushMatchEvent(ev) {
    if (!activeMatch.events) activeMatch.events = [];
    ev.minute = (ev.minute != null) ? ev.minute : activeMatch.minute;
    activeMatch.events.push(ev);
    renderMatchEvents();
    if (ev.type === 'goal' || ev.type === 'penalty-scored') triggerGoalFx(ev.team);
    else triggerEventFx(ev.type);
}
function renderMatchEvents() {
    const box = document.getElementById('match-events-log');
    if (!box) return;
    const evs = activeMatch.events || [];
    if (!evs.length) { box.innerHTML = `<div class="me-empty">Henüz önemli bir olay yok.</div>`; return; }
    box.innerHTML = evs.slice(-30).reverse().map(ev => {
        const m = EVENT_META[ev.type] || EVENT_META.save;
        // Olay tarafı EV/DEPLASMAN'a göre (skor tablosuyla tutarlı): ev sahibi solda, deplasman sağda.
        // ev.team 'MY'/'OPP'; kullanıcı deplasmandaysa 'MY' olaylar SAĞDA görünür.
        const evIsHome = (ev.team === 'MY') ? !!activeMatch.isHome : !activeMatch.isHome;
        const side = evIsHome ? 'me-left' : 'me-right';
        const who = ev.type === 'sub'
            ? `<span class="me-sub"><span class="me-in">▲ ${ev.subIn || ''}</span> <span class="me-out">▼ ${ev.subOut || ''}</span></span>`
            : `<span class="me-name">${ev.playerName || ''}</span>`;
        return `<div class="match-event-row ${side} ${m.cls}">
            <span class="me-min">${ev.minute}'</span>
            <i class="fa-solid ${m.icon} me-icon"></i>
            <span class="me-body"><span class="me-label">${m.label}</span> ${who}</span>
        </div>`;
    }).join('');
}

// ---- A3: Maç-içi istatistikler (sentetik, tutarlı) ----
function initMatchStats() {
    activeMatch.teamStats = {
        MY: { shots: 0, shotsOnTarget: 0, corners: 0, fouls: 0, yellows: 0, offsides: 0, possession: 50 },
        OPP: { shots: 0, shotsOnTarget: 0, corners: 0, fouls: 0, yellows: 0, offsides: 0, possession: 50 },
    };
}
function bumpStat(team, key, n) {
    if (!activeMatch.teamStats) initMatchStats();
    if (activeMatch.teamStats[team] && activeMatch.teamStats[team][key] != null)
        activeMatch.teamStats[team][key] += (n || 1);
}
function recomputePossession() {
    if (!activeMatch.teamStats) initMatchStats();
    const my = (activeMatch.myTeam && activeMatch.myTeam.power) || 70;
    const op = (activeMatch.oppTeam && activeMatch.oppTeam.power) || 70;
    let base = Math.round(50 + (my - op) * 0.6);
    base = Math.max(32, Math.min(68, base));
    activeMatch.teamStats.MY.possession = base;
    activeMatch.teamStats.OPP.possession = 100 - base;
}
function renderMatchStats() {
    const panel = document.getElementById('match-stats-panel');
    if (!panel || !activeMatch.teamStats) return;
    const rows = [
        ['Topla Oynama %', 'possession'], ['Şut', 'shots'], ['İsabetli Şut', 'shotsOnTarget'],
        ['Korner', 'corners'], ['Faul', 'fouls'], ['Sarı Kart', 'yellows'], ['Ofsayt', 'offsides'],
    ];
    const my = activeMatch.teamStats.MY, op = activeMatch.teamStats.OPP;
    panel.innerHTML = rows.map(([lbl, k]) => {
        const a = my[k], b = op[k], tot = (a + b) || 1;
        return `<div class="ms-row">
            <span class="ms-val">${a}</span>
            <div class="ms-bar"><span class="ms-fill-my" style="width:${a / tot * 100}%"></span><span class="ms-fill-op" style="width:${b / tot * 100}%"></span></div>
            <span class="ms-val">${b}</span>
            <span class="ms-lbl">${lbl}</span>
        </div>`;
    }).join('');
}

// ---- A2: Görsel animasyonlar ----
function triggerGoalFx(team) {
    const score = document.getElementById('match-score');
    if (score) { score.classList.remove('score-pop'); void score.offsetWidth; score.classList.add('score-pop'); }
    const sb = document.querySelector('.match-scoreboard');
    if (sb) { const cls = team === 'MY' ? 'goal-flash-my' : 'goal-flash-op'; sb.classList.add(cls); setTimeout(() => sb.classList.remove(cls), 1100); }
    let ov = document.getElementById('goal-fx-overlay');
    if (!ov) { ov = document.createElement('div'); ov.id = 'goal-fx-overlay'; const ms = document.getElementById('matchday-screen'); if (ms) ms.appendChild(ov); }
    if (ov) { ov.textContent = team === 'MY' ? 'GOL!' : 'Gol...'; ov.className = team === 'MY' ? 'goal-fx-show' : 'goal-fx-show op'; setTimeout(() => ov.className = '', 1000); }
}
function triggerEventFx(type) {
    const map = { yellow: '#ffca28', red: '#ef5350', injury: '#ff9800', sub: '#42a5f5', save: '#00b0ff', 'penalty-missed': '#ff9800' };
    const color = map[type]; if (!color) return;
    const sb = document.querySelector('.match-scoreboard'); if (!sb) return;
    sb.style.setProperty('--ev-color', color);
    sb.classList.add('event-pulse'); setTimeout(() => sb.classList.remove('event-pulse'), 650);
}

// İlk render + reset (startMatchDay'den çağrılır)
function resetMatchUX() {
    activeMatch.events = [];
    initMatchStats();
    recomputePossession();
    renderMatchEvents();
    renderMatchStats();
    document.querySelectorAll('.match-speed-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.speed === ((gameState.settings && gameState.settings.matchSpeed) || 'normal')));
}

window.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.match-speed-btn').forEach(b => {
        if (b._bound) return; b._bound = true;
        b.addEventListener('click', () => setMatchSpeed(b.dataset.speed));
    });
});

if (typeof window !== 'undefined') {
    Object.assign(window, {
        MATCH_SPEED, currentSpeedMs, setMatchSpeed, pushMatchEvent, renderMatchEvents,
        initMatchStats, bumpStat, recomputePossession, renderMatchStats,
        triggerGoalFx, triggerEventFx, resetMatchUX,
    });
}
