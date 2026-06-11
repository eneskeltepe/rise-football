// ============================================================================
//  90-main.js  —  Entegrasyon: dunya sim, advanceWeek, sezon sonu, olusturma.
//  Taban updateUI/startMatchDay'i sarmalar (en son yuklenir).
// ============================================================================

// ---- updateUI sarmalayici: aktif lig degisince fikstur+kadro senkronu ----
const _origUpdateUI = window.updateUI;
function _syncActiveLeague() {
    if (!gameState.player) return;
    const lid = activeLeagueId();
    if (gameState._fxLeague !== lid) {
        gameState._fxLeague = lid;
        // Transfer/kiralık ile aktif lig değişince Lig & Fikstür + İstatistikler varsayılanı
        // yeni lige geçsin (kullanıcı dropdown'dan istediğini yine seçebilir).
        if (lid) {
            gameState.viewStandingsLeague = lid;
            if (gameState.statsView) gameState.statsView.league = lid; else gameState.statsView = { league: lid, cat: 'g' };
        }
        setActiveLeagueFixtures();
        if (lid) {
            DB.loadPlayers(lid);                  // kadrolari arka planda yukle
            // terfi/kume dusen takimlarin oyuncu dosyalari baska lige ait olabilir
            const srcs = new Set();
            DB.teamsInLeague(lid).forEach(t => { if (t.srcLeague && t.srcLeague !== lid) srcs.add(t.srcLeague); });
            srcs.forEach(s => DB.loadPlayers(s));
        }
    }
    // oyuncunun kendi takiminin oyuncu dosyasi her zaman yuklu olsun
    const mt = gameState.player.teamId && DB.getTeam(gameState.player.teamId);
    if (mt && mt.srcLeague) DB.loadPlayers(mt.srcLeague);
}
window.updateUI = function () {
    try { _syncActiveLeague(); } catch (e) { console.warn(e); }
    try { if (gameState.player && typeof ensureEuroForCurrentTeam === 'function') ensureEuroForCurrentTeam(); } catch (e) { console.warn(e); }
    const r = _origUpdateUI.apply(this, arguments);
    try { if (gameState.player) renderClubInfoCard(); } catch (e) { console.warn(e); }
    try { if (gameState.player && typeof renderCupsTab === 'function') renderCupsTab(); } catch (e) { console.warn(e); }
    try { if (gameState.player && typeof renderEuroPrompt === 'function') renderEuroPrompt(); } catch (e) { console.warn(e); }
    try { if (gameState.player && typeof renderEuroCampaign === 'function') renderEuroCampaign(); } catch (e) { console.warn(e); }
    try { if (gameState.player && typeof renderStatsTab === 'function') renderStatsTab(); } catch (e) { console.warn(e); }
    try { if (gameState.player && typeof renderMarketUI === 'function') renderMarketUI(); } catch (e) { console.warn(e); }
    try { if (gameState.player && typeof renderDevTrack === 'function') renderDevTrack(); } catch (e) { console.warn(e); }
    try { if (gameState.player && typeof renderCalendarStrip === 'function') renderCalendarStrip(); } catch (e) { console.warn(e); }
    return r;
};

