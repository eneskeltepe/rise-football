// SİM + PROFİL/ARAMA DÜZELTMELERİ (v2.14.1):
//  (1) gameConfirm html:true → <strong> biçimli render (sözleşme diyaloğu fix'i)
//  (2) profil Geçmiş sekmesi: Maç "20 (7)" (ilk 11 + yedek) + sarı/kırmızı kart sütunları
//  (3) foto lightbox (profil fotoğrafına tıkla → büyüt)
//  (4) yaşayan dünya: aramada/profilde transferin GÜNCEL kulübü + emekli oyuncuda "Emekli"
//  (5) takvim kulüpsüz gündemi: transfer haberi (n.player) + büyük liglerden skor
//  (6) sim sezon devri: stopClubless İŞARETLİ → yenileme diyaloğu (sim durur);
//      İŞARETSİZ → SORMADAN serbest kal + sim kulüpsüz devam (dünya gündemi akar)
//   http-server :3000 ayakta iken: node tools/test_simfix.js
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
        document.getElementById('player-firstname').value = 'Fix';
        document.getElementById('player-lastname').value = 'Test';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 500));

    // ---- Bölüm A: gameConfirm html desteği ----
    const dlg = await page.evaluate(async () => {
        const r = {};
        const p1 = gameConfirm({ title: 'T', message: 'Süre: <strong>2 yıl</strong>', html: true });
        await new Promise(res => setTimeout(res, 150));
        const msg = document.querySelector('#game-dialog-overlay .game-dialog-msg');
        r.htmlRendered = !!msg && !!msg.querySelector('strong') && !msg.textContent.includes('<strong>');
        document.querySelector('#game-dialog-overlay .game-dialog-actions .btn-secondary').click();
        await p1;
        await new Promise(res => setTimeout(res, 350));   // _busy reset (200ms)
        const p2 = gameConfirm({ message: '<strong>düz metin</strong>' });
        await new Promise(res => setTimeout(res, 150));
        const msg2 = document.querySelector('#game-dialog-overlay .game-dialog-msg');
        r.plainEscaped = !!msg2 && !msg2.querySelector('strong') && msg2.textContent.includes('<strong>');
        document.querySelector('#game-dialog-overlay .game-dialog-actions .btn-secondary').click();
        await p2;
        await new Promise(res => setTimeout(res, 350));
        return r;
    });

    // ---- Bölüm B: Geçmiş sekmesi 20 (7) + kart sütunları + foto lightbox ----
    const prof = await page.evaluate(async () => {
        const r = {};
        const slot = gameState._slot;
        const S0 = gameState.currentSeason;
        const gsId = gameState.player.teamId;
        await DB.loadPlayers('tur-super-lig');
        const squad = DB.squadSync(gsId).filter(x => Number.isFinite(Number(x.id)));
        const tp = squad.find(x => x.pos !== 'Kaleci' && x.img) || squad.find(x => x.pos !== 'Kaleci');
        const pid = Number(tp.id);
        gameState.currentSeason = S0 + 1;   // satır "geçmiş sezon" sayılsın
        await WorldDB.putAll('playerSeasons', [{ slot, playerId: pid, season: S0, leagueId: 'tur-super-lig', teamId: gsId, matches: 27, starts: 20, subApps: 7, goals: 9, assists: 3, yellows: 4, reds: 1, ownGoals: 0, cleanSheets: 0, motm: 2 }]);
        openPlayerProfile(String(pid), gsId);
        let host = null, row = null;
        for (let k = 0; k < 30 && !row; k++) {
            host = document.getElementById('pp-history');
            row = host ? [...host.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes(S0 + '/')) : null;
            if (!row) await new Promise(res => setTimeout(res, 250));
        }
        const cells = row ? [...row.querySelectorAll('td')].map(td => td.textContent.trim().replace(/\s+/g, ' ')) : [];
        // sütunlar: Sezon, Takım, Maç, Gol, Asist, SK, KK, MoM (GK değil → C.Sheet yok)
        r.histStartsSub = cells.length >= 8 && /^20 ?\(7\)$/.test(cells[2]);
        r.histCards = cells.length >= 8 && cells[5] === '4' && cells[6] === '1';
        r.histHeadChips = !!host && host.innerHTML.includes('pp-m-yc') && host.innerHTML.includes('pp-m-rc');
        // foto lightbox (fotolu oyuncuda)
        if (tp.img) {
            const ph = document.querySelector('#player-profile-body .pp-photo');
            ph.click();
            r.lightbox = !!document.getElementById('photo-lightbox');
            const lb = document.getElementById('photo-lightbox'); if (lb) lb.click();
            r.lightboxClosed = !document.getElementById('photo-lightbox');
        } else { r.lightbox = true; r.lightboxClosed = true; }   // fotosuz kadro (beklenmez)
        gameState.currentSeason = S0;
        document.getElementById('player-profile-modal').style.display = 'none';
        return r;
    });

    // ---- Bölüm C: yaşayan dünya — transferde GÜNCEL kulüp + Emekli (arama + profil) ----
    const world = await page.evaluate(async () => {
        const r = {};
        const slot = gameState._slot;
        const S0 = gameState.currentSeason;
        const gsId = gameState.player.teamId;
        const fbId = 'tur-super-lig__fenerbahce';
        // Tohumlama bitsin (IDB players yazımı sürerken kaydımız ezilmesin)
        for (let k = 0; k < 60; k++) {
            const ok = await WorldDB.isSeeded(slot).catch(() => false);
            if (ok) break;
            await new Promise(res => setTimeout(res, 300));
        }
        const squad = DB.squadSync(gsId).filter(x => Number.isFinite(Number(x.id)) && x.pos !== 'Kaleci');
        const moved = squad[1], ret = squad[2];
        await WorldDB.putAll('transfers', [{ slot, playerId: Number(moved.id), season: S0, fromTeam: gsId, toTeam: fbId, type: 'transfer', fee: 5000000 }]);
        await WorldDB.putAll('players', [{ slot, id: Number(ret.id), name: ret.name, teamId: gsId, retired: 1 }]);
        await WorldState.ensure(slot, true);
        r.movedApi = WorldState.currentTeamOf(Number(moved.id)) === fbId;
        r.retiredApi = WorldState.isRetired(Number(ret.id)) === true;
        // Arama: güncel kulüp + Emekli
        openGlobalSearch();
        for (let k = 0; k < 60; k++) { if (typeof _gsPlayerIdx !== 'undefined' && _gsPlayerIdx) break; await new Promise(res => setTimeout(res, 300)); }
        const fbName = (DB.getTeam(fbId) || {}).name || 'Fenerbahçe';
        _renderSearchResults(moved.name);
        const rowM = document.querySelector(`#global-search-results [data-pid="${moved.id}"]`);
        r.searchMoved = !!rowM && rowM.getAttribute('data-pteam') === fbId && rowM.textContent.includes(fbName);
        _renderSearchResults(ret.name);
        const rowR = document.querySelector(`#global-search-results [data-pid="${ret.id}"]`);
        r.searchRetired = !!rowR && rowR.textContent.includes('Emekli');
        closeGlobalSearch();
        // Profil: ESKİ takım id'siyle açılsa bile başlıkta güncel kulüp / Emekli
        openPlayerProfile(String(moved.id), gsId);
        r.profMoved = (document.querySelector('#player-profile-body .pp-club') || { textContent: '' }).textContent.includes(fbName);
        document.getElementById('player-profile-modal').style.display = 'none';
        openPlayerProfile(String(ret.id), gsId);
        const meta = document.querySelector('#player-profile-body .pp-meta');
        r.profRetired = !!meta && meta.textContent.includes('Emekli') && meta.textContent.includes('Futbolu bıraktı');
        document.getElementById('player-profile-modal').style.display = 'none';
        return r;
    });

    // ---- Bölüm D: takvim kulüpsüz gündemi (haber alanları + büyük lig skoru) ----
    const cal = await page.evaluate(async () => {
        const r = {};
        const p = gameState.player;
        gameState.transferNews = [{ player: 'Test Adamoğlu', from: 'A FC', to: 'B FC', fee: 5000000, season: gameState.currentSeason, window: 'summer' }];
        const _tid = p.teamId, _tn = p.teamName;
        p.teamId = null;
        document.querySelector('.nav-btn[data-target="calendar-tab"]').click();
        await new Promise(res => setTimeout(res, 300));
        _calShowDay(gameState.currentSeason, (gameState.gameDate || 0) + 3, 'test günü');
        const host = document.getElementById('cal-day-detail');
        r.newsPlayer = !!host && host.textContent.includes('Test Adamoğlu');
        r.newsLeague = !!host && /Premier|La Liga|Bundesliga|Serie A|Ligue 1|Süper Lig|Eredivisie|Primeira/i.test(host.textContent);
        p.teamId = _tid; p.teamName = _tn;
        gameState.transferNews = [];
        return r;
    });

    // ---- Bölüm E1: sözleşme bitişi + stopClubless İŞARETLİ → diyalog sorulur, sim durur ----
    await page.evaluate(() => {
        const p = gameState.player;
        p.contractDuration = 1; p.managerTrust = 90; p.injury = null;
        const tot = activeLeagueWeeks() || 36;
        gameState.currentWeek = tot;
        gameState.gameDate = weekToDay(tot) + 6;
        const lm = (gameState.fixtures[tot - 1] || []).find(x => !x.isBay && (x.home === p.teamId || x.away === p.teamId));
        if (lm) { lm.scoreHome = 1; lm.scoreAway = 0; }
        gameState.matchesPlayedThisWeek = true;
        gameState._lastSimWeek = tot - 1;
        window.__tgt1 = { season: gameState.currentSeason + 1, day: 8 };
        startSimToDate(window.__tgt1, { matchMode: 'auto', stopInjury: false, stopOffer: false, stopCup: false, stopWindow: false, stopClubless: true });
    });
    let dlgSeen = null;   // 5 sn geri sayım + otomatik devir + diyalog
    for (let i = 0; i < 50 && !dlgSeen; i++) {
        await new Promise(r => setTimeout(r, 500));
        dlgSeen = await page.evaluate(() => {
            const ov = document.getElementById('game-dialog-overlay');
            if (!(ov && ov.style.display === 'flex')) return null;
            const msg = ov.querySelector('.game-dialog-msg');
            return { strongOk: !!msg.querySelector('strong'), askText: msg.textContent.includes('uzatmak istiyor') };
        });
    }
    const e1 = await page.evaluate(() => {
        const r = { simNotResumed: !gameState._simPending, rolled: true };
        const ok = document.querySelector('#game-dialog-overlay .game-dialog-actions .btn-primary');
        if (ok) ok.click();   // Yenile
        return r;
    });
    await new Promise(r => setTimeout(r, 1200));
    const e1b = await page.evaluate(() => ({
        renewed: gameState.player.contractDuration > 0 && !!gameState.player.teamId,
        noOverlay: !document.getElementById('simto-overlay'),
    }));

    // ---- Bölüm E2: stopClubless İŞARETSİZ → SORMADAN serbest kal + sim kulüpsüz devam ----
    await page.evaluate(() => {
        const p = gameState.player;
        p.contractDuration = 1; p.managerTrust = 90; p.injury = null;
        const tot = activeLeagueWeeks() || 36;
        gameState.currentWeek = tot;
        gameState.gameDate = weekToDay(tot) + 6;
        const lm = (gameState.fixtures[tot - 1] || []).find(x => !x.isBay && (x.home === p.teamId || x.away === p.teamId));
        if (lm) { lm.scoreHome = 1; lm.scoreAway = 0; }
        gameState.matchesPlayedThisWeek = true;
        gameState._lastSimWeek = tot - 1;
        window.__tgt2 = { season: gameState.currentSeason + 1, day: 8 };
        startSimToDate(window.__tgt2, { matchMode: 'auto', stopInjury: false, stopOffer: false, stopCup: false, stopWindow: false, stopClubless: false });
    });
    let done2 = null;
    for (let i = 0; i < 90 && !done2; i++) {
        await new Promise(r => setTimeout(r, 500));
        done2 = await page.evaluate(() => {
            if (gameState.currentSeason !== window.__tgt2.season) return null;
            if ((gameState.gameDate || 0) < window.__tgt2.day) return null;
            const cb = document.getElementById('simto-close');
            if (!cb) return null;
            const feed = document.getElementById('simto-feed');
            const res = {
                freeAgent: !gameState.player.teamId,
                noDialog: !(document.getElementById('game-dialog-overlay') || { style: {} }).style.display ||
                    document.getElementById('game-dialog-overlay').style.display !== 'flex',
                feedNews: !!feed && (feed.innerHTML.includes('fa-globe') || feed.innerHTML.includes('fa-newspaper')),
            };
            cb.click();
            return res;
        });
    }

    await browser.close();

    const c = [];
    c.push(['Diyalog: html:true → <strong> biçimli render', dlg.htmlRendered === true, '']);
    c.push(['Diyalog: html\'siz mesaj düz metin (escape) kalır', dlg.plainEscaped === true, '']);
    c.push(['Geçmiş sekmesi: Maç "20 (7)" (ilk 11 + yedekten)', prof.histStartsSub === true, JSON.stringify(prof)]);
    c.push(['Geçmiş sekmesi: sarı (4) + kırmızı (1) sütunları', prof.histCards === true, '']);
    c.push(['Geçmiş sekmesi: kart çipleri tablo başlığında', prof.histHeadChips === true, '']);
    c.push(['Foto lightbox: tıkla → büyüt → tıkla → kapan', prof.lightbox && prof.lightboxClosed, '']);
    c.push(['WorldState.currentTeamOf: transferin güncel kulübü', world.movedApi === true, '']);
    c.push(['WorldState.isRetired: emekli bayrağı', world.retiredApi === true, '']);
    c.push(['Arama: transfer olan oyuncu GÜNCEL kulübüyle listelenir', world.searchMoved === true, '']);
    c.push(['Arama: emekli oyuncuda "Emekli" görünür', world.searchRetired === true, '']);
    c.push(['Profil: eski takımla açılsa bile başlıkta GÜNCEL kulüp', world.profMoved === true, '']);
    c.push(['Profil: emekli oyuncuda "Emekli" + "Futbolu bıraktı"', world.profRetired === true, '']);
    c.push(['Takvim gündemi: transfer haberi metni (n.player)', cal.newsPlayer === true, '']);
    c.push(['Takvim gündemi: büyük liglerden skor (lig adıyla)', cal.newsLeague === true, '']);
    c.push(['Sözleşme: kulüpsüz-dur İŞARETLİ → diyalog (biçimli) + sim durdu', !!dlgSeen && dlgSeen.strongOk && dlgSeen.askText && e1.simNotResumed, JSON.stringify(dlgSeen)]);
    c.push(['Sözleşme: "Yenile" çalıştı (kulüpte kaldı)', e1b.renewed && e1b.noOverlay, '']);
    c.push(['Sözleşme: İŞARETSİZ → sormadan serbest + sim devam edip hedefe ulaştı', !!done2 && done2.freeAgent && done2.noDialog, JSON.stringify(done2)]);
    c.push(['Kulüpsüz simde dünya gündemi aktı (skor/haber)', !!done2 && done2.feedNews === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== SİM + PROFİL/ARAMA DÜZELTMELERİ ===`);
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${ok ? '' : (info ? '  — ' + info : '')}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
