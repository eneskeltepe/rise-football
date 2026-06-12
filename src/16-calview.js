// ============================================================================
//  16-calview.js  —  TAM TAKVİM EKRANI (PES/FIFA tarzı ay görünümü).
//  15-calendar'ın gün modeli üzerine: ay ay gezilebilir grid — GEÇMİŞ (oynanan
//  maçlar matchLog'dan, skor/reyting ile), BUGÜN, GELECEK (bu sezonun gerçek
//  fikstürü; sonraki sezonlar iskelet — fikstür terfi/küme düşme netleşince
//  belli olur). Güne tıkla → detay + "Bu güne kadar simüle et" (17-simto).
//  Kulüpsüzken: maç yok → dünya gündemi (transfer haberleri + önemli skorlar).
//  Antrenman planlayıcı (ileriki dalga) gün-detay yapısına eklenecek şekilde
//  tasarlandı (_calSeasonEvents gün → olay listesi döndürür).
// ============================================================================

let _calCur = null;   // gösterilen ay {y, m}

// ---- Sezon ↔ gerçek tarih eşlemesi (her sezon 8 Ağustos'ta başlar) ----
function _calSeasonStart(season) { return new Date(season, 7, 8); }
function _calSeasonOfDate(d) { return (d.getMonth() > 7 || (d.getMonth() === 7 && d.getDate() >= 8)) ? d.getFullYear() : d.getFullYear() - 1; }
function _calDayIdx(season, d) { return Math.round((d - _calSeasonStart(season)) / 86400000); }
function _calDateOf2(season, day) { const d = _calSeasonStart(season); d.setDate(d.getDate() + (day || 0)); return d; }
function _calSeasonLabel(s) { return `${s}/${String((s + 1) % 100).padStart(2, '0')}`; }

// ---- Pencere: hafta → yaz/kış (52-market kuralının saf hali) ----
function _calWindowForWeek(wk, tot) {
    tot = tot || 38;
    if (wk >= 1 && wk <= 4) return 'summer';
    const mid = Math.round(tot * 0.5);
    if (wk >= mid - 1 && wk <= mid + 1) return 'winter';
    return null;
}

// ---- Bir sezonun gün → olay haritası ----
// Dönen olay: {type:'league'|'cup', played, oppId?, home?, sh?, sa?, comp?, rating?, g?, a?, myTeam?}
function _calSeasonEvents(season) {
    const p = gameState.player;
    const ev = {};
    if (!p) return ev;
    const add = (day, e) => { (ev[day] = ev[day] || []).push(e); };
    const cur = gameState.currentSeason;
    if (season === cur && p.teamId) {
        // Bu sezonun GERÇEK fikstürü (aktif lig) + kupa kampanyası
        (gameState.fixtures || []).forEach((wkArr, wi) => {
            const m = (wkArr || []).find(x => !x.isBay && (x.home === p.teamId || x.away === p.teamId));
            if (m) add(fixtureDay(wi + 1, false), {
                type: 'league', played: m.scoreHome !== null, home: m.home === p.teamId,
                oppId: m.home === p.teamId ? m.away : m.home, sh: m.scoreHome, sa: m.scoreAway, hId: m.home, aId: m.away,
            });
        });
        const e = gameState.euro;
        if (e && !e.done) {
            (e.myLp || []).forEach(fx => add(euroMatchDay(fx), { type: 'cup', played: !!fx.played, home: !!fx.home, oppId: fx.oppId, sh: fx.gf, sa: fx.ga, comp: e.compName }));
            (e.ko || []).forEach(rd => (rd.legs || []).forEach(leg => {
                if (leg.week != null) add(euroMatchDay(leg), { type: 'cup', played: !!leg.played, home: !!leg.home, oppId: leg.oppId, sh: leg.gf, sa: leg.ga, comp: e.compName, round: rd.round });
            }));
        }
    } else if (season < cur) {
        // GEÇMİŞ: kullanıcının oynadığı/kadrosunda olduğu maçlar (matchLog arşivi)
        (p.matchLog || []).filter(l => l.season === season).forEach(l => {
            const day = weekToDay(l.week) + (l.comp ? CUP_DAY_OFFSET : LEAGUE_DAY_OFFSET);
            const my = l.myTeam || null;
            add(day, {
                type: l.comp ? 'cup' : 'league', played: true, comp: l.comp || null,
                home: my ? l.home === my : true, oppId: my ? (l.home === my ? l.away : l.home) : l.away,
                sh: l.sh, sa: l.sa, hId: l.home, aId: l.away, rating: l.rating, g: l.g, a: l.a, dnp: l.dnp, myTeam: my,
            });
        });
    }
    // GELECEK sezonlar: olay yok (iskelet) — fikstür sezon başında belli olur.
    return ev;
}