// ---- TUM dunya haftalik sim (haftada bir kez; cift sayimi onle) ----
function simulateOtherWeekMatches(weekIndex) {
    if (!gameState.standings) initAllStandings();
    if (gameState._lastSimWeek === weekIndex) return;   // bu hafta zaten simule edildi
    gameState._lastSimWeek = weekIndex;
    const userTeam = gameState.player ? gameState.player.teamId : null;
    simulateWorldWeek(weekIndex, activeLeagueId(), userTeam);
    // FAZ 1b: aynı haftayı DETAYLI (skor + olay dökümü) IDB'ye yaz (fire-and-forget,
    // mevcut puan-durumu yolunu değiştirmez; çok yavaşlarsa bu tek satır kaldırılır).
    try {
        if (typeof recordWorldWeekDetails === 'function' && gameState._slot != null) {
            const _wp = recordWorldWeekDetails(gameState._slot, weekIndex, gameState.currentSeason, activeLeagueId(), userTeam)
                // FAZ 3b: yeni maçlar yazıldı → krallık cache'i bayatladı, yeniden kurulsun.
                .then(() => { if (window.WorldStats) WorldStats.invalidate(); });
            // Uçuştaki yazımları zincirle: sezon-sonu agregat (94-bindings) bu zinciri bekler →
            // son haftanın maçları yazılmadan agregat koşmaz (eksik istatistik yarışı fix'i)
            window._worldWriteSync = (window._worldWriteSync || Promise.resolve()).then(() => _wp).catch(() => {});
        }
    } catch (e) { /* sessiz */ }
}

// ---- advanceWeek: dinamik hafta + dunya sim + sakatlik + teklif mantigi ----
function advanceWeek() {
    const p = gameState.player;
    const totalWeeks = activeLeagueWeeks() || 38;
    const playedThisWeek = gameState.matchesPlayedThisWeek;

    if (gameState.currentWeek >= totalWeeks) {
        simulateOtherWeekMatches(gameState.currentWeek - 1);
        openSeasonEndModal();
        return;
    }
    simulateOtherWeekMatches(gameState.currentWeek - 1);

    gameState.matchesPlayedThisWeek = false;
    gameState.hasDoneActionThisWeek = false;
    gameState.actionsDoneThisWeek = 0;
    gameState.currentWeek++;
    // Takvim senkronu: gameDate her zaman içinde bulunulan haftaya hizalı kalır
    if (typeof _syncCalendarToWeek === 'function') _syncCalendarToWeek();
    fixtureViewingWeek = gameState.currentWeek;
    p.energy = Math.min(100, p.energy + 15);

    // Oynanmayan (gecikmis) Avrupa kupasi maclarini otomatik simule et
    try { if (typeof autoSimDueEuro === 'function') autoSimDueEuro(gameState.currentWeek); } catch (e) { console.warn(e); }

    // Transfer piyasasi: pencere acildiysa dunya transfer haberleri + serbest oyuncu havuzu
    try { if (typeof maybeRunMarket === 'function') maybeRunMarket(); } catch (e) { console.warn(e); }

    // sakatlik geri sayimi
    if (p.injury && p.injury.weeks > 0) {
        p.injury.weeks--;
        if (p.injury.weeks <= 0) { showToast(`Sakatlığın geçti, antrenmanlara döndün! (${p.injury.name})`, 'success'); p.injury = null; }
    } else if (playedThisWeek && p.teamId) {
        // mac oynadiysa kucuk sakatlik ihtimali
        const inj = rollInjury(p, p.energy, 1.0);
        if (inj) { p.injury = inj; showToast(`Sakatlandın: ${inj.name} — tahmini ${inj.weeks} hafta yok.`, 'error'); }
    }

    // hoca listeleme istekleri (orijinal mantik)
    if (p.teamId !== null) {
        if (p.listingRequested && p.listingRequested !== 'none') {
            if (p.listingRequested === 'normal') {
                // Listeden çıkma talebi: güven yeterliyse onayla, değilse listede tut
                if ((p.managerTrust || 50) >= 50) { p.listingStatus = 'normal'; showToast('Hoca talebini onayladı — listeden çıkarıldın, yerini geri kazandın.', 'success'); }
                else showToast('Hoca güveni düşük olduğu için seni listede tutuyor. Önce güveni yükselt.', 'error');
                p.listingRequested = 'none';
            } else if (p.managerTrust >= 70) {
                showToast(`Hoca: "${p.firstname}, sen bu takımın önemli bir parçasısın!" — talep reddedildi.`, 'error');
                p.listingRequested = 'none';
            } else if (p.managerTrust < 60) {
                p.listingStatus = p.listingRequested;
                showToast(`Hoca talebini onayladı! Seni ${p.listingRequested === 'transfer' ? 'Transfer' : 'Kiralık'} listesine koydu.`, 'success');
                p.listingRequested = 'none';
            } else { showToast('Hoca talebini düşünüyor...', 'info'); }
        }
        if (p.listingStatus === 'normal' || p.listingStatus === undefined) {
            if (p.managerTrust < 35) { p.listingStatus = 'transfer'; showToast('Hoca düşük güven nedeniyle seni Transfer Listesine koydu!', 'error'); }
            else if (p.managerTrust < 50) { p.listingStatus = 'loan'; showToast('Hoca seni Kiralık Listesine koydu!', 'warning'); }
        }
    }
    // Yeni teklifler: nav rozeti (updateUI'de) + sağ-üst toast bildirimi (önemli an)
    if (p.teamId !== null && (p.listingStatus === 'transfer' || p.listingStatus === 'loan')) {
        if (Math.random() < 0.15) {
            const _b = gameState.transferOffers.length;
            generateTransferOffers();
            const _n = gameState.transferOffers.length - _b;
            if (_n > 0) showToast(`Listede olduğun için ${_n} yeni transfer teklifi geldi! Transfer & Sözleşme sekmesine bak.`, 'success');
        }
    }
    if (p.teamId === null) {
        if (Math.random() < 0.40) {
            const _b = gameState.transferOffers.length;
            generateFreeAgentOffers();
            const _n = gameState.transferOffers.length - _b;
            if (_n > 0) showToast(`Kulüplerden ${_n} yeni sözleşme teklifi geldi! Transfer & Sözleşme sekmesine bak.`, 'success');
        }
    }

    saveGame();
    updateUI();
}

