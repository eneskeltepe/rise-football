// ============================================================================
//  17-simto.js  —  TARİHE KADAR SİMÜLE (FM/PES tarzı).
//  Takvimden gün seç → seçenek modalı (maçlarım: dur/otomatik; durma koşulları:
//  sakatlık, teklif, kupa maçı, pencere, kulüpsüz kalma; "hiç durmadan git")
//  → canlı ilerleme ekranı: anlık tarih, gün/maç sayacı, olay AKIŞI (maç
//  sonuçları, sakatlık, teklif, haber) ve DURDUR butonu.
//  Sim sırasında showToast akışa yönlendirilir, updateUI/saveGame askıya alınır
//  (250+ günlük sıçramada UI render maliyeti sıfırlanır; sonda tek sefer yapılır).
//  Sezon sonunda 5 sn'lik geri sayım gösterilir; DURDUR'a basılmazsa sezon devri
//  OTOMATİK onaylanır ve gameState._simPending ile yeni sezon başında kaldığı
//  yerden devam eder (94-bindings btn-start-next-season kancası).
// ============================================================================

let _simRun = null;   // aktif simülasyon durumu {stop}

// Kulüpsüz moddaki haftalık dünya gündeminde dönüşümlü gösterilecek büyük ligler
const _SIM_NEWS_LEAGUES = ['eng-premier-league', 'esp-la-liga', 'ger-bundesliga', 'ita-serie-a', 'fra-ligue-1', 'tur-super-lig', 'ned-eredivisie', 'por-primeira-liga'];

// ---- Seçenek modalı ----
function openSimToDateModal(season, day) {
    const p = gameState.player;
    if (!p || _simRun) return;
    if (season < gameState.currentSeason || (season === gameState.currentSeason && day <= (gameState.gameDate || 0))) {
        if (typeof showToast === 'function') showToast('Hedef tarih bugünden ileride olmalı.', 'info');
        return;
    }
    const old = document.getElementById('simto-options'); if (old) old.remove();
    const dt = _calDateOf2(season, day);
    const dateLbl = `${dt.getDate()} ${CAL_MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
    const ov = document.createElement('div');
    ov.id = 'simto-options';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(4,10,18,.82);display:flex;align-items:center;justify-content:center;z-index:9998;';
    const chk = (id, label, on, icon) => `<label style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;font-size:.88rem;"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}> <i class="fa-solid ${icon}" style="width:16px;color:var(--text-muted);"></i> ${label}</label>`;
    ov.innerHTML = `
        <div class="glass-card" style="max-width:430px;width:92%;padding:20px;">
            <h3 style="margin:0 0 4px;"><i class="fa-solid fa-forward-fast"></i> Tarihe Kadar Simüle Et</h3>
            <div style="color:var(--text-muted);font-size:.84rem;margin-bottom:12px;">Hedef: <strong style="color:#fff;">${dateLbl}</strong> (${dayToWeek(day)}. hafta, ${season}/${String((season + 1) % 100).padStart(2, '0')})</div>
            <div style="font-weight:700;margin-bottom:4px;font-size:.88rem;">Kendi maçlarım:</div>
            <label style="display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer;font-size:.88rem;"><input type="radio" name="simto-mm" value="auto" checked> <i class="fa-solid fa-bolt" style="width:16px;color:var(--text-muted);"></i> Otomatik oynansın (hızlı sim, istatistik yazılır)</label>
            <label style="display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer;font-size:.88rem;"><input type="radio" name="simto-mm" value="stop"> <i class="fa-solid fa-hand" style="width:16px;color:var(--text-muted);"></i> Maçlarımda dur (maça ben çıkarım)</label>
            <div style="font-weight:700;margin:10px 0 4px;font-size:.88rem;">Şu olaylarda DUR:</div>
            ${chk('simto-injury', 'Sakatlanınca', true, 'fa-kit-medical')}
            ${chk('simto-offer', 'Transfer/sözleşme teklifi gelince', true, 'fa-handshake')}
            ${chk('simto-cup', 'Kupa maçımda (her durumda kendim oynarım)', false, 'fa-trophy')}
            ${chk('simto-window', 'Transfer penceresi açılınca', false, 'fa-right-left')}
            ${chk('simto-clubless', 'Kulüpsüz kalınca', true, 'fa-user-slash')}
            <div style="border-top:1px solid rgba(255,255,255,.08);margin:10px 0 6px;"></div>
            ${chk('simto-nostop', 'HİÇ DURMADAN git (yukarıdakileri yok say, maçlar otomatik)', false, 'fa-rocket')}
            <div style="color:var(--text-muted);font-size:.74rem;margin-top:6px;"><i class="fa-solid fa-circle-info"></i> Sezon geçişlerinde 5 saniyelik kısa bir bekleme olur; DURDUR'a basmazsan sezon devri otomatik yapılır ve simülasyon kaldığı yerden devam eder. Simülasyonu istediğin an DURDUR butonuyla kesebilirsin.</div>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px;">
                <button class="btn" id="simto-cancel">Vazgeç</button>
                <button class="btn btn-primary" id="simto-start"><i class="fa-solid fa-play"></i> Simülasyonu Başlat</button>
            </div>
        </div>`;
    document.body.appendChild(ov);
    const noStop = ov.querySelector('#simto-nostop');
    noStop.addEventListener('change', () => {
        const dis = noStop.checked;
        ['simto-injury', 'simto-offer', 'simto-cup', 'simto-window', 'simto-clubless'].forEach(id => { const c = ov.querySelector('#' + id); c.disabled = dis; if (dis) c.checked = false; });
        ov.querySelectorAll('input[name="simto-mm"]').forEach(r => { r.disabled = dis; if (dis && r.value === 'auto') r.checked = true; });
    });
    ov.querySelector('#simto-cancel').addEventListener('click', () => ov.remove());
    ov.querySelector('#simto-start').addEventListener('click', () => {
        const opts = {
            matchMode: noStop.checked ? 'auto' : (ov.querySelector('input[name="simto-mm"]:checked') || {}).value || 'auto',
            stopInjury: !noStop.checked && ov.querySelector('#simto-injury').checked,
            stopOffer: !noStop.checked && ov.querySelector('#simto-offer').checked,
            stopCup: !noStop.checked && ov.querySelector('#simto-cup').checked,
            stopWindow: !noStop.checked && ov.querySelector('#simto-window').checked,
            stopClubless: !noStop.checked && ov.querySelector('#simto-clubless').checked,
        };
        ov.remove();
        startSimToDate({ season, day }, opts);
    });
}

