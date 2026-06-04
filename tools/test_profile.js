// Faz 3c doğrulama — oyuncu profili GERÇEK veriden + geçmiş sezonlar (Puppeteer).
//   http-server :3000 ayakta iken: node tools/test_profile.js
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
        document.getElementById('player-lastname').value = 'Prof';
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
        WorldStats.invalidate();
        await WorldStats.ensureSeason(slot, season);

        // En golcü NPC'yi bul
        const leaders = computeLeagueLeaders(otherLg);
        const top = (leaders || []).filter(x => !x.isUser).slice().sort((a, b) => b.g - a.g)[0];
        r.top = top ? { id: top.id, name: top.name, g: top.g, team: top.teamId } : null;

        // Profili aç
        if (top) {
            openPlayerProfile(top.id, top.teamId);
            await new Promise(res => setTimeout(res, 400));
            const body = document.getElementById('player-profile-body');
            const title = [...body.querySelectorAll('.pp-section-title')].map(e => e.textContent.trim());
            const grid = body.querySelector('.pp-stats-grid');
            const statVals = grid ? [...grid.querySelectorAll('.pp-stat-v')].map(e => e.textContent.trim()) : [];
            r.titleHasTahmini = title.some(t => t.includes('(tahmini)'));
            r.seasonTitle = title.find(t => /Sezon/.test(t)) || '';
            r.statVals = statVals;
            // "Maç" değeri "X (Y)" formatında mı (ilk11 (yedek))
            r.matchesFormat = statVals[0] || '';
        }

        // Geçmiş sezon: season'ı agregat et, currentSeason'ı ilerlet, profili tekrar aç → geçmiş tablo görünmeli
        await WorldDB.aggregatePlayerSeasons(slot, season);
        gameState.currentSeason = season + 1;
        WorldStats.invalidate();
        if (top) {
            openPlayerProfile(top.id, top.team);
            await new Promise(res => setTimeout(res, 500));
            const hist = document.getElementById('pp-history');
            r.histHtml = hist ? hist.innerHTML.length : 0;
            r.histHasTable = !!(hist && hist.querySelector('table'));
            r.histRows = hist ? hist.querySelectorAll('tbody tr').length : 0;
            r.histShowsSeason = hist ? hist.textContent.includes(String(season)) : false;
        }
        return r;
    });

    await browser.close();

    const checks = [];
    checks.push(['En golcü NPC bulundu', !!out.top, out.top ? `${out.top.name} (${out.top.g}g)` : '']);
    checks.push(['Sezon başlığında "(tahmini)" YOK', out.titleHasTahmini === false, `başlık: "${out.seasonTitle}"`]);
    checks.push(['Maç "ilk11 (yedek)" formatında', /\(\d+\)/.test(out.matchesFormat || ''), `"${out.matchesFormat}"`]);
    checks.push(['Geçmiş sezon tablosu render edildi', out.histHasTable === true, `${out.histRows} satır`]);
    checks.push(['Geçmiş tablo doğru sezonu gösteriyor', out.histShowsSeason === true, '']);
    checks.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== FAZ 3c — oyuncu profili gerçek veriden ===`);
    console.log(`En golcü: ${JSON.stringify(out.top)} | sezon başlığı: "${out.seasonTitle}" | maç: "${out.matchesFormat}" | geçmiş satır: ${out.histRows}\n`);
    let pass = 0;
    for (const [name, ok, info] of checks) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${name}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${checks.length} geçti.`);
    process.exit(pass === checks.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