// ---- Sezon sonu: aktif lig puan durumu ----
function openSeasonEndModal() {
    const modal = document.getElementById('season-end-modal');
    const p = gameState.player;
    const lid = activeLeagueId();
    const lg = DB.getLeague(lid) || { name: 'Lig' };
    const sorted = standingsSorted(lid);
    const myRank = p.teamId ? sorted.findIndex(t => t.id === p.teamId) + 1 : 0;
    const cs = p.currentSeasonStats;
    const avg = cs.ratings.length ? (cs.ratings.reduce((a, b) => a + b, 0) / cs.ratings.length).toFixed(2) : '0.00';

    document.getElementById('season-end-title').textContent = `${gameState.currentSeason} Sezonu Tamamlandı!`;
    // Sıra ÖNCE, lig adı ayraçla SONRA — yoksa "Ligue 1" + "1. Sıra" birleşip "Ligue 11. Sıra" gibi okunuyordu.
    document.getElementById('se-team-finish').textContent = myRank > 0 ? `${myRank}. Sıra — ${lg.name}` : 'Serbest Oyuncu';
    document.getElementById('se-matches').textContent = cs.matches;
    document.getElementById('se-goals').textContent = p.position === 'Kaleci' ? cs.saves : cs.goals;
    document.getElementById('se-goals-label').textContent = p.position === 'Kaleci' ? 'Kurtarış' : 'Gol';
    document.getElementById('se-assists').textContent = cs.assists;
    document.getElementById('se-rating').textContent = avg;

    const box = document.getElementById('season-trophies-box');
    box.innerHTML = '';
    let got = false;
    if (myRank === 1) {
        box.innerHTML = `<span><i class="fa-solid fa-trophy"></i> ${lg.name} Şampiyonu!</span>`;
        gameState.trophies.push({ season: gameState.currentSeason, title: `${lg.name} Şampiyonluğu` }); got = true;
    }
    // Yıl sonu bireysel ödüller (gerçek lig sıralamasından)
    try {
        const aw = typeof computeSeasonAwards === 'function' ? computeSeasonAwards(lid) : null;
        const isU = e => e && e.id === 'USER';
        const S = gameState.currentSeason;
        if (aw) {
            if (isU(aw.topScorer)) { box.innerHTML += `<span><i class="fa-solid fa-crown"></i> Gol Kralı! (${aw.topScorer.g} gol)</span>`; gameState.trophies.push({ season: S, title: 'Gol Krallığı' }); got = true; }
            if (isU(aw.topAssist)) { box.innerHTML += `<span><i class="fa-solid fa-wand-magic-sparkles"></i> Asist Kralı! (${aw.topAssist.a})</span>`; gameState.trophies.push({ season: S, title: 'Asist Krallığı' }); got = true; }
            if (p.position === 'Kaleci' && isU(aw.bestGk)) { box.innerHTML += `<span><i class="fa-solid fa-hands"></i> En Az Gol Yiyen Kaleci!</span>`; gameState.trophies.push({ season: S, title: 'Yılın Kalecisi' }); got = true; }
            if (isU(aw.mvp)) { box.innerHTML += `<span><i class="fa-solid fa-medal"></i> Yılın Oyuncusu (MVP)!</span>`; gameState.trophies.push({ season: S, title: 'Yılın Oyuncusu' }); got = true; }
        }
    } catch (err) { console.warn(err); }
    if (!got) box.innerHTML = `<span style="color:var(--text-muted);background:transparent;">Bu sezon kupa yok. Sonraki sezon daha çok çalış!</span>`;
    modal.style.display = 'flex';
}

