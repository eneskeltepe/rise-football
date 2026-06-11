// ORTA FIX (O5) — Maç dönüşü transfer teklifleri sabit hafta 18/36 yerine
//  PENCERE-BAZLI tetiklenir (pencere başına bir kez). Eski bug: 46 haftalık
//  Championship'te kış penceresi 22-24. haftada → 18. hafta tetiklemesi pencere
//  kapalı diye HİÇ teklif üretmiyordu; 36. hafta hiçbir ligde pencereye denk gelmiyordu.
//   http-server :3000 ayakta iken: node tools/test_offerwindow.js
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
    // 46 haftalık lig: eng-championship (24 takım, çift devre)
    const chTeam = await page.evaluate(() => (DB.teamsInLeague('eng-championship')[0] || {}).id);
    await page.evaluate((teamId) => {
        document.getElementById('player-firstname').value = 'Offer';
        document.getElementById('player-lastname').value = 'Window';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'eng-championship';
        document.getElementById('player-team').value = teamId;
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }, chTeam);
    await new Promise(r => setTimeout(r, 400));

    const out = await page.evaluate(async () => {
        const r = {};
        const p = gameState.player;
        r.leagueWeeks = activeLeagueWeeks();                       // 46 beklenir
        // Kış penceresinin ortası (46 haftalık ligde 23. hafta — eski 18/36 tetiklemesi burada KÖRDÜ)
        const mid = Math.round(r.leagueWeeks * 0.5);
        gameState.currentWeek = mid;
        r.windowKind = transferWindowKind();                        // 'winter' beklenir
        p.currentSeasonStats.matches = 8;
        p.currentSeasonStats.ratings = [7, 7, 7, 7, 7, 7, 7, 7];
        gameState.transferOffers = [];
        gameState._lastOfferKey = null;

        const _mr = Math.random; Math.random = () => 0.3;           // deterministik üretim
        _returnToPanel();                                           // maç dönüşü
        Math.random = _mr;
        r.offersAfterFirst = (gameState.transferOffers || []).length;
        r.keySet = gameState._lastOfferKey === (gameState.currentSeason + '-winter');

        // Aynı pencerede İKİNCİ dönüş: teklifler YENİDEN üretilmez (pencere başına bir kez)
        gameState.transferOffers = [];
        const _mr2 = Math.random; Math.random = () => 0.3;
        _returnToPanel();
        Math.random = _mr2;
        r.noRegenInSameWindow = (gameState.transferOffers || []).length === 0;

        // Pencere DIŞI hafta: tetikleme yok
        gameState.currentWeek = mid + 5;
        gameState._lastOfferKey = null;
        const _mr3 = Math.random; Math.random = () => 0.3;
        _returnToPanel();
        Math.random = _mr3;
        r.noOffersOutsideWindow = (gameState.transferOffers || []).length === 0 && gameState._lastOfferKey === null;
        return r;
    });

    await browser.close();

    const c = [];
    c.push(['46 haftalık lig (Championship)', out.leagueWeeks === 46, `=${out.leagueWeeks}`]);
    c.push(['Lig ortasında kış penceresi AÇIK', out.windowKind === 'winter', `=${out.windowKind}`]);
    c.push(['Pencere içinde maç dönüşü teklif ÜRETİLDİ (eski kodda kördü)', out.offersAfterFirst > 0, `=${out.offersAfterFirst}`]);
    c.push(['Pencere anahtarı kaydedildi', out.keySet === true, '']);
    c.push(['Aynı pencerede ikinci kez üretilmez', out.noRegenInSameWindow === true, '']);
    c.push(['Pencere dışında tetiklenmez', out.noOffersOutsideWindow === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== ORTA FIX — PENCERE-BAZLI TEKLİF TETİKLEME (O5) ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