// ---- Stil (kendi içinde; tek sefer enjekte) ----
function _calInjectCss() {
    if (document.getElementById('calview-css')) return;
    const st = document.createElement('style');
    st.id = 'calview-css';
    st.textContent = `
        .cal2-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;}
        .cal2-title{font-family:var(--font-heading);font-weight:800;font-size:1.05rem;min-width:230px;}
        .cal2-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;}
        .cal2-dow{text-align:center;font-size:.72rem;color:var(--text-muted);padding:2px 0;font-weight:700;}
        .cal2-day{min-height:74px;border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:4px 5px;cursor:pointer;position:relative;background:rgba(255,255,255,.02);transition:background .12s;}
        .cal2-day:hover{background:rgba(255,255,255,.07);}
        .cal2-day.out{opacity:.32;}
        .cal2-day.today{outline:2px solid var(--accent,#0f8);outline-offset:-2px;}
        .cal2-num{font-size:.78rem;font-weight:700;color:var(--text-muted);}
        .cal2-day.today .cal2-num{color:var(--accent,#0f8);}
        .cal2-mk{display:flex;align-items:center;gap:4px;margin-top:3px;font-size:.7rem;flex-wrap:wrap;}
        .cal2-res{font-weight:800;font-family:var(--font-heading);font-size:.74rem;padding:0 5px;border-radius:5px;}
        .cal2-res.W{background:rgba(46,204,113,.22);color:#2ecc71;} .cal2-res.D{background:rgba(241,196,15,.2);color:#f1c40f;} .cal2-res.L{background:rgba(231,76,60,.22);color:#e74c3c;}
        .cal2-cup{font-size:.62rem;background:rgba(155,89,182,.3);color:#c39bd3;border-radius:4px;padding:0 4px;font-weight:800;}
        .cal2-win{position:absolute;top:4px;right:5px;font-size:.6rem;color:#5dade2;}
        .cal2-detail{margin-top:12px;border-top:1px solid rgba(255,255,255,.08);padding-top:10px;}
        .cal2-news{margin-top:10px;font-size:.82rem;color:var(--text-muted);}
        .cal2-news .nw{padding:4px 0;border-bottom:1px dashed rgba(255,255,255,.06);}`;
    document.head.appendChild(st);
}

function _calTabActive() { const t = document.getElementById('calendar-tab'); return t && t.classList.contains('active'); }