// ---- Antrenman: alt-ozellikleri hedefler (OVR alt-statlardan hesaplandigi icin sart) ----
const TRAINING_MAP = {
    shooting: ['bitiricilik', 'sutGucu', 'pozisyonAlma', 'uzaktanSut'],
    passing: ['kisaPas', 'uzunPas', 'vizyon', 'ortaPas'],
    defending: ['ayaktaMudahale', 'kayarakMudahale', 'topKapma', 'defansFarkindaligi'],
    physical: ['guc', 'dayaniklilik', 'hizlanma', 'sprintHizi'],
    goalkeeping: ['gkUcus', 'gkRefleks', 'gkTopTutma', 'gkYerTutma'],
    tactical: ['vizyon', 'sogukkanlilik', 'reaksiyon', 'defansFarkindaligi'],
    setpiece: ['serbestVurus', 'penalti', 'falso', 'vole'],
    technique: ['topSurme', 'ceviklik', 'topKontrol', 'denge'],
    aerial: ['kafaVurusu', 'ziplama', 'guc', 'pozisyonAlma'],
};
const TRAINING_LABELS = {
    shooting: 'Bitiricilik & Şut', passing: 'Oyun Kurma & Pas', defending: 'Savunma & Taktik',
    physical: 'Kondisyon & Hız', goalkeeping: 'Kalecilik & Refleks', tactical: 'Taktik & Analiz',
    setpiece: 'Duran Top & Frikik', technique: 'Teknik & Top Sürme', aerial: 'Hava Topu & Kafa',
    analysis: 'Performans Analizi',
};

