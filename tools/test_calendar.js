// ÖZELLİK — TAKVİM + TARİHE-KADAR-SİMÜLE (16-calview + 17-simto):
//  PES/FIFA tarzı ay görünümü (maç günleri, oynanmış skorlar W/B/M, pencere işareti,
//  bugün, geçmiş sezon arşivi, gelecek sezon iskeleti), gün detayı + "bu güne kadar
//  simüle et" seçenek modalı; sim motoru: otomatik maç oynama, maçta durma,
//  sakatlıkta durma, sezon-sonu bekleyen hedef (_simPending) + yeni sezonda devam.
//   http-server :3000 ayakta iken: node tools/test_calendar.js
const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PE: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('CE: ' + m.text()); });

    await page.goto('http://127.0.0.1:3000/index.html', { waitUntil: 'networkidle2', timeout: 30000 });
    await page.evaluate(async () => { localStorage.clear(); });
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 500));
    await page.evaluate(() => {
        document.getElementById('player-firstname').value = 'Cal';
        document.getElementById('player-lastname').value = 'Sim';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 500));

    // ---- Bölüm 1: eşleme + grid + gün detayı + seçenek modalı ----
    const out = await page.evaluate(async () => {
        const r = {};
        const p = gameState.player;
        const S = gameState.currentSeason;

        // Sezon ↔ tarih eşlemesi (8 Ağustos sınırı) + gidiş-dönüş
        r.seasonMap = _calSeasonOfDate(new Date(S, 7, 7)) === S - 1 && _calSeasonOfDate(new Date(S, 7, 8)) === S &&
            _calSeasonOfDate(new Date(S + 1, 3, 1)) === S;
        const d42 = _calDateOf2(S, 42);
        r.dayRoundtrip = _calDayIdx(S, d42) === 42;

        // Pencere kuralı: yaz 1-4, kış orta±1
        r.windowRule = _calWindowForWeek(2, 36) === 'summer' && _calWindowForWeek(18, 36) === 'winter' &&
            _calWindowForWeek(10, 36) === null && _calWindowForWeek(23, 46) === 'winter';

        // Sezon olayları: hafta-1 lig maçı doğru günde
        const ev = _calSeasonEvents(S);
        const d1 = fixtureDay(1, false);
        r.week1Marked = !!(ev[d1] && ev[d1][0] && ev[d1][0].type === 'league' && ev[d1][0].played === false);

        // Takvim sekmesi: nav butonu + grid render + bugün vurgusu
        const navBtn = document.querySelector('.nav-btn[data-target="calendar-tab"]');
        r.navExists = !!navBtn;
        navBtn.click();
        r.tabActive = document.getElementById('calendar-tab').classList.contains('active');
        r.gridRendered = document.querySelectorAll('#calendar-content .cal2-day[data-season]').length >= 28;
        r.todayMarked = !!document.querySelector('#calendar-content .cal2-day.today');
        r.matchMarked = !!document.querySelector('#calendar-content .cal2-day .cal2-mk');

        // Oynanmış maç → W/B/M skor çipi (hafta-1 maçına skor yaz, yeniden çiz)
        const m1 = gameState.fixtures[0].find(x => !x.isBay && (x.home === p.teamId || x.away === p.teamId));
        m1.scoreHome = (m1.home === p.teamId) ? 3 : 0; m1.scoreAway = (m1.home === p.teamId) ? 0 : 3;
        renderCalendarTab();
        r.resultChip = !!document.querySelector('#calendar-content .cal2-res.W');
        m1.scoreHome = null; m1.scoreAway = null;   // geri al (sim bölümü gerçek oynasın)

        // Gün detayı: gelecekteki bir güne tıkla → "Bu güne kadar simüle et"
        renderCalendarTab();
        const futureDay = (gameState.gameDate || 0) + 9;
        _calShowDay(S, futureDay, 'test günü');
        r.simBtn = !!document.getElementById('btn-cal-simto');

        // Seçenek modalı: radio + 5 durdurma kutusu + hiç-durmadan + başlat/vazgeç
        openSimToDateModal(S, futureDay);
        const om = document.getElementById('simto-options');
        r.optionsModal = !!om && om.querySelectorAll('input[name="simto-mm"]').length === 2 &&
            ['simto-injury', 'simto-offer', 'simto-cup', 'simto-window', 'simto-clubless', 'simto-nostop'].every(id => !!om.querySelector('#' + id));
        // "Hiç durmadan" diğerlerini kapatır
        om.querySelector('#simto-nostop').click();
        r.noStopDisables = om.querySelector('#simto-injury').disabled === true && om.querySelector('#simto-injury').checked === false;
        om.querySelector('#simto-cancel').click();
        r.modalClosed = !document.getElementById('simto-options');

        // Geçmişe/bugüne sim engellenir
        openSimToDateModal(S, 0);
        r.pastBlocked = !document.getElementById('simto-options');

        // GEÇMİŞ SEZON görünümü: matchLog arşivinden (geçici sezon 2027'ye sıçra)
        p.matchLog.push({ season: S, week: 5, leagueId: 'tur-super-lig', comp: null, home: p.teamId, away: 'tur-super-lig__fenerbahce', myTeam: p.teamId, sh: 2, sa: 1, rating: 7.7, g: 1, a: 0, motm: 0, mins: 90, started: true });
        gameState.currentSeason = S + 1;
        const evPast = _calSeasonEvents(S);
        const dPast = weekToDay(5) + 5;
        r.pastFromLog = !!(evPast[dPast] && evPast[dPast][0].played && evPast[dPast][0].sh === 2 && evPast[dPast][0].oppId === 'tur-super-lig__fenerbahce');
        // Gelecek sezon: olay yok (iskelet)
        const evFut = _calSeasonEvents(S + 2);
        r.futureSkeleton = Object.keys(evFut).length === 0;
        gameState.currentSeason = S;
        p.matchLog = p.matchLog.filter(l => l.week !== 5);

        // matchLog artık myTeam taşıyor + arşiv sınırı yükseldi (kaynak kontrolü)
        const hist = await (await fetch('src/58-history.js')).text();
        r.archiveWide = hist.includes('myTeam: p.teamId') && hist.includes('1200');
        return r;
    });

    // ---- Bölüm 2: SİM MOTORU — otomatik 16 gün (2 maç haftası) ----
    await page.evaluate(() => {
        window.__t0 = { date: gameState.gameDate || 0, week: gameState.currentWeek, m: gameState.player.currentSeasonStats.matches };
        startSimToDate({ season: gameState.currentSeason, day: (gameState.gameDate || 0) + 16 },
            { matchMode: 'auto', stopInjury: false, stopOffer: false, stopCup: false, stopWindow: false, stopClubless: false });
    });
    let simDone = false;
    for (let i = 0; i < 50 && !simDone; i++) {
        await new Promise(r => setTimeout(r, 400));
        simDone = await page.evaluate(() => {
            const c = document.getElementById('simto-close');
            if (c) { c.click(); return true; }
            return !document.getElementById('simto-overlay');
        });
    }
    const sim1 = await page.evaluate(() => {
        const r = {};
        r.reached = (gameState.gameDate || 0) >= window.__t0.date + 16;
        r.weeksAdvanced = gameState.currentWeek > window.__t0.week;
        r.matchesPlayed = gameState.player.currentSeasonStats.matches >= window.__t0.m + 2;
        const wk1 = gameState.fixtures[window.__t0.week - 1] || [];
        const my1 = wk1.find(x => !x.isBay && (x.home === gameState.player.teamId || x.away === gameState.player.teamId));
        r.scoreWritten = !!my1 && my1.scoreHome !== null;
        r.overlayGone = !document.getElementById('simto-overlay');
        r.uiRestored = typeof window.showToast === 'function' && typeof window.updateUI === 'function' && String(window.updateUI).length > 30;
        return r;
    });

    // ---- Bölüm 3: "Maçlarımda dur" — ilk maç gününde durmalı ----
    const sim2 = await page.evaluate(async () => {
        const r = {};
        const start = gameState.gameDate || 0;
        startSimToDate({ season: gameState.currentSeason, day: start + 14 },
            { matchMode: 'stop', stopInjury: false, stopOffer: false, stopCup: false, stopWindow: false, stopClubless: false });
        await new Promise(res => setTimeout(res, 4000));
        r.stoppedEarly = (gameState.gameDate || 0) < start + 14;
        r.onMatchDay = !!(typeof matchToday === 'function' && matchToday());
        const cb = document.getElementById('simto-close'); if (cb) cb.click();
        r.feedHadStop = true;
        return r;
    });

    // ---- Bölüm 4: SAKATLIKTA DUR (rollInjury stub'u ile garanti sakatlık) ----
    const sim3 = await page.evaluate(async () => {
        const r = {};
        const _ri = window.rollInjury;
        window.rollInjury = () => ({ name: 'Test Zorlaması', weeks: 2 });
        gameState.player.injury = null;
        const start = gameState.gameDate || 0;
        startSimToDate({ season: gameState.currentSeason, day: start + 20 },
            { matchMode: 'auto', stopInjury: true, stopOffer: false, stopCup: false, stopWindow: false, stopClubless: false });
        await new Promise(res => setTimeout(res, 6000));
        window.rollInjury = _ri;
        r.injured = !!gameState.player.injury;
        r.stoppedEarly = (gameState.gameDate || 0) < start + 20;
        const cb = document.getElementById('simto-close'); if (cb) cb.click();
        gameState.player.injury = null;   // sonraki bölüm temiz başlasın
        return r;
    });

    // ---- Bölüm 5: SEZON SONU + bekleyen hedef + YENİ SEZONDA DEVAM ----
    await page.evaluate(() => {
        const tot = activeLeagueWeeks() || 36;
        gameState.currentWeek = tot;
        gameState.gameDate = weekToDay(tot) + 6;   // son haftanın maç günü de geçti
        // Son hafta maçı GERÇEKTEN oynanmış: fikstüre skor yaz (tutarlı durum)
        const lm = (gameState.fixtures[tot - 1] || []).find(x => !x.isBay && (x.home === gameState.player.teamId || x.away === gameState.player.teamId));
        if (lm) { lm.scoreHome = 1; lm.scoreAway = 0; }
        gameState.matchesPlayedThisWeek = true;
        gameState._lastSimWeek = tot - 1;
        window.__target = { season: gameState.currentSeason + 1, day: 10 };
        startSimToDate(window.__target, { matchMode: 'auto', stopInjury: false, stopOffer: false, stopCup: false, stopWindow: false, stopClubless: false });
    });
    await new Promise(r => setTimeout(r, 2500));
    const pend = await page.evaluate(() => {
        const r = {};
        r.seasonModal = document.getElementById('season-end-modal').style.display === 'flex';
        r.pendingSet = !!gameState._simPending && gameState._simPending.season === window.__target.season;
        document.getElementById('btn-start-next-season').click();   // rollover → 700ms sonra sim devam
        return r;
    });
    let resumed = false;
    for (let i = 0; i < 60 && !resumed; i++) {
        await new Promise(r => setTimeout(r, 500));
        resumed = await page.evaluate(() => {
            const c = document.getElementById('simto-close'); if (c) c.click();
            return !gameState._simPending && gameState.currentSeason === window.__target.season &&
                (gameState.gameDate || 0) >= window.__target.day && !document.getElementById('simto-overlay');
        });
    }

    // ---- Bölüm 6: BAŞARILAR kulüp + oyuncu profillerinde (sim sonrası sezon 2'deyiz) ----
    const hon = await page.evaluate(async () => {
        const r = {};
        const slot = gameState._slot;
        const S = gameState.currentSeason - 1;   // biten sezon
        const gsId = 'tur-super-lig__galatasaray';
        await DB.loadPlayers('tur-super-lig');
        const real = DB.squadSync(gsId).find(x => Number.isFinite(Number(x.id)));
        const pid = Number(real.id);
        // Tohum: biten sezonun özeti (şampiyon GS + gol kralı pid) + kupa arşivi + Altın Top
        await WorldDB.setMeta(slot, 'summary_' + S, { season: S, leagues: { 'tur-super-lig': {
            championId: gsId, topScorer: { playerId: pid, teamId: gsId, name: real.name, goals: 30 },
            topAssist: { playerId: 999999 }, bestGk: { playerId: 999998 }, mvp: { playerId: 999997 },
        } } });
        await WorldDB.putAll('playerSeasons', [{ slot, playerId: pid, season: S, leagueId: 'tur-super-lig', teamId: gsId, matches: 30, starts: 30, subApps: 0, goals: 30, assists: 5, yellows: 0, reds: 0, ownGoals: 0, cleanSheets: 0, motm: 0 }]);
        gameState.cupHonors = [{ season: S, comp: 'Şampiyonlar Ligi', teamId: gsId }];
        gameState.ballonHistory = [{ season: S, userRank: 5, list: [{ rank: 1, pid: pid, name: real.name, teamId: gsId, g: 30, a: 5, score: 80, isUser: false }] }];
        _honorsSummaryCache = {};
        // Fonksiyon düzeyi
        const ch = await computeClubHonors(slot, gsId);
        r.clubHonors = ch.some(h => /Şampiyonluğu/.test(h.title) && h.season === S) && ch.some(h => h.title === 'Şampiyonlar Ligi Şampiyonluğu');
        const ph = await computePlayerHonors(slot, pid);
        r.playerHonors = ph.some(h => h.title === 'Altın Top') && ph.some(h => h.title === 'Gol Krallığı') &&
            ph.some(h => /Şampiyonluğu/.test(h.title));
        // (IDB, sezon-devri agregat yazımlarıyla meşgul olabilir → sabit bekleme yerine yoklama)
        const pollFor = async (id, txt) => {
            for (let k = 0; k < 30; k++) {
                const el = document.getElementById(id);
                if (el && txt.every(t => el.textContent.includes(t))) return true;
                await new Promise(res => setTimeout(res, 300));
            }
            return false;
        };
        // UI: kulüp modalı
        await openTeamSquad(gsId);
        r.clubUi = await pollFor('tsquad-honors', ['Kulüp Başarıları', 'Şampiyonluğu']);
        document.getElementById('team-squad-modal').style.display = 'none';
        // UI: dünya oyuncusu profili
        openPlayerProfile(String(pid), gsId);
        r.playerUi = await pollFor('pp-honors', ['Başarılar', 'Altın Top']);
        document.getElementById('player-profile-modal').style.display = 'none';
        return r;
    });

    await browser.close();

    const c = [];
    c.push(['Eşleme: sezon↔tarih (8 Ağustos sınırı) + gidiş-dönüş', out.seasonMap && out.dayRoundtrip, '']);
    c.push(['Pencere kuralı (yaz 1-4, kış orta±1, 46 haftalık lig)', out.windowRule === true, '']);
    c.push(['Hafta-1 maçı doğru günde işaretli', out.week1Marked === true, '']);
    c.push(['Takvim sekmesi: nav + grid + bugün + maç işareti', out.navExists && out.tabActive && out.gridRendered && out.todayMarked && out.matchMarked, '']);
    c.push(['Oynanmış maç → galibiyet çipi (W)', out.resultChip === true, '']);
    c.push(['Gün detayı: "Bu güne kadar simüle et" butonu', out.simBtn === true, '']);
    c.push(['Seçenek modalı: 2 radyo + 6 kutu', out.optionsModal === true, '']);
    c.push(['"Hiç durmadan git" diğer kutuları kapatır', out.noStopDisables && out.modalClosed, '']);
    c.push(['Geçmişe/bugüne simülasyon engellenir', out.pastBlocked === true, '']);
    c.push(['Geçmiş sezon arşivden okunur (skor+rakip)', out.pastFromLog === true, '']);
    c.push(['Gelecek sezon iskelet (olay yok)', out.futureSkeleton === true, '']);
    c.push(['matchLog: myTeam alanı + geniş arşiv (1200)', out.archiveWide === true, '']);
    c.push(['Sim: hedef tarihe ulaşıldı (16 gün)', sim1.reached === true, '']);
    c.push(['Sim: haftalar ilerledi + 2 maç otomatik oynandı', sim1.weeksAdvanced && sim1.matchesPlayed, '']);
    c.push(['Sim: maç skoru fikstüre yazıldı', sim1.scoreWritten === true, '']);
    c.push(['Sim: overlay kapandı + UI fonksiyonları geri geldi', sim1.overlayGone && sim1.uiRestored, '']);
    c.push(['Sim: "maçlarımda dur" ilk maç gününde durdu', sim2.stoppedEarly && sim2.onMatchDay, '']);
    c.push(['Sim: sakatlanınca durdu', sim3.injured && sim3.stoppedEarly, '']);
    c.push(['Sezon sonunda durdu + bekleyen hedef kaydedildi', pend.seasonModal && pend.pendingSet, '']);
    c.push(['Yeni sezonda kaldığı yerden devam edip hedefe ulaştı', resumed === true, '']);
    c.push(['Başarılar: kulüp (lig + kıta kupası şampiyonlukları)', hon.clubHonors === true, '']);
    c.push(['Başarılar: dünya oyuncusu (Altın Top + krallık + şampiyonluk)', hon.playerHonors === true, '']);
    c.push(['UI: kulüp modalında "Kulüp Başarıları" bloğu', hon.clubUi === true, '']);
    c.push(['UI: oyuncu profilinde "Başarılar" bloğu', hon.playerUi === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== ÖZELLİK — TAKVİM + TARİHE-KADAR-SİMÜLE ===`);
    console.log(JSON.stringify({ out, sim1, sim2, sim3, pend, resumed }).slice(0, 800) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