// ---- Canlı ilerleme ekranı ----
function _simOverlayOpen(targetLbl) {
    const old = document.getElementById('simto-overlay'); if (old) old.remove();
    const ov = document.createElement('div');
    ov.id = 'simto-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(4,10,18,.85);display:flex;align-items:center;justify-content:center;z-index:9998;';
    ov.innerHTML = `
        <div class="glass-card" style="max-width:520px;width:94%;padding:20px;display:flex;flex-direction:column;max-height:84vh;">
            <h3 style="margin:0 0 2px;"><i class="fa-solid fa-forward-fast"></i> Simülasyon <span style="color:var(--text-muted);font-size:.78rem;font-weight:400;">→ ${targetLbl}</span></h3>
            <div id="simto-date" style="font-family:var(--font-heading);font-weight:800;font-size:1.25rem;margin:6px 0 2px;">—</div>
            <div id="simto-count" style="color:var(--text-muted);font-size:.8rem;margin-bottom:8px;">başlıyor…</div>
            <div id="simto-feed" style="flex:1;overflow-y:auto;min-height:160px;max-height:46vh;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:8px;font-size:.84rem;display:flex;flex-direction:column;gap:4px;"></div>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:12px;" id="simto-btns">
                <button class="btn" id="simto-stop" style="background:rgba(231,76,60,.25);"><i class="fa-solid fa-stop"></i> DURDUR</button>
            </div>
        </div>`;
    document.body.appendChild(ov);
    document.getElementById('simto-stop').addEventListener('click', () => { if (_simRun) _simRun.stop = true; });
    return ov;
}
function _simFeed(msg, type) {
    const f = document.getElementById('simto-feed'); if (!f) return;
    const colors = { success: '#2ecc71', error: '#e74c3c', warning: '#f1c40f', info: 'var(--text-muted)' };
    const d = document.createElement('div');
    d.style.cssText = 'padding:3px 4px;border-bottom:1px dashed rgba(255,255,255,.05);';
    d.innerHTML = `<span style="color:var(--text-muted);font-size:.72rem;margin-right:6px;">${calFormat(gameState.gameDate || 0)}</span><span style="color:${colors[type] || '#ddd'};">${msg}</span>`;
    f.prepend(d);
    while (f.children.length > 60) f.removeChild(f.lastChild);
}
function _simHeader(daysDone, played) {
    const de = document.getElementById('simto-date');
    const ce = document.getElementById('simto-count');
    if (de) de.textContent = calFormat(gameState.gameDate || 0, true) + `  •  ${gameState.currentWeek}. hafta`;
    if (ce) ce.textContent = `${daysDone} gün ilerlendi • ${played.n} maç (${played.w}G ${played.d}B ${played.l}M)`;
}
function _simFinish(ov, summaryMsg, autoClose) {
    const btns = document.getElementById('simto-btns');
    if (btns) btns.innerHTML = `<button class="btn btn-primary" id="simto-close"><i class="fa-solid fa-check"></i> Kapat</button>`;
    const cb = document.getElementById('simto-close');
    if (cb) cb.addEventListener('click', () => ov.remove());
    if (summaryMsg) _simFeed(`<strong>${summaryMsg}</strong>`, 'success');
    if (autoClose) setTimeout(() => { try { ov.remove(); } catch (e) {} }, 600);
}