// Antrenman türü -> geliştirdiği ana stat(lar) (akıllı seçim için)
const TRAINING_TYPE_STATS = {
    shooting: ['sut'], passing: ['pas'], defending: ['defans'], physical: ['fizik', 'hiz'],
    tactical: ['teknik', 'pas', 'defans'], setpiece: ['sut', 'pas'], technique: ['teknik'],
    aerial: ['defans', 'fizik', 'sut'],
};
// Mevki ailesi -> önemli ana statların ağırlığı
const POS_STAT_IMPORTANCE = {
    GK: { fizik: 0.6 }, // kaleci ayrı (goalkeeping)
    CB: { defans: 1.0, fizik: 0.85, hiz: 0.5, pas: 0.45 },
    FB: { hiz: 0.95, defans: 0.9, pas: 0.7, fizik: 0.6 },
    DM: { defans: 0.95, pas: 0.85, fizik: 0.7, teknik: 0.55 },
    CM: { pas: 1.0, teknik: 0.85, fizik: 0.6, defans: 0.5, hiz: 0.4 },
    AM: { pas: 0.9, teknik: 0.95, sut: 0.85, hiz: 0.55 },
    WM: { hiz: 0.95, pas: 0.85, teknik: 0.8, sut: 0.6 },
    W: { hiz: 0.95, sut: 0.9, teknik: 0.85, pas: 0.55 },
    ST: { sut: 1.0, fizik: 0.8, hiz: 0.75, teknik: 0.6 },
};
// AKILLI Hızlı Antrenman: mevki + yaş + hoca güveni + mevcut stat seviyeleri (zayıf-ama-önemliyi
// önceliklendir) baz alınarak her seferinde EN MANTIKLI antrenman türünü seçer.
function _smartQuickTrainingType(p) {
    if (!p) return 'physical';
    if (p.position === 'Kaleci') return 'goalkeeping';
    const fam = (typeof posFamily === 'function') ? posFamily(p.position) : 'CM';
    const IMP = POS_STAT_IMPORTANCE[fam] || { fizik: 0.8, hiz: 0.7, pas: 0.6, teknik: 0.5 };
    const stats = p.stats || {};
    const lowTrust = (p.managerTrust || 50) < 45;
    let coreStat = null, coreImp = -1;
    for (const s in IMP) if (IMP[s] > coreImp) { coreImp = IMP[s]; coreStat = s; }
    let best = 'physical', bestScore = -Infinity;
    for (const type in TRAINING_TYPE_STATS) {
        let score = 0;
        TRAINING_TYPE_STATS[type].forEach(s => {
            const imp = IMP[s] || 0.12;
            const cur = stats[s] || 50;
            const gap = Math.max(0, 90 - cur);                  // hedef 90; düşükse açık büyük
            const c = imp * (0.5 + gap / 22);                   // önem × (taban + zayıflık açığı)
            if (c > score) score = c;
        });
        if ((p.age || 25) <= 20 && type === 'physical') score *= 1.12;          // genç → atletik temel
        if (lowTrust && TRAINING_TYPE_STATS[type].includes(coreStat)) score *= 1.25; // düşük güven → asıl işine odaklan
        if (score > bestScore) { bestScore = score; best = type; }
    }
    return best;
}
function performTraining(type) {
    const p = gameState.player;
    if ((gameState.actionsDoneThisWeek || 0) >= 2) { showToast('Bu hafta en fazla 2 eylem yapabilirsin!', 'error'); return; }
    if (p.injury && type !== 'analysis') { showToast(`Sakatsın (${p.injury.name}) — antrenman yapamazsın. ${p.injury.weeks} hafta kaldı.`, 'error'); return; }
    const cost = { tactical: 20, setpiece: 20, analysis: 5 }[type] || 25;
    if (p.energy < cost) { showToast('Yeterli enerjin yok! Dinlenmen gerekiyor.', 'error'); return; }

    if (type === 'analysis') {
        p.energy -= cost; p.form = Math.min(100, p.form + 15); p.managerTrust = Math.min(100, p.managerTrust + 3);
        gameState.actionsDoneThisWeek = (gameState.actionsDoneThisWeek || 0) + 1;
        showToast('Performans analizi tamamlandı! (+15% Form, +3 Hoca Güveni)', 'success');
        saveGame(); updateUI(); return;
    }
    p.energy -= cost;
    let targets = (TRAINING_MAP[type] || TRAINING_MAP.physical).slice();
    if (type === 'goalkeeping' && p.position !== 'Kaleci') targets = TRAINING_MAP.physical;

    const team = getTeamById(p.teamId);
    const fac = (team.facilities && team.facilities.training) || 65;
    const facMul = 0.75 + fac / 130;                                  // 0.8 .. 1.5
    const youthMul = p.age <= 21 ? 1.35 : p.age <= 26 ? 1.0 : p.age <= 30 ? 0.7 : 0.45;
    const headroom = Math.max(0, (p.potential || p.ovr + 8) - p.ovr);
    const headMul = headroom <= 0 ? 0.15 : Math.min(1.5, 0.55 + headroom / 12);
    const oldOvr = p.ovr;
    let totalGain = 0;
    targets.forEach((k, i) => {
        const before = p.attrs[k] || 40;
        const base = (i === 0 ? 1.3 : 0.8) * (0.6 + Math.random() * 0.8);
        const after = Math.min(99, before + base * facMul * youthMul * headMul);
        totalGain += (after - before);
        p.attrs[k] = after;
    });
    recomputeMainStats(p);
    p.ovr = calculateOVR(p);
    p.value = calcMarketValue(p.ovr, p.age, team.prestige || 2);
    p.form = Math.min(100, (p.form || 60) + 1);

    gameState.actionsDoneThisWeek = (gameState.actionsDoneThisWeek || 0) + 1;
    // Gelisim takibi: bu antrenmanin anlik goruntusunu kaydet
    if (typeof recordDevSnapshot === 'function') recordDevSnapshot(p, 'antrenman', (TRAINING_LABELS && TRAINING_LABELS[type]) || 'Antrenman');
    const _tlabel = (TRAINING_LABELS && TRAINING_LABELS[type]) || 'Antrenman';
    let msg = `${_tlabel} tamam! Antrenman Puanı: +${totalGain.toFixed(1)} — Gelişen: ${targets.map(t => attrLabel(t)).join(', ')}.`;
    if (p.ovr > oldOvr) { msg += ` GENEL RATİNG ${p.ovr}!`; showToast(msg, 'success'); }
    else showToast(msg, 'info');
    saveGame(); updateUI();
}

