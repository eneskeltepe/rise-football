// ============================================================================
//  15-calendar.js  —  Gün-bazlı takvim katmanı (hafta çekirdeğini KORUR).
//  gameState.gameDate = sezon başından bu yana geçen gün (0-based).
//  Değişmez kontrat: dayToWeek(gameDate) === currentWeek. Böylece mevcut tüm
//  hafta-indeks tabanlı kod (standings, fixtures[week-1], euro week) dokunulmaz.
//  "İlerle" gün gün ilerler, sonraki maça/olaya kadar gider, kullanıcı durabilir.
// ============================================================================

const CAL_MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const CAL_DAYS = ["Pzr", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const LEAGUE_DAY_OFFSET = 5;   // lig maçı: hafta içinde Cmt'ye yakın
const CUP_DAY_OFFSET = 2;      // kupa maçı: hafta ortası (lig ile çakışmaz)

function weekToDay(week) { return (Math.max(1, week) - 1) * 7; }
function dayToWeek(day) { return Math.floor((day || 0) / 7) + 1; }

function calDateOf(dayOffset) {
    const base = (gameState.seasonStartDate || '2026-08-08').split('-').map(Number);
    const d = new Date(base[0], (base[1] || 8) - 1, base[2] || 8);
    d.setDate(d.getDate() + (dayOffset || 0));
    return d;
}
function calFormat(dayOffset, withWeekday) {
    const d = calDateOf(dayOffset);
    const s = `${d.getDate()} ${CAL_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    return withWeekday ? `${CAL_DAYS[d.getDay()]}, ${s}` : s;
}

function fixtureDay(week, isCup) { return weekToDay(week) + (isCup ? CUP_DAY_OFFSET : LEAGUE_DAY_OFFSET); }
function euroMatchDay(fx) { return weekToDay(fx.week) + (fx.dayOffset != null ? fx.dayOffset : CUP_DAY_OFFSET); }

// gameDate'i içinde bulunulan haftanın başına sabitle (drift düzeltme)
function _syncCalendarToWeek() {
    const wkStart = weekToDay(gameState.currentWeek || 1);
    if ((gameState.gameDate || 0) < wkStart) gameState.gameDate = wkStart;
    if ((gameState.gameDate || 0) >= wkStart + 7) gameState.gameDate = wkStart;
}

// Bu gün oynanacak (henüz oynanmamış) kullanıcı maçı var mı? -> {kind, ...} | null
function matchToday(day) {
    day = (day != null) ? day : (gameState.gameDate || 0);
    const p = gameState.player;
    if (!p || !p.teamId) return null;
    const wk = dayToWeek(day);
    // Kupa (daha erken gün — çakışmada önce oynanır)
    if (typeof euroFixtureDueThisWeek === 'function') {
        const due = euroFixtureDueThisWeek();
        if (due && due.fx && !due.fx.played && euroMatchDay(due.fx) === day) return { kind: 'cup', due };
    }
    // Lig
    const m = (gameState.fixtures[wk - 1] || []).find(x => !x.isBay && (x.home === p.teamId || x.away === p.teamId) && x.scoreHome === null);
    if (m && fixtureDay(wk, false) === day) return { kind: 'league', m };
    return null;
}

// Bugünden sonraki ilk maç gününe kaç gün (antrenman/dinlenme için)
function daysUntilNextMatch() {
    const today = gameState.gameDate || 0;
    for (let d = today; d < today + 60; d++) { if (matchToday(d)) return d - today; }
    return 99;
}

// ---- "İlerle": gün gün ilerle; sonraki maça/olaya kadar; hafta sınırında advanceWeek ----
// mode: 'one' = tek gün, 'event' = sonraki maça/olaya kadar
function advanceDay(mode) {
    const p = gameState.player;
    if (!p) { if (typeof advanceWeek === 'function') advanceWeek(); return; }
    if (matchToday(gameState.gameDate)) return;   // bugün maç var: önce oyna
    const _fitStart = gameState.gameDate || 0;
    let guard = 0;
    while (guard++ < 400) {
        const curW = dayToWeek(gameState.gameDate);
        const nextW = dayToWeek((gameState.gameDate || 0) + 1);
        if (nextW > curW) {
            const before = gameState.currentWeek;
            advanceWeek();                       // dünya sim + currentWeek++ (+sezon sonu) + gameDate senkron (advanceWeek içinde)
            if (gameState.currentWeek === before) return;   // sezon sonu modalı açıldı
        } else {
            gameState.gameDate = (gameState.gameDate || 0) + 1;
        }
        if (matchToday(gameState.gameDate)) break;
        if (mode === 'one') break;
    }
    // N2: geçen günlerde kadro kondisyonu kademeli iyileşir (yorgun oyuncular toparlanır)
    if (typeof recoverSquadFitness === 'function') { const _d = (gameState.gameDate || 0) - _fitStart; if (_d > 0) recoverSquadFitness(_d); }
    saveGame();
    if (typeof updateUI === 'function') updateUI();
}

// ---- Dashboard takvim şeridi (içinde bulunulan hafta) ----
function renderCalendarStrip() {
    const host = document.getElementById('calendar-strip');
    if (!host || !gameState.player) return;
    const wk = gameState.currentWeek || 1;
    const wkStart = weekToDay(wk);
    const today = gameState.gameDate || 0;
    const p = gameState.player;
    const lm = (gameState.fixtures[wk - 1] || []).find(x => !x.isBay && (x.home === p.teamId || x.away === p.teamId));
    const lDay = lm ? fixtureDay(wk, false) : -1;
    let cDay = -1, cOpp = null;
    if (typeof euroFixtureDueThisWeek === 'function') {
        const due = euroFixtureDueThisWeek();
        if (due && due.fx && due.fx.week === wk) { cDay = euroMatchDay(due.fx); cOpp = due.fx.oppId; }
    }
    let html = '';
    for (let i = 0; i < 7; i++) {
        const d = wkStart + i;
        const isToday = d === today;
        let cls = 'cal-day', mark = '';
        if (d === lDay && lm) {
            const oppId = lm.home === p.teamId ? lm.away : lm.home;
            cls += lm.scoreHome !== null ? ' done' : ' match';
            mark = `<span class="cal-mk">${getTeamLogoHtml(oppId, 22)}</span>`;
        } else if (d === cDay && cOpp) {
            cls += ' cup';
            mark = `<span class="cal-mk">${getTeamLogoHtml(cOpp, 22)}</span><span class="cal-cup">K</span>`;
        }
        if (isToday) cls += ' today';
        const dd = calDateOf(d);
        html += `<div class="${cls}" title="${calFormat(d, true)}"><span class="cal-dow">${CAL_DAYS[dd.getDay()]}</span><span class="cal-num">${dd.getDate()}</span>${mark}</div>`;
    }
    host.innerHTML = html;
}

if (typeof window !== 'undefined') {
    Object.assign(window, {
        weekToDay, dayToWeek, calDateOf, calFormat, fixtureDay, euroMatchDay,
        matchToday, daysUntilNextMatch, advanceDay, _syncCalendarToWeek, renderCalendarStrip,
    });
}
