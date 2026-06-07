// FAZ B: GEÇMİŞ SEZONLAR artık "Lig & Fikstür" HUB'ında (ayrı Tarihçe sekmesi YOK).
//  Hub'da geçmiş sezon + lig seçilince: puan durumu (WorldDB teamSeasons) + fikstür
//  (WorldDB matchesOfWeek) + maça tıkla → detay. (Eski test_historyui'nin yerini alır.)
//   http-server :3000 ayakta iken: node tools/test_historyui.js
const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PE: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('CE: ' + m.text()); });

    await page.goto('http://127.0.0.1:3000/index.html', { waitUntil: 'networkidle2', timeout: 30000 });
    await page.evaluate(async () => {
        localStorage.clear();
        await new Promise(res => { const r = indexedDB.deleteDatabase('fc_world_db'); r.onsuccess = r.onerror = r.onblocked = () => res(); });
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 600));
    await page.evaluate(() => {
        document.getElementById('player-firstname').value = 'Test';
        document.getElementById('player-lastname').value = 'Hist';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 400));

    const out = await page.evaluate(async () => {
        const r = {};
        const slot = gameState._slot, cur0 = gameState.currentSeason, lg = 'eng-premier-league';
        await DB.ensureLeagues([lg]);
        const teams = DB.teamsInLeague(lg).slice(0, 6).map(t => t.id);
        r.teamName = (DB.getTeam(teams[0]) || {}).name || '';
        // cur0 sezonu için veri yaz, sonra currentSeason'ı artır → cur0 artık GEÇMİŞ sezon olur
        const ts = teams.map((tid, i) => ({ slot, teamId: tid, season: cur0, leagueId: lg, P: 38, W: 30 - i * 3, D: 5, L: 3 + i * 3, GF: 80 - i * 5, GA: 30 + i * 4, Pts: 95 - i * 9, rank: i + 1, budget: 0 }));
        await WorldDB.putAll('teamSeasons', ts);
        await WorldDB.recordMatches([
            { slot, id: cur0 + ':' + lg + ':0:' + teams[0] + ':' + teams[1], season: cur0, week: 0, leagueId: lg, home: teams[0], away: teams[1], sh: 2, sa: 1, homeXI: [], awayXI: [], homeSubs: [], awaySubs: [], events: [{ min: 10, type: 'goal', teamId: teams[0], playerId: null }] },
            { slot, id: cur0 + ':' + lg + ':0:' + teams[2] + ':' + teams[3], season: cur0, week: 0, leagueId: lg, home: teams[2], away: teams[3], sh: 0, sa: 0, homeXI: [], awayXI: [], homeSubs: [], awaySubs: [], events: [] },
        ]);

        // Bir sezon ilerlemiş gibi yap → cur0 GEÇMİŞ olur; hub'da geçmiş sezon + lig seç
        gameState.currentSeason = cur0 + 1;
        document.querySelector('.nav-btn[data-target="standings-tab"]').click();
        gameState.viewStandingsLeague = lg; gameState.viewStandingsSeason = cur0;
        updateStandingsTable(); renderFixturesForWeek(1);
        await new Promise(res => setTimeout(res, 600));

        r.curS = gameState.currentSeason; r.viewS = gameState.viewStandingsSeason;
        r.seasonUsed = (typeof currentStandingsSeason === 'function') ? currentStandingsSeason() : '?';
        r.tsCount = (await WorldDB.getAllByIndex('teamSeasons', 'bySlotSeasonLeague', IDBKeyRange.only([slot, cur0, lg]))).length;
        r.slot = slot;
        await new Promise(res => setTimeout(res, 400));
        r.firstRowTxt = (document.querySelector('#standings-body tr') || {}).textContent || '';
        r.standRows = document.querySelectorAll('#standings-body tr').length;
        r.standHasTeam = document.getElementById('standings-body').textContent.includes(r.teamName);
        r.fxRows = document.querySelectorAll('#fixtures-list .fixture-item').length;
        r.fxScore = document.getElementById('fixtures-list').textContent.includes('2 - 1');
        return r;
    });

    // Geçmiş maça tıkla → detay modalı (WorldDB'den gerçek skor/olay)
    let detail = {};
    if (out.fxRows > 0) {
        await page.click('#fixtures-list .fixture-item');
        await new Promise(r => setTimeout(r, 700));
        detail = await page.evaluate(() => {
            const m = document.getElementById('match-detail-modal');
            const body = document.getElementById('match-detail-body');
            return { open: m && getComputedStyle(m).display === 'flex', hasScore: !!(body && body.querySelector('.md-score')), z: parseInt(getComputedStyle(m).zIndex, 10) || 0 };
        });
    }

    await browser.close();

    const c = [];
    c.push(['Geçmiş sezon puan durumu (teamSeasons, tüm lig + özel veri)', out.standRows >= 6 && /95/.test(out.firstRowTxt), `${out.standRows} satır, ilk: ${out.firstRowTxt.replace(/\s+/g, ' ').trim().slice(0, 40)}`]);
    c.push(['Puan durumunda takım görünüyor', out.standHasTeam === true, out.teamName]);
    c.push(['Geçmiş hafta fikstürü (matchesOfWeek, 2 maç)', out.fxRows === 2, `${out.fxRows} maç`]);
    c.push(['Fikstürde gerçek skor (2-1)', out.fxScore === true, '']);
    c.push(['Maça tıkla → detay modalı açıldı', detail.open === true, '']);
    c.push(['Detayda skor var', detail.hasScore === true, '']);
    c.push(['Detay üstte (z-index)', (detail.z || 0) >= 100000, `z=${detail.z}`]);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== FAZ B — GEÇMİŞ SEZONLAR (Lig & Fikstür hub) ===`);
    console.log(JSON.stringify(out) + '\n' + JSON.stringify(detail) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