// ---- Motor ----
function startSimToDate(target, opts) {
    if (_simRun || !gameState.player) return;
    opts = opts || {};
    const p = gameState.player;
    const tDate = _calDateOf2(target.season, target.day);
    const targetLbl = `${tDate.getDate()} ${CAL_MONTHS[tDate.getMonth()]} ${tDate.getFullYear()}`;
    const ov = _simOverlayOpen(targetLbl);
    _simRun = { stop: false };
    const played = { n: 0, w: 0, d: 0, l: 0 };
    let daysDone = 0;
    // Toast'ları akışa yönlendir; sim boyunca UI render + kayıt askıda (sonda tek sefer)
    const origToast = window.showToast, origUI = window.updateUI, origSave = window.saveGame;
    window.showToast = (msg, type) => _simFeed(msg, type);
    window.updateUI = function () {};
    window.saveGame = function () {};
    const delay = (ms) => new Promise(res => setTimeout(res, ms));
    const snap = () => ({
        inj: !!p.injury, off: (gameState.transferOffers || []).length, club: p.teamId,
        win: !!(typeof isTransferWindowOpen === 'function' && isTransferWindowOpen()),
        week: gameState.currentWeek, season: gameState.currentSeason,
    });
    const countResult = (my, op) => { played.n++; if (my > op) played.w++; else if (my === op) played.d++; else played.l++; };

    (async () => {
        let stopMsg = null, pending = false, autoRoll = false;
        let guard = 0, stall = 0, prevKey = '';
        let lastNewsKey = null;   // kulüpsüz modda aynı transfer haberini tekrar basma
        try {
            _simFeed(`Simülasyon başladı → hedef <strong>${targetLbl}</strong>.`, 'info');
            while (guard++ < 4000) {
                if (_simRun.stop) { stopMsg = 'Simülasyonu durdurdun.'; break; }
                // Kilitlenme koruması: durum hiç değişmiyorsa (tutarsız kayıt vb.) güvenli dur
                const _key = gameState.currentSeason + '|' + (gameState.gameDate || 0) + '|' + (gameState.matchesPlayedThisWeek ? 1 : 0) + '|' + gameState.currentWeek;
                if (_key === prevKey) { if (++stall >= 6) { stopMsg = 'İlerleme sağlanamadı — simülasyon güvenlik için durdu.'; break; } }
                else { stall = 0; prevKey = _key; }
                if (gameState.currentSeason > target.season ||
                    (gameState.currentSeason === target.season && (gameState.gameDate || 0) >= target.day)) {
                    stopMsg = 'Hedef tarihe ulaşıldı.'; break;
                }
                const before = snap();
                const today = (typeof matchToday === 'function') ? matchToday() : null;
                if (today && today.kind === 'cup') {
                    if (opts.stopCup) { stopMsg = 'Kupa maçı günü — maça sen çıkacaksın.'; break; }
                    const due = (typeof euroFixtureDueThisWeek === 'function') ? euroFixtureDueThisWeek() : null;
                    if (due) {
                        simEuroMatch(due.fx, due.phase, due.round, true, !!(p.injury || p.suspension));   // sonuç toast'ı akışa düşer
                        countResult(due.fx.gf || 0, due.fx.ga || 0);
                    }
                    await delay(380);
                } else if (today && today.kind === 'league') {
                    if (opts.matchMode === 'stop') { stopMsg = 'Maç günü — maça sen çıkacaksın.'; break; }
                    if (p.injury || p.suspension) {
                        startMatchDay();   // 90-main sarmalayıcısı: takım oyuncusuz oynar (toast → akış)
                        const m = today.m; if (m && m.scoreHome !== null) countResult(m.home === p.teamId ? m.scoreHome : m.scoreAway, m.home === p.teamId ? m.scoreAway : m.scoreHome);
                    } else {
                        const r = (typeof simulateMatchInstantly === 'function') ? simulateMatchInstantly(true) : null;
                        if (r && r.myMatch) {
                            const m = r.myMatch;
                            const mine = m.home === p.teamId;
                            const my = mine ? m.scoreHome : m.scoreAway, op = mine ? m.scoreAway : m.scoreHome;
                            countResult(my, op);
                            const hn = (getTeamById(m.home) || {}).name, an = (getTeamById(m.away) || {}).name;
                            _simFeed(`<strong>${hn} ${m.scoreHome}-${m.scoreAway} ${an}</strong>${r.status === 'excluded' ? ' — kadro dışıydın' : ` — sen: ${r.goals}G ${r.assists}A, reyting ${r.rating}`}`,
                                my > op ? 'success' : (my === op ? 'info' : 'error'));
                        }
                    }
                    await delay(380);
                } else {
                    advanceDay('one');
                    daysDone++;
                    await delay(16);
                }
                // Sezon sonu: advanceWeek modalı açtıysa 5 sn geri sayım — DURDUR'a
                // basılmazsa sezon devri OTOMATİK onaylanır ve sim kaldığı yerden sürer.
                const sem = document.getElementById('season-end-modal');
                if (sem && sem.style.display === 'flex') {
                    if (target.season > gameState.currentSeason) {
                        gameState._simPending = { season: target.season, day: target.day, opts };
                        let halted = false, externalRoll = false;   // externalRoll: kullanıcı modal butonuna KENDİSİ bastı
                        for (let s = 5; s >= 1 && !halted && !externalRoll; s--) {
                            const ce = document.getElementById('simto-count');
                            if (ce) ce.textContent = `SEZON SONU — ${s} sn sonra otomatik devam (durmak için DURDUR)`;
                            for (let t = 0; t < 4 && !halted && !externalRoll; t++) {
                                await delay(250);
                                if (_simRun.stop) halted = true;
                                else if (sem.style.display !== 'flex') externalRoll = true;   // devir zaten onaylandı
                            }
                        }
                        if (halted) {
                            gameState._simPending = null;
                            stopMsg = 'Sezon sonunda durdun — özeti onayla.';
                        } else if (externalRoll) {
                            // btn-start-next-season kancası _simPending'i tüketti; bu koşu kapanınca
                            // 700ms'lik resume zamanlayıcısı yeni koşuyu başlatır (çifte tıklama YOK)
                            pending = true;
                            stopMsg = 'Sezon devri onaylandı — kaldığı yerden devam edecek…';
                        } else {
                            pending = true; autoRoll = true;
                            stopMsg = 'Sezon devri yapılıyor — kaldığı yerden devam edecek…';
                        }
                    } else stopMsg = 'Sezon sonuna gelindi.';
                    break;
                }
                // Kulüpsüzken haftalık dünya gündemi: büyük liglerden DÖNÜŞÜMLÜ, haftanın
                // en büyük maçı (güç toplamı) + taze transfer haberi (eski lige saplanmaz).
                if (!p.teamId && gameState.currentWeek !== before.week) {
                    try {
                        const lgs = _SIM_NEWS_LEAGUES.filter(id => DB.getLeague(id));
                        const lid = lgs.length ? lgs[before.week % lgs.length] : null;
                        const wi = before.week - 1;
                        const fxs = lid ? ((typeof leagueFixtures === 'function' ? leagueFixtures(lid) : [])[wi] || []).filter(m => !m.isBay) : [];
                        let fx = null, bp = -1;
                        for (const m of fxs) {
                            const pw = ((DB.getTeam(m.home) || {}).power || 0) + ((DB.getTeam(m.away) || {}).power || 0);
                            if (pw > bp) { bp = pw; fx = m; }
                        }
                        if (fx) {
                            const sc = worldMatchScore(lid, wi, fx.home, fx.away);
                            _simFeed(`<i class="fa-solid fa-globe"></i> ${(DB.getLeague(lid) || {}).name}: ${(DB.getTeam(fx.home) || {}).name} ${sc[0]}-${sc[1]} ${(DB.getTeam(fx.away) || {}).name}`, 'info');
                        }
                        const tn = (gameState.transferNews || [])[0];
                        const tnKey = tn ? `${tn.player}>${tn.to}` : null;
                        if (tn && tnKey !== lastNewsKey) {
                            lastNewsKey = tnKey;
                            _simFeed(`<i class="fa-solid fa-newspaper"></i> Transfer: ${tn.player} (${tn.from} → ${tn.to})${tn.fee ? ` — ${formatMoney(tn.fee)}` : ''}`, 'info');
                        }
                    } catch (e) { /* sessiz */ }
                }
                // Durma koşulları (olay akışa zaten düştü; koşul işaretliyse simülasyon durur)
                if (opts.stopInjury && !before.inj && p.injury) { stopMsg = `Sakatlandın: ${p.injury.name} (~${p.injury.weeks} hafta).`; break; }
                if (opts.stopOffer && (gameState.transferOffers || []).length > before.off) { stopMsg = 'Yeni teklif geldi — Transfer sekmesine bak.'; break; }
                if (opts.stopWindow && !before.win && typeof isTransferWindowOpen === 'function' && isTransferWindowOpen()) { stopMsg = 'Transfer penceresi açıldı.'; break; }
                if (opts.stopClubless && before.club && !p.teamId) { stopMsg = 'Kulüpsüz kaldın.'; break; }
                _simHeader(daysDone, played);
            }
        } catch (err) {
            console.warn('simto hata', err);
            stopMsg = 'Simülasyon bir hatayla durdu.';
        } finally {
            window.showToast = origToast; window.updateUI = origUI; window.saveGame = origSave;
            _simRun = null;
            try { saveGame(); } catch (e) {}
            try { updateUI(); } catch (e) {}
            try { if (typeof _calTabActive === 'function' && _calTabActive() && typeof renderCalendarTab === 'function') renderCalendarTab(); } catch (e) {}
            _simHeader(daysDone, played);
            _simFeed(stopMsg || 'Simülasyon bitti.', 'warning');
            _simFinish(ov, `${daysDone} gün ilerlendi — ${played.n} maç: ${played.w}G ${played.d}B ${played.l}M`, pending);
            // Otomatik sezon devri: stub'lar geri yüklendikten SONRA sezon-sonu butonuna basılır;
            // btn-start-next-season sonundaki _simPending kancası simülasyonu yeniden başlatır.
            // Modal hâlâ açıksa basılır (kullanıcı arada kendisi onayladıysa çifte devir OLMAZ).
            if (autoRoll) setTimeout(() => {
                try {
                    const sem2 = document.getElementById('season-end-modal');
                    const b = document.getElementById('btn-start-next-season');
                    if (b && sem2 && sem2.style.display === 'flex') b.click();
                } catch (e) { /* sessiz */ }
            }, 250);
        }
    })();
}

if (typeof window !== 'undefined') {
    Object.assign(window, { openSimToDateModal, startSimToDate });
}