// ---- Sakatken mac: oyuncu oynamaz, takim maci yine de sonuclanir ----
// NOT: atama biciminde sarmalanir (fonksiyon bildirimi hoisting ile orijinali ezerdi)
const _origStartMatchDay = window.startMatchDay;
window.startMatchDay = function () {
    const p = gameState.player;
    // Kupa maci ise sakatlik/ceza lig-maci sim'i CALISMASIN (kupa kendi yolundan)
    if (!window._euroMatchCtx && p && (p.injury || p.suspension)) {
        const wk = gameState.currentWeek - 1;
        const m = (gameState.fixtures[wk] || []).find(x => x.home === p.teamId || x.away === p.teamId);
        if (m && !m.isBay) {
            const [a, b] = simScore(m.home, m.away);
            m.scoreHome = a; m.scoreAway = b;
            updateTeamStandingsRecord(m.home, m.away, a, b);
            // Oynamadığın (sakat/cezalı) haftanın takım maçı da dünya kaydına girsin
            // (takım arkadaşlarının istatistikleri eksik kalmasın)
            try { if (typeof _recordUserMatchToWorld === 'function') _recordUserMatchToWorld(m, 0, 0, false, { ignoreState: true }); } catch (err) { /* sessiz */ }
            gameState.matchesPlayedThisWeek = true;
            if (p.suspension) {
                showToast(`Cezalısın (${p.suspension.reason}) — bu lig maçında oynamadın. Takımın: ${a}-${b}.`, 'warning');
                p.suspension.matches--; if (p.suspension.matches <= 0) p.suspension = null;
            } else {
                showToast(`Sakatlığın (${p.injury.name}) nedeniyle oynamadın. Takımın maçı: ${a}-${b}.`, 'warning');
            }
            saveGame(); updateUI(); return;
        }
    }
    return _origStartMatchDay.apply(this, arguments);
};

if (typeof window !== 'undefined') {
    Object.assign(window, {
        simulateOtherWeekMatches, advanceWeek, openSeasonEndModal, performTraining,
    });
}
