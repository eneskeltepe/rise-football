// FAZ B: (1) İstatistikler sekmesinde SEZON seçici + geçmiş sezon krallıkları (WorldDB playerSeasons),
//  (2) Küme düşme/çıkma + PLAYOFF (üst 2 otomatik + 3.–6. playoff = 3 çıkış, denge) tüm piramitlerde.
//   http-server :3000 ayakta iken: node tools/test_leaguesys.js
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
    await new Promise(r => setTimeout(r, 500));
    await page.evaluate(() => {
        document.getElementById('player-firstname').value = 'Test';
        document.getElementById('player-lastname').value = 'Sys';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 400));

    const out = await page.evaluate(async () => {
        const r = {};

        // ---- (2) PROMOSYON/PLAYOFF ----
        if (!gameState.standings) initAllStandings();
        const moves = runPromotionRelegation();
        r.moveCount = moves.length;
        r.hasUp = moves.some(m => m.dir === 'up'); r.hasDown = moves.some(m => m.dir === 'down');
        r.hasPlayoffVia = moves.some(m => m.dir === 'up' && m.via === 'playoff');
        r.hasAutoVia = moves.some(m => m.dir === 'up' && m.via === 'auto');
        r.playoffsStruct = Array.isArray(gameState._lastPlayoffs) && gameState._lastPlayoffs.length > 0;
        // EPL→Championship çiftinde denge: çıkan == düşen (3-3)
        const eplUp = moves.filter(m => m.dir === 'up' && m.league === 'eng-premier-league').length;
        const eplDown = moves.filter(m => m.dir === 'down' && m.league === 'eng-championship').length;
        r.eplBalanced = eplUp === 3 && eplDown === 3;
        // playoff yapısı: aday + kazanan
        const po = (gameState._lastPlayoffs || [])[0] || {};
        r.poHasCands = (po.candidates || []).length >= 1 && !!po.winner;
        // determinism: tekrar çalıştır → aynı kazanan (tohumlu)
        const po1w = (gameState._lastPlayoffs || [])[0] ? gameState._lastPlayoffs[0].winner : null;
        const w2 = _resolvePlayoff(standingsSorted('eng-championship'), gameState.currentSeason, 'eng-premier-league|0').winner;
        r.poDeterministic = po1w === w2;

        // ---- (1) İSTATİSTİK SEZON SEÇİCİ + geçmiş krallık ----
        await DB.loadPlayers('eng-premier-league');
        const slot = gameState._slot, cur0 = gameState.currentSeason, lg = 'eng-premier-league';
        const eplPlayers = DB.squadSync('eng-premier-league__liverpool').filter(p => /^\d+$/.test(String(p.id))).slice(0, 3);
        const ps = eplPlayers.map((p, i) => ({ slot, playerId: p.id, season: cur0, leagueId: lg, teamId: 'eng-premier-league__liverpool', matches: 38, starts: 38, subApps: 0, goals: 30 - i * 5, assists: 8, yellows: 2, reds: 0, cleanSheets: 0, motm: 5 }));
        await WorldDB.putAll('playerSeasons', ps);
        gameState.currentSeason = cur0 + 1;   // cur0 artık geçmiş

        document.querySelector('.nav-btn[data-target="stats-tab"]').click();
        gameState.statsView = { league: lg, cat: 'g', season: cur0 };
        renderStatsTab();
        await new Promise(res => setTimeout(res, 500));
        r.statsSeasonPicker = !!(document.getElementById('stats-season-picker') && document.getElementById('stats-season-picker').classList.contains('custom-dropdown'));
        const stxt = document.getElementById('stats-content').textContent;
        r.statsPastTopScorer = stxt.includes(eplPlayers[0].name.split(' ').pop()) || /30/.test(stxt);  // en golcü (30 gol)
        r.statsRows = document.querySelectorAll('#stats-content table tbody tr').length;
        return r;
    });

    await browser.close();

    const c = [];
    c.push(['Promosyon: hareket üretildi', out.moveCount > 0, `${out.moveCount} hareket`]);
    c.push(['Yükselme + düşme var', out.hasUp && out.hasDown, '']);
    c.push(['Otomatik yükselme (via:auto) var', out.hasAutoVia === true, '']);
    c.push(['Play-off yükselmesi (via:playoff) var', out.hasPlayoffVia === true, '']);
    c.push(['EPL↔Championship dengeli (3 çıkış / 3 düşüş)', out.eplBalanced === true, '']);
    c.push(['_lastPlayoffs yapısı kuruldu', out.playoffsStruct === true, '']);
    c.push(['Playoff aday + kazanan kayıtlı', out.poHasCands === true, '']);
    c.push(['Playoff DETERMİNİSTİK (tohumlu, tutarlı)', out.poDeterministic === true, '']);
    c.push(['İstatistik SEZON seçici (custom dropdown)', out.statsSeasonPicker === true, '']);
    c.push(['Geçmiş sezon krallığı render edildi', out.statsRows >= 1, `${out.statsRows} satır`]);
    c.push(['Geçmiş gol kralı (30 gol) görünüyor', out.statsPastTopScorer === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== FAZ B — LİG SİSTEMİ (stats geçmişi + promosyon/playoff) ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