// ---- Kulüpsüz: dünya gündemi (haber metinleri + önemli skorlar) ----
function _calNewsHtml() {
    const items = [];
    (gameState.transferNews || []).slice(0, 5).forEach(n => {
        const txt = n.text || (n.player ? `${n.player}: ${n.from || '?'} → ${n.to || '?'}${n.fee ? ' (' + formatMoney(n.fee) + ')' : ''}` : null);
        if (txt) items.push(`<div class="nw"><i class="fa-solid fa-newspaper"></i> ${txt}</div>`);
    });
    // Önemli skorlar: büyük liglerden DÖNÜŞÜMLÜ (haftaya göre) — eski lige saplanmaz
    try {
        const lgs = (typeof _SIM_NEWS_LEAGUES !== 'undefined' ? _SIM_NEWS_LEAGUES : ['eng-premier-league']).filter(id => DB.getLeague(id));
        const wk = gameState.currentWeek || 1;
        const lid = lgs.length ? lgs[wk % lgs.length] : 'eng-premier-league';
        const wi = Math.max(0, wk - 2);
        const fx = (typeof leagueFixtures === 'function') ? (leagueFixtures(lid)[wi] || []) : [];
        const byPow = fx.filter(m => !m.isBay).slice().sort((a, b) =>
            (((DB.getTeam(b.home) || {}).power || 0) + ((DB.getTeam(b.away) || {}).power || 0)) -
            (((DB.getTeam(a.home) || {}).power || 0) + ((DB.getTeam(a.away) || {}).power || 0)));
        byPow.slice(0, 3).forEach(m => {
            const sc = worldMatchScore(lid, wi, m.home, m.away);
            items.push(`<div class="nw"><i class="fa-solid fa-futbol"></i> ${(DB.getLeague(lid) || {}).name}: ${(DB.getTeam(m.home) || {}).name} ${sc[0]}-${sc[1]} ${(DB.getTeam(m.away) || {}).name} <span style="opacity:.6">(${wi + 1}. hafta)</span></div>`);
        });
    } catch (e) { /* sessiz */ }
    return items.length ? `<div class="cal2-news"><strong><i class="fa-solid fa-globe"></i> Dünya Gündemi</strong>${items.join('')}</div>` : '';
}

// ---- Gün detayı ----
function _calShowDay(season, dayIdx, dateStr) {
    const host = document.getElementById('cal-day-detail');
    if (!host) return;
    const p = gameState.player;
    const evs = _calSeasonEvents(season)[dayIdx] || [];
    const todaySeason = gameState.currentSeason, todayDay = gameState.gameDate || 0;
    const isFuture = season > todaySeason || (season === todaySeason && dayIdx > todayDay);
    const wk = dayToWeek(dayIdx);
    const win = _calWindowForWeek(wk, season === todaySeason ? (activeLeagueWeeks() || 38) : 38);
    let html = `<div style="font-weight:800;margin-bottom:6px;"><i class="fa-solid fa-calendar-day"></i> ${dateStr} <span style="color:var(--text-muted);font-weight:400;font-size:.8rem;">— ${wk}. hafta, ${_calSeasonLabel(season)} sezonu</span></div>`;
    if (evs.length) {
        evs.forEach(e => {
            const opp = DB.getTeam(e.oppId) || { name: '?' };
            const tag = e.type === 'cup' ? `<span class="cal2-cup">${e.comp || 'KUPA'}${e.round ? ' • ' + e.round : ''}</span> ` : '';
            if (e.played) {
                const my = e.home ? e.sh : e.sa, op = e.home ? e.sa : e.sh;
                const r = my > op ? 'W' : my === op ? 'D' : 'L';
                html += `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;">${tag}${getTeamLogoHtml(e.oppId, 20)} <strong>${opp.name}</strong> <span class="cal2-res ${r}">${e.sh}-${e.sa}</span> <span style="color:var(--text-muted);font-size:.78rem;">${e.home ? 'Ev' : 'Dep'}${e.dnp ? ' • oynamadın' : (e.rating != null ? ` • reyting ${e.rating}${e.g ? ` • ${e.g}G` : ''}${e.a ? ` ${e.a}A` : ''}` : '')}</span></div>`;
            } else {
                html += `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;">${tag}${getTeamLogoHtml(e.oppId, 20)} <strong>${opp.name}</strong> <span style="color:var(--text-muted);font-size:.78rem;">${e.home ? 'Ev sahibi' : 'Deplasman'} — henüz oynanmadı</span></div>`;
            }
        });
    } else {
        if (season > todaySeason) html += `<p style="color:var(--text-muted);font-size:.84rem;">Bu sezonun fikstürü henüz belli değil — terfi/küme düşme netleşince sezon başında oluşur.</p>`;
        else if (!p.teamId) html += `<p style="color:var(--text-muted);font-size:.84rem;">Kulüpsüzsün — maç programın yok. Teklifler için Transfer sekmesine bak.</p>`;
        else html += `<p style="color:var(--text-muted);font-size:.84rem;">Bu gün için planlı etkinlik yok.${isFuture ? ' (Antrenman planlayıcı yakında buraya gelecek.)' : ''}</p>`;
    }
    if (win) html += `<div style="color:#5dade2;font-size:.8rem;margin-top:4px;"><i class="fa-solid fa-right-left"></i> ${win === 'summer' ? 'Yaz' : 'Kış'} transfer penceresi bu hafta AÇIK</div>`;
    if (isFuture) {
        html += `<button class="btn btn-primary" id="btn-cal-simto" style="margin-top:10px;"><i class="fa-solid fa-forward-fast"></i> Bu güne kadar simüle et</button>`;
        if (season > todaySeason) html += `<div style="color:var(--text-muted);font-size:.74rem;margin-top:4px;">Sezon geçişlerinde 5 saniyelik kısa bir bekleme olur; durdurmazsan otomatik devam eder.</div>`;
    }
    if (!p.teamId) html += _calNewsHtml();
    host.innerHTML = html;
    const sBtn = document.getElementById('btn-cal-simto');
    if (sBtn) sBtn.addEventListener('click', () => {
        if (typeof openSimToDateModal === 'function') openSimToDateModal(season, dayIdx);
    });
}

