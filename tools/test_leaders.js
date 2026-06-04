// Faz 3b doğrulama — gol krallığı GERÇEK veriden (WorldStats, matches'ten) (Puppeteer).
//   http-server :3000 ayakta iken: node tools/test_leaders.js
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
        document.getElementById('player-lastname').value = 'Lead';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });

    const out = await page.evaluate(async () => {
        const r = {};
        const slot = gameState._slot, season = gameState.currentSeason;
        const userLg = activeLeagueId(), userTeam = gameState.player.teamId;
        const otherLg = 'eng-premier-league', W = 10;
        await DB.ensureLeagues(DB.leagues().filter(l => l.type === 'league').map(l => l.id));
        await WorldDB.seedCareer(slot);
        for (let w = 0; w < W; w++) { simulateWorldWeek(w, userLg, userTeam); await recordWorldWeekDetails(slot, w, season, userLg, userTeam); }
        WorldStats.invalidate();   // gerçek oyunda simulateOtherWeekMatches bunu yapar (test doğrudan çağırdı)

        r.readyBefore = WorldStats.ready(slot, season);
        const t0 = Date.now();
        await WorldStats.ensureSeason(slot, season);
        r.cacheMs = Date.now() - t0;
        r.readyAfter = WorldStats.ready(slot, season);

        const leaders = computeLeagueLeaders(otherLg);
        r.hasLeaders = !!(leaders && leaders.length);
        r.leaderCount = leaders ? leaders.length : 0;
        const scorers = (leaders || []).filter(x => !x.isUser).slice().sort((a, b) => b.g - a.g);
        const top = scorers[0];
        r.top = top ? { name: top.name, team: top.teamName, g: top.g, a: top.a, m: top.played, motm: top.motm } : null;

        // En golcünün golünü maçlardan yeniden türet (maç detayı ile AYNI kaynak → tutmalı)
        if (top) {
            let matches = [];
            for (let w = 0; w < W; w++) matches = matches.concat(await WorldDB.matchesOfWeek(slot, season, otherLg, w));
            let dg = 0, da = 0;
            for (const m of matches) for (const ev of (m.events || [])) {
                if (ev.type === 'goal' && !ev.ownGoal && ev.playerId === top.id) dg++;
                if (ev.type === 'goal' && ev.assistId === top.id) da++;
            }
            r.derivedG = dg; r.derivedA = da;
            r.goalMatch = (dg === top.g); r.assistMatch = (da === top.a);
        }
        // Krallık golleri lig toplam golüyle tutarlı mı (Σ leaders.g + Σ kullanıcı hariç ≈ lig golleri)
        let sumG = 0; for (const x of (leaders || [])) if (!x.isUser) sumG += x.g;
        r.sumLeaderG = sumG;
        return r;
    });

    await browser.close();

    const checks = [];
    checks.push(['WorldStats cache kuruldu (ready)', out.readyAfter === true && out.readyBefore === false, `önce=${out.readyBefore} sonra=${out.readyAfter}`]);
    checks.push(['Krallık GERÇEK veriden dolu', out.hasLeaders && out.leaderCount > 50, `${out.leaderCount} oyuncu`]);
    checks.push(['En golcü mevcut + makul', out.top && out.top.g >= 2, JSON.stringify(out.top)]);
    checks.push(['En golcü golü = maçlardan türetilen (maç detayıyla tutarlı)', out.goalMatch, `krallık=${out.top && out.top.g} türetilen=${out.derivedG}`]);
    checks.push(['En golcü asisti = türetilen', out.assistMatch, `krallık=${out.top && out.top.a} türetilen=${out.derivedA}`]);
    checks.push(['Perf: cache makul (<3000ms)', out.cacheMs < 3000, `${out.cacheMs}ms`]);
    checks.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== FAZ 3b — gol krallığı gerçek veriden ===`);
    console.log(`Cache: ${out.cacheMs}ms | krallık ${out.leaderCount} oyuncu | en golcü:`, JSON.stringify(out.top), `| Σkrallık gol=${out.sumLeaderG}\n`);
    let pass = 0;
    for (const [name, ok, info] of checks) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${name}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${checks.length} geçti.`);
    process.exit(pass === checks.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
