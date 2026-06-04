// Faz 4c doğrulama — sezon özeti (şampiyon + bireysel ödüller) WorldDB'ye yazılıyor (Puppeteer).
//   http-server :3000 ayakta iken: node tools/test_seasonsummary.js
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
        document.getElementById('player-lastname').value = 'Sum4c';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });

    const out = await page.evaluate(async () => {
        const r = {};
        const slot = gameState._slot, season = gameState.currentSeason;
        const lg = 'eng-premier-league', W = 12;
        await DB.ensureLeagues(DB.leagues().filter(l => l.type === 'league').map(l => l.id));
        await WorldDB.seedCareer(slot);
        const userLg = activeLeagueId(), userTeam = gameState.player.teamId;
        for (let w = 0; w < W; w++) { simulateWorldWeek(w, userLg, userTeam); await recordWorldWeekDetails(slot, w, season, userLg, userTeam); }
        await WorldDB.aggregatePlayerSeasons(slot, season);

        // ÖZET
        const summary = await WorldDB.computeSeasonSummary(slot, season);
        r.hasSummary = !!(summary && summary.leagues);
        r.leagueCount = summary ? Object.keys(summary.leagues).length : 0;

        // Geri okunabilir mi?
        const stored = await WorldDB.getSeasonSummary(slot, season);
        r.retrievable = !!(stored && stored.leagues && stored.season === season);

        // EPL özeti tutarlı mı?
        const e = summary.leagues[lg];
        r.eplHas = !!e;
        r.champion = e ? e.championId : null;
        r.topScorer = e && e.topScorer ? { name: e.topScorer.name, g: e.topScorer.goals } : null;
        r.mvp = e && e.mvp ? { name: e.mvp.name, g: e.mvp.goals, a: e.mvp.assists } : null;

        // Şampiyon = teamSeasons rank 1 (tutarlılık)
        const ts = await WorldDB.getAllByIndex('teamSeasons', 'bySlotSeasonLeague', IDBKeyRange.only([slot, season, lg]));
        const rank1 = (ts || []).slice().sort((a, b) => (a.rank || 99) - (b.rank || 99))[0];
        r.championMatchesRank1 = !!(rank1 && e && rank1.teamId === e.championId);

        // Top scorer golü playerSeasons'taki maksimumla aynı mı?
        const ps = await WorldDB.getAllByIndex('playerSeasons', 'bySlotSeasonLeague', IDBKeyRange.only([slot, season, lg]));
        const maxG = (ps || []).reduce((m, x) => Math.max(m, x.goals || 0), 0);
        r.topScorerMatchesMax = !!(e && e.topScorer && e.topScorer.goals === maxG && maxG > 0);
        r.topScorerNameResolved = !!(e && e.topScorer && e.topScorer.name);
        return r;
    });

    await browser.close();

    const c = [];
    c.push(['Sezon özeti üretildi', out.hasSummary === true, `${out.leagueCount} lig`]);
    c.push(['Özet meta\'dan geri okunabilir', out.retrievable === true, '']);
    c.push(['EPL özeti var', out.eplHas === true, '']);
    c.push(['Şampiyon = teamSeasons rank 1', out.championMatchesRank1 === true, `champ=${out.champion}`]);
    c.push(['Gol kralı = playerSeasons max gol', out.topScorerMatchesMax === true, JSON.stringify(out.topScorer)]);
    c.push(['Gol kralı adı çözüldü', out.topScorerNameResolved === true, '']);
    c.push(['MVP mevcut', !!out.mvp, JSON.stringify(out.mvp)]);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== FAZ 4c — sezon özeti (şampiyon + ödüller) ===`);
    console.log(JSON.stringify(out, null, 0).slice(0, 500) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