// ---- Ana render: ay grid'i ----
function renderCalendarTab() {
    const host = document.getElementById('calendar-content');
    if (!host || !gameState.player) return;
    _calInjectCss();
    const p = gameState.player;
    const today = _calDateOf2(gameState.currentSeason, gameState.gameDate || 0);
    if (!_calCur) _calCur = { y: today.getFullYear(), m: today.getMonth() };
    const { y, m } = _calCur;
    const first = new Date(y, m, 1);
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const lead = (first.getDay() + 6) % 7;   // Pazartesi başlangıçlı
    // Bu ayda görünen sezon(lar)ın olay haritaları
    const sA = _calSeasonOfDate(first), sB = _calSeasonOfDate(new Date(y, m, daysInMonth));
    const evMaps = {}; evMaps[sA] = _calSeasonEvents(sA); if (sB !== sA) evMaps[sB] = _calSeasonEvents(sB);

    let cells = '';
    for (let i = 0; i < lead; i++) cells += `<div class="cal2-day out" style="cursor:default;"></div>`;
    for (let dd = 1; dd <= daysInMonth; dd++) {
        const date = new Date(y, m, dd);
        const season = _calSeasonOfDate(date);
        const dayIdx = _calDayIdx(season, date);
        const evs = (evMaps[season] || {})[dayIdx] || [];
        const isToday = date.getTime() === today.getTime();
        const wk = dayToWeek(dayIdx);
        const win = dayIdx >= 0 && _calWindowForWeek(wk, season === gameState.currentSeason ? (activeLeagueWeeks() || 38) : 38);
        let mark = '';
        evs.forEach(e => {
            const cupTag = e.type === 'cup' ? `<span class="cal2-cup">K</span>` : '';
            if (e.played) {
                const my = e.home ? e.sh : e.sa, op = e.home ? e.sa : e.sh;
                const r = my > op ? 'W' : my === op ? 'D' : 'L';
                mark += `<span class="cal2-mk">${getTeamLogoHtml(e.oppId, 18)}${cupTag}<span class="cal2-res ${r}">${e.sh}-${e.sa}</span></span>`;
            } else {
                mark += `<span class="cal2-mk">${getTeamLogoHtml(e.oppId, 18)}${cupTag}<span style="color:var(--text-muted);">${e.home ? 'E' : 'D'}</span></span>`;
            }
        });
        cells += `<div class="cal2-day${isToday ? ' today' : ''}" data-season="${season}" data-day="${dayIdx}" data-ds="${dd} ${CAL_MONTHS[m]} ${y}">
            <span class="cal2-num">${dd}</span>${win ? '<span class="cal2-win" title="Transfer penceresi açık"><i class="fa-solid fa-right-left"></i></span>' : ''}${mark}</div>`;
    }

    const seasonLbl = _calSeasonLabel(_calSeasonOfDate(new Date(y, m, 15)));
    host.innerHTML = `
        <div class="cal2-toolbar">
            <button class="btn" id="cal-prev"><i class="fa-solid fa-chevron-left"></i></button>
            <span class="cal2-title">${CAL_MONTHS[m]} ${y} <span style="color:var(--text-muted);font-size:.82rem;font-weight:400;">• ${seasonLbl} sezonu</span></span>
            <button class="btn" id="cal-next"><i class="fa-solid fa-chevron-right"></i></button>
            <button class="btn" id="cal-today"><i class="fa-solid fa-location-crosshairs"></i> Bugün</button>
            ${!p.teamId ? '<span style="color:var(--text-muted);font-size:.8rem;"><i class="fa-solid fa-user"></i> Kulüpsüz — takvimde maç yok, dünya gündemi gün detayında</span>' : ''}
        </div>
        <div class="cal2-grid">${['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Pzr'].map(d => `<div class="cal2-dow">${d}</div>`).join('')}${cells}</div>
        <div class="cal2-detail" id="cal-day-detail"><p style="color:var(--text-muted);font-size:.84rem;">Bir güne tıkla — detayını ve "buraya kadar simüle et" seçeneğini gör.</p></div>`;

    document.getElementById('cal-prev').addEventListener('click', () => { _calCur.m--; if (_calCur.m < 0) { _calCur.m = 11; _calCur.y--; } renderCalendarTab(); });
    document.getElementById('cal-next').addEventListener('click', () => { _calCur.m++; if (_calCur.m > 11) { _calCur.m = 0; _calCur.y++; } renderCalendarTab(); });
    document.getElementById('cal-today').addEventListener('click', () => { _calCur = { y: today.getFullYear(), m: today.getMonth() }; renderCalendarTab(); _calShowDay(gameState.currentSeason, gameState.gameDate || 0, calFormat(gameState.gameDate || 0)); });
    host.querySelectorAll('.cal2-day[data-season]').forEach(c => c.addEventListener('click', () => {
        host.querySelectorAll('.cal2-day').forEach(x => x.style.background = '');
        c.style.background = 'rgba(255,255,255,.1)';
        _calShowDay(parseInt(c.dataset.season, 10), parseInt(c.dataset.day, 10), c.dataset.ds);
    }));
    // Bugünü otomatik seçili getir (ilk açılışta bağlam görünsün)
    if (isFinite(today.getTime()) && today.getFullYear() === y && today.getMonth() === m)
        _calShowDay(gameState.currentSeason, gameState.gameDate || 0, `${today.getDate()} ${CAL_MONTHS[m]} ${y}`);
}

// Dashboard takvim şeridi tıklanınca Takvim sekmesine git
function _calWireStrip() {
    const strip = document.getElementById('calendar-strip');
    if (!strip || strip._calWired) return;
    strip._calWired = true;
    strip.style.cursor = 'pointer';
    strip.title = 'Tam takvimi aç';
    strip.addEventListener('click', () => {
        const btn = document.querySelector('.nav-btn[data-target="calendar-tab"]');
        if (btn) btn.click();
    });
}

if (typeof window !== 'undefined') {
    Object.assign(window, {
        renderCalendarTab, _calSeasonEvents, _calWindowForWeek, _calSeasonOfDate, _calDayIdx, _calDateOf2,
        _calShowDay, _calTabActive, _calWireStrip,
    });
}
