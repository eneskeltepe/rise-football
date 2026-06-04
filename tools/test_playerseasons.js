// Faz 2b doğrulama — playerSeasons agregatı (maçlardan) tutarlı mı (Puppeteer, gerçek IDB).
//   http-server :3000 ayakta iken: node tools/test_playerseasons.js
const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE.ERR: ' + m.text()); });

    await page.goto('http://127.0.0.1:3000/index.html', { waitUntil: 'networkidle2', timeout: 30000 });
    await page.evaluate(async () => {
        localStorage.clear();
        await new Promise(res => { const r = indexedDB.deleteDatabase('fc_world_db'); r.onsuccess = r.onerror = r.onblocked = () => res(); });
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 600));
    await page.evaluate(() => {
        document.getElementById('player-firstname').value = 'Test';
        document.getElementById('player-lastname').value = 'PS';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });

    const out = await page.evaluate(async () => {
        const r = {};
        const slot = gameState._slot, season = gameState.currentSeason;
        const userLg = activeLeagueId(), userTeam = gameState.player.teamId;
        const otherLg = 'eng-premier-league', W = 8;
        await DB.ensureLeagues(DB.leagues().filter(l => l.type === 'league').map(l => l.id));
        await WorldDB.seedCareer(slot);
        for (let w = 0; w < W; w++) { simulateWorldWeek(w, userLg, userTeam); await recordWorldWeekDetails(slot, w, season, userLg, userTeam); }

        const t0 = Date.now();
        r.agg = await WorldDB.aggregatePlayerSeasons(slot, season);
        r.aggMs = Date.now() - t0;

        // otherLg maçlarını topla
        let matches = [];
        for (let w = 0; w < W; w++) matches = matches.concat(await WorldDB.matchesOfWeek(slot, season, otherLg, w));
        r.matchN = matches.length;
        let totalGoals = 0; for (const m of matches) totalGoals += m.sh + m.sa;

        const ps = await WorldDB.leagueSeasonStats(slot, season, otherLg);
        r.psCount = ps.length;
        let sumG = 0, sumOG = 0, sumA = 0, appsBad = 0, matchesBad = 0;
        for (const p of ps) {
            sumG += p.goals; sumOG += p.ownGoals; sumA += p.assists;
            if (p.starts + p.subApps !== p.matches) appsBad++;
        }
        r.sumG = sumG; r.sumOG = sumOG; r.sumA = sumA; r.totalGoals = totalGoals; r.appsBad = appsBad;

        // En golcüyü maçlardan yeniden türet
        const sample = ps.slice().sort((a, b) => b.goals - a.goals)[0];
        if (sample) {
            let dg = 0, da = 0, dapps = 0, dstarts = 0, dsubs = 0;
            for (const m of matches) {
                const inXi = (m.homeXI || []).includes(sample.playerId) || (m.awayXI || []).includes(sample.playerId);
                const inSub = (m.homeSubs || []).includes(sample.playerId) || (m.awaySubs || []).includes(sample.playerId);
                if (inXi) { dapps++; dstarts++; } else if (inSub) { dapps++; dsubs++; }
                for (const ev of (m.events || [])) {
                    if (ev.type === 'goal' && !ev.ownGoal && ev.playerId === sample.playerId) dg++;
                    if (ev.type === 'goal' && ev.assistId === sample.playerId) da++;
                }
            }
            const pl = DB.playerByIdSync(sample.playerId);
            r.sample = { name: pl ? pl.name : sample.playerId, ps: { g: sample.goals, a: sample.assists, m: sample.matches, st: sample.starts, sub: sample.subApps },
                derived: { g: dg, a: da, m: dapps, st: dstarts, sub: dsubs } };
            r.sampleGoalsOk = sample.goals === dg;
            r.sampleAssistsOk = sample.assists === da;
            r.sampleAppsOk = sample.matches === dapps && sample.starts === dstarts && sample.subApps === dsubs;
        }
        // XI hep 11 mi
        r.xiAll11 = matches.every(m => (m.homeXI || []).length === 11 && (m.awayXI || []).length === 11);
        return r;
    });

    await browser.close();

    const checks = [];
    checks.push(['playerSeasons üretildi', out.psCount > 100, `${out.psCount} oyuncu (Premier)`]);
    checks.push(['Diziliş XI = 11 (tüm maçlar)', out.xiAll11, '']);
    checks.push(['Değişmez: Σgol + Σ(kendi kalesi) = lig toplam golü', out.sumG + out.sumOG === out.totalGoals, `${out.sumG}+${out.sumOG} vs ${out.totalGoals}`]);
    checks.push(['Değişmez: starts + subApps = matches (herkes)', out.appsBad === 0, `${out.appsBad} aykırı`]);
    checks.push(['Örnek golcü: gol sayısı maçlarla tutuyor', out.sampleGoalsOk, JSON.stringify(out.sample)]);
    checks.push(['Örnek golcü: asist sayısı tutuyor', out.sampleAssistsOk, '']);
    checks.push(['Örnek golcü: maç/ilk-11/yedek tutuyor', out.sampleAppsOk, '']);
    checks.push(['Perf: agregat makul (<4000ms)', out.aggMs < 4000, `${out.aggMs}ms / ${out.matchN} Premier maçı (tüm ligler agregat)`]);
    checks.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== FAZ 2b — playerSeasons agregatı ===`);
    console.log(`Agregat: ${out.agg.players} oyuncu, ${out.agg.matches} maç (${out.aggMs}ms) | Örnek:`, JSON.stringify(out.sample));
    console.log(`Premier: Σgol=${out.sumG} +kendi kalesi=${out.sumOG} = ${out.sumG + out.sumOG}, lig toplam=${out.totalGoals}, Σasist=${out.sumA}\n`);
    let pass = 0;
    for (const [name, ok, info] of checks) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${name}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${checks.length} geçti.`);
    process.exit(pass === checks.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
