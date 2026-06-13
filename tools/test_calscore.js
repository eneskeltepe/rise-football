// ============================================================================
//  test_calscore.js — Takvim Avrupa kupası skor YÖNELİMİ (v2.15.0 bugfix)
//  Bug: Avrupa kampanyası gf/ga (BENİM/rakip golü) tutar; takvim render'i sh/sa'yı
//  EV/DEPLASMAN skoru sanıyordu (my = home?sh:sa) → DEPLASMAN galibiyeti MAĞLUBİYET
//  (kırmızı) görünüyordu. Fix: _calSeasonEvents Avrupa olaylarını ev/dep yönelimine çevirir.
//  Bu test, takvim olayının render edeceği W/D/L sonucunu (renderle AYNI formül) doğrular.
//   http-server :3000 ayakta iken:  node tools/test_calscore.js
// ============================================================================
const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PE: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('CE: ' + m.text()); });

    await page.goto('http://127.0.0.1:3000/index.html', { waitUntil: 'networkidle2', timeout: 30000 });
    await page.evaluate(() => { localStorage.clear(); });
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 500));
    await page.evaluate(() => {
        document.getElementById('player-firstname').value = 'Cal';
        document.getElementById('player-lastname').value = 'Score';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 400));

    const out = await page.evaluate(() => {
        const S = gameState.currentSeason, W = gameState.currentWeek;
        const opp = 'tur-super-lig__fenerbahce';
        // Sahte Avrupa kampanyası: DEPLASMAN 2-1 galibiyet (gf=2,ga=1,home=false) +
        // EV 3-0 galibiyet + DEPLASMAN 0-2 mağlubiyet → üçü de doğru sınıflanmalı.
        gameState.euro = {
            done: false, compId: 'uefa-champions', compName: 'Şampiyonlar Ligi', _team: gameState.player.teamId,
            season: S, teams: [], myLp: [
                { oppId: opp, home: false, played: true, gf: 2, ga: 1, week: W, dayOffset: 2 },       // DEP galibiyet
                { oppId: opp, home: true, played: true, gf: 3, ga: 0, week: W + 1, dayOffset: 2 },    // EV galibiyet
                { oppId: opp, home: false, played: true, gf: 0, ga: 2, week: W + 2, dayOffset: 2 },   // DEP mağlubiyet
            ], ko: [],
        };
        // _calSeasonEvents bu sezonun olay haritasını döndürür (gün → olay[])
        const map = _calSeasonEvents(S);
        const cupEvents = [];
        Object.values(map).forEach(arr => arr.forEach(e => { if (e.type === 'cup') cupEvents.push(e); }));
        // Render ile AYNI W/D/L formülü
        const resultOf = (e) => { const my = e.home ? e.sh : e.sa, op = e.home ? e.sa : e.sh; return my > op ? 'W' : my === op ? 'D' : 'L'; };
        const away2_1 = cupEvents.find(e => !e.home && e.sh === 1 && e.sa === 2); // dep: sh=ga=1, sa=gf=2
        const home3_0 = cupEvents.find(e => e.home && e.sh === 3 && e.sa === 0);
        const away0_2 = cupEvents.find(e => !e.home && e.sh === 2 && e.sa === 0); // dep mağlubiyet: sh=ga=2, sa=gf=0
        return {
            count: cupEvents.length,
            awayWin: away2_1 ? resultOf(away2_1) : 'YOK',
            homeWin: home3_0 ? resultOf(home3_0) : 'YOK',
            awayLoss: away0_2 ? resultOf(away0_2) : 'YOK',
            sample: cupEvents.map(e => ({ home: e.home, sh: e.sh, sa: e.sa })),
        };
    });

    await browser.close();

    const c = [];
    c.push(['3 Avrupa olayı takvime düştü', out.count === 3, JSON.stringify(out.sample)]);
    c.push(['DEPLASMAN 2-1 galibiyet → W (eskiden L görünüyordu)', out.awayWin === 'W', JSON.stringify(out)]);
    c.push(['EV 3-0 galibiyet → W', out.homeWin === 'W', JSON.stringify(out)]);
    c.push(['DEPLASMAN 0-2 mağlubiyet → L', out.awayLoss === 'L', JSON.stringify(out)]);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== TAKVİM AVRUPA SKOR YÖNELİMİ ===`);
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${ok ? '' : (info ? '  — ' + info : '')}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
