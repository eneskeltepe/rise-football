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

// ---- Kompakt maç kontrolleri (NSS tarzı: tek buton, tıkla→döngü) — hız / efor / anlatım sağ-üstte ----
const _SPEED_CYCLE = ['slow', 'normal', 'fast'];
const _SPEED_META = { slow: { i: 'fa-backward-step', l: 'Yavaş' }, normal: { i: 'fa-play', l: 'Normal' }, fast: { i: 'fa-forward', l: 'Hızlı' } };
const _EFFORT_CYCLE = ['low', 'normal', 'high'];
const _EFFORT_META = { low: { i: 'fa-battery-quarter', l: 'Rölanti' }, normal: { i: 'fa-battery-half', l: 'Standart' }, high: { i: 'fa-battery-full', l: 'Pres' } };
function _cycleMatchSpeed() {
    const cur = (gameState.settings && gameState.settings.matchSpeed) || 'normal';
    setMatchSpeed(_SPEED_CYCLE[(_SPEED_CYCLE.indexOf(cur) + 1) % 3]);
    syncQuickControls();
}
function _cycleEffort() {
    if (typeof activeMatch === 'undefined' || !activeMatch) return;
    const cur = activeMatch.effortLevel || 'normal';
    activeMatch.effortLevel = _EFFORT_CYCLE[(_EFFORT_CYCLE.indexOf(cur) + 1) % 3];
    if (typeof showToast === 'function') showToast(`Efor: ${_EFFORT_META[activeMatch.effortLevel].l}`, 'info');
    syncQuickControls();
}
function _toggleCommentary() {
    if (!gameState.settings) gameState.settings = {};
    gameState.settings.commentaryOn = !gameState.settings.commentaryOn;
    syncQuickControls();
}
function syncQuickControls() {
    const sp = (gameState.settings && gameState.settings.matchSpeed) || 'normal';
    const spB = document.getElementById('mqc-speed');
    if (spB && _SPEED_META[sp]) spB.innerHTML = `<i class="fa-solid ${_SPEED_META[sp].i}"></i><span>${_SPEED_META[sp].l}</span>`;
    const ef = (typeof activeMatch !== 'undefined' && activeMatch && activeMatch.effortLevel) || 'normal';
    const efB = document.getElementById('mqc-effort');
    if (efB && _EFFORT_META[ef]) efB.innerHTML = `<i class="fa-solid ${_EFFORT_META[ef].i}"></i><span>${_EFFORT_META[ef].l}</span>`;
    const on = !!(gameState.settings && gameState.settings.commentaryOn);
    const panel = document.querySelector('.match-commentary-panel');
    if (panel) panel.style.display = on ? '' : 'none';
    const cB = document.getElementById('mqc-commentary');
    if (cB) cB.classList.toggle('active', on);
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
            : `<span class="me-name me-name-click" data-pname="${(ev.playerName || '').replace(/"/g, '&quot;')}" data-team="${ev.team || ''}">${ev.playerName || ''}</span>`;
        return `<div class="match-event-row ${side} ${m.cls}">
            <span class="me-min">${ev.minute}'</span>
            <i class="fa-solid ${m.icon} me-icon"></i>
            <span class="me-body"><span class="me-label">${m.label}</span> ${who}</span>
        </div>`;
    }).join('');
}
// Maç olayındaki oyuncu adına tıkla → profilini aç (isimle çöz: kullanıcı / lineup oyuncusu).
function _openEventPlayer(name, team) {
    if (!name || typeof openPlayerProfile !== 'function') return;
    const u = (typeof gameState !== 'undefined') ? gameState.player : null;
    if (u && name === `${u.firstname} ${u.lastname}`) { openPlayerProfile('USER', u.teamId); return; }
    if (typeof matchLineups === 'undefined' || !matchLineups || typeof activeMatch === 'undefined' || !activeMatch) return;
    const teamId = team === 'OPP' ? (activeMatch.oppTeam && activeMatch.oppTeam.id) : (activeMatch.myTeam && activeMatch.myTeam.id);
    let found = null;
    for (const k in matchLineups) {
        const arr = matchLineups[k];
        if (Array.isArray(arr)) { const f = arr.find(p => p && p.name === name && !p.isUser); if (f) { found = f; break; } }
    }
    if (found && found.pid != null && String(found.pid).indexOf('fic_') !== 0) openPlayerProfile(found.pid, teamId);
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
    // Kompakt kontroller (hız/efor/anlatım) — tek sefer bağla
    const _bind = (id, fn) => { const el = document.getElementById(id); if (el && !el._bound) { el._bound = true; el.addEventListener('click', fn); } };
    _bind('mqc-speed', _cycleMatchSpeed); _bind('mqc-effort', _cycleEffort); _bind('mqc-commentary', _toggleCommentary);
    // Maç olaylarında oyuncu adına tıkla → profil (delegasyon, tek sefer)
    const _evBox = document.getElementById('match-events-log');
    if (_evBox && !_evBox._evBound) { _evBox._evBound = true; _evBox.addEventListener('click', e => { const el = e.target.closest('.me-name-click'); if (el) _openEventPlayer(el.getAttribute('data-pname'), el.getAttribute('data-team')); }); }
    syncQuickControls();
});

if (typeof window !== 'undefined') {
    Object.assign(window, {
        MATCH_SPEED, currentSpeedMs, setMatchSpeed, pushMatchEvent, renderMatchEvents,
        initMatchStats, bumpStat, recomputePossession, renderMatchStats,
        triggerGoalFx, triggerEventFx, resetMatchUX, syncQuickControls,
    });
}
