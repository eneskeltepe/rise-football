// Puppeteer smoke test — tarayicida uctan uca dogrulama
const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const errors = [], logs = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message + ' | ' + (e.stack || '').split('\n').slice(1, 4).join(' <- ')));
    page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE.ERR: ' + m.text()); else logs.push(m.text()); });

    await page.goto('http://127.0.0.1:3000/index.html', { waitUntil: 'networkidle2', timeout: 30000 });
    // localStorage temizle (taze baslangic)
    await page.evaluate(() => { localStorage.clear(); });
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 800));

    // 1) Olusturma ekrani + 12 pozisyon
    const posCount = await page.$$eval('input[name="position"]', els => els.length);
    const leagueOpts = await page.evaluate(() => document.querySelectorAll('#dropdown-league .dropdown-option').length);
    console.log('TEST1 pozisyon radyo:', posCount, '| lig secenek:', leagueOpts);

    // 2) Karakter olustur (Santrfor / Galatasaray)
    const created = await page.evaluate(() => {
        document.getElementById('player-firstname').value = 'Test';
        document.getElementById('player-lastname').value = 'Forvet';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        const p = gameState.player;
        return p ? { ovr: p.ovr, pos: p.position, team: p.teamName, pot: p.potential, hasAttrs: !!(p.attrs && p.attrs.bitiricilik), value: p.value, wage: p.wage } : null;
    });
    console.log('TEST2 olusturulan oyuncu:', created);
    const onDash = await page.evaluate(() => document.getElementById('game-interface').classList.contains('active'));
    console.log('TEST2 dashboard aktif:', onDash);

    // 3) Aktif lig kadrosu yuklendi mi + 11 dizilis kurulabiliyor mu
    await new Promise(r => setTimeout(r, 600));
    const squad = await page.evaluate(async () => {
        await window.DB.loadPlayers('tur-super-lig');
        const sq = window.DB.squadSync('tur-super-lig__galatasaray');
        return { squadSize: sq.length, sample: sq.slice(0, 2).map(p => p.name + ' ' + p.ovr) };
    });
    console.log('TEST3 GS kadro:', squad);

    // 4) 3 hafta ilerlet (dunya sim) + puan durumu
    const adv = await page.evaluate(() => {
        for (let i = 0; i < 3; i++) window.advanceWeek();
        const lid = window.activeLeagueId();
        const s = window.standingsSorted(lid);
        return { hafta: gameState.currentWeek, lider: window.DB.getTeam(s[0].id).name, lOyn: s[0].played,
                 ligSayisi: Object.keys(gameState.standings).length };
    });
    console.log('TEST4 ilerleme:', adv);

    // 5) Puan durumu UI + lig degistirme
    await page.evaluate(() => { document.querySelector('[data-target="tab-standings"]')?.click(); });
    await new Promise(r => setTimeout(r, 300));
    const stUI = await page.evaluate(() => {
        window.updateStandingsTable();
        const rows = document.querySelectorAll('#standings-body tr').length;
        const picker = document.getElementById('standings-league-picker');
        const hidden = picker && picker.querySelector('input[type="hidden"]');
        let rows2 = 0;
        if (hidden) { hidden.value = 'eng-premier-league'; hidden.dispatchEvent(new Event('change')); rows2 = document.querySelectorAll('#standings-body tr').length; }
        return { superLigRows: rows, premierRows: rows2, pickerVar: !!picker };
    });
    console.log('TEST5 puan durumu UI:', stUI);

    // 6) Transfer teklifi uretimi (dunya capi)
    const offers = await page.evaluate(() => {
        const p = gameState.player;
        p.currentSeasonStats.matches = 8; p.currentSeasonStats.ratings = [7, 7.5, 8, 7];
        gameState.currentWeek = 12;
        window.generateTransferOffers();
        return gameState.transferOffers.map(o => o.clubName + ' (' + o.leagueName + ', ' + o.squadRole + ')');
    });
    console.log('TEST6 transfer teklifleri:', offers);

    // 7) Kadro modali (gercek oyuncular)
    const roster = await page.evaluate(() => {
        window.showTeamRosterModal('tur-super-lig__fenerbahce');
        const rows = document.querySelectorAll('#roster-modal-body tr').length;
        const first = document.querySelector('#roster-modal-body tr td:nth-child(2)')?.textContent.trim();
        return { rows, first };
    });
    console.log('TEST7 kadro modali:', roster);

    // 8) Mac gunu dizilisi (gercek kadro + foto)
    const match = await page.evaluate(async () => {
        await window.DB.loadPlayers('tur-super-lig');
        gameState.player.managerTrust = 70;
        gameState.currentWeek = 1; gameState.matchesPlayedThisWeek = false;
        window.setActiveLeagueFixtures(); gameState._fxLeague = window.activeLeagueId();
        window.startMatchDay();
        if (activeMatch && activeMatch.timerId) clearInterval(activeMatch.timerId);
        const ml = matchLineups;
        return {
            my: ml.myTeam.length, opp: ml.oppTeam.length,
            userCount: ml.myTeam.filter(x => x.isUser).length,
            realTeammates: ml.myTeam.filter(x => !x.isUser && x.img).length,
            oppRealNames: ml.oppTeam.slice(0, 3).map(x => x.name),
        };
    });
    console.log('TEST8 mac dizilisi:', match);

    // 9) Sezon sonu -> yeni sezon (gelisim + altyapi + evrim)
    const season = await page.evaluate(() => {
        document.getElementById('matchday-screen')?.classList.remove('active');
        document.getElementById('game-interface')?.classList.add('active');
        const before = { ovr: gameState.player.ovr, age: gameState.player.age, season: gameState.currentSeason };
        gameState.currentWeek = window.activeLeagueWeeks();
        window.openSeasonEndModal();
        document.getElementById('btn-start-next-season').click();
        const p = gameState.player;
        return { before, after: { ovr: p.ovr, age: p.age, season: gameState.currentSeason }, youth: (p.youthProspects || []).length, week: gameState.currentWeek };
    });
    console.log('TEST9 sezon gecisi:', season);

    // 10) v1 -> v2 migrasyon
    const mig = await page.evaluate(() => {
        localStorage.clear();
        localStorage.setItem('football_career_save_v1', JSON.stringify({
            player: { firstname: 'Eski', lastname: 'Oyuncu', position: 'Kanat', teamId: 'GS', teamName: 'Galatasaray',
                stats: { hiz: 80, sut: 70, pas: 65, defans: 40, fizik: 70, teknik: 78 }, ovr: 75, age: 24, value: 1, wage: 1,
                contractDuration: 2, energy: 100, form: 70, managerTrust: 50, fansLove: 40,
                careerStats: { matches: 10, goals: 5, assists: 3, saves: 0, yellowCards: 0, redCards: 0, ratings: [7, 7] },
                currentSeasonStats: { matches: 0, goals: 0, assists: 0, saves: 0, yellowCards: 0, redCards: 0, ratings: [] } },
            currentSeason: 2027, currentWeek: 10, trophies: [], careerHistory: []
        }));
        const ok = window.loadGame();
        const mp = gameState.player;
        return { ok, pos: mp.position, team: mp.teamName, teamId: mp.teamId, hasAttrs: !!(mp.attrs && mp.attrs.topSurme), ovr: mp.ovr, standings: !!gameState.standings };
    });
    console.log('TEST10 v1->v2 migrasyon:', mig);

    // 11) Antrenman alt-statlari yukseltir -> OVR artar
    const train = await page.evaluate(() => {
        const p = gameState.player; p.injury = null; p.age = 19;
        const beforeOvr = p.ovr, beforePas = p.attrs.kisaPas;
        for (let i = 0; i < 6; i++) { gameState.actionsDoneThisWeek = 0; p.energy = 100; window.performTraining('passing'); }
        return { beforeOvr, afterOvr: p.ovr, kisaPasUp: Math.round(p.attrs.kisaPas - beforePas) };
    });
    console.log('TEST11 antrenman:', train);

    // 12) Sakatken antrenman engellenir
    const injBlock = await page.evaluate(() => {
        const p = gameState.player; p.injury = { name: 'Test', weeks: 2 }; gameState.actionsDoneThisWeek = 0; p.energy = 100;
        const before = p.attrs.kisaPas; window.performTraining('passing');
        return { blocked: Math.round(p.attrs.kisaPas) === Math.round(before) };
    });
    console.log('TEST12 sakatken antrenman:', injBlock);

    // 13) Kulup karti render
    const cardR = await page.evaluate(() => {
        gameState.player.injury = null; window.updateUI();
        const c = document.getElementById('club-info-card');
        return { visible: c && c.style.display !== 'none', stadyum: c.innerHTML.includes('Stadyum'), tesis: c.innerHTML.includes('Antrenman Tesisi'), detayli: c.innerHTML.includes('Detaylı') };
    });
    console.log('TEST13 kulup karti:', cardR);

    // 14) Uluslararasi kupalar
    const cups = await page.evaluate(() => {
        gameState.player.teamId = 'tur-super-lig__galatasaray'; gameState.player.ovr = 85; gameState.player.form = 80;
        const res = window.runSeasonCups(2027);
        window.updateUI();
        // (Kupalar sekmesi FAZ B'de kaldırıldı → #cups-content yok; runSeasonCups SONUÇ üretimini doğrula.)
        return {
            comps: Object.keys(res),
            uclChampion: (window.DB.getTeam(res.ucl.champion) || {}).name,
            uclPlayerIn: res.ucl.playerIn, uclPlayerExit: res.ucl.playerExit,
            libChampion: res.lib ? (window.DB.getTeam(res.lib.champion) || {}).name : null,
            tabOk: Object.keys(res).length > 0,
        };
    });
    console.log('TEST14 kupalar:', cups);

    // 15) Yurt disi transfer -> aktif lig degisimi + fikstur yenilenmesi
    const sw = await page.evaluate(async () => {
        const tgt = window.DB.teamsInLeague('eng-premier-league')[0];
        gameState.player.teamId = tgt.id; gameState.player.teamName = tgt.name; gameState.player.injury = null;
        window.updateUI();                       // _syncActiveLeague -> fikstur yenile + kadro yukle
        const lid = window.activeLeagueId();
        await window.DB.loadPlayers(lid);
        await window.DB.loadPlayers(window.DB.getTeam(tgt.id).srcLeague);   // terfi eden takimlarin oyuncu dosyasi
        gameState.currentWeek = 1; gameState.matchesPlayedThisWeek = false; gameState._lastSimWeek = -1;
        window.advanceWeek();
        return { newLeague: lid, weeks: window.activeLeagueWeeks(), fxLen: gameState.fixtures.length, week: gameState.currentWeek, squad: window.DB.squadSync(tgt.id).length };
    });
    console.log('TEST15 yurt disi transfer:', sw);

    console.log('\n=== KONSOL HATALARI (' + errors.length + ') ===');
    errors.slice(0, 25).forEach(e => console.log('  ' + e));
    await browser.close();
    process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('SMOKE TEST CRASH:', e); process.exit(2); });
