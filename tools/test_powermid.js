// ORTA FIX — "Güç sezon ortasında sabit" kuralı KALDIRILDI + finans simetrisi:
//  applyTransferPowerDelta: yıldız alan kulüp AYNI sezon güçlenir (fark×0.08, tavan 1.5),
//  satan zayıflar; kulüp seviyesinin altındaki oyuncu gücü değiştirmez. Kalıcılık:
//  gameState.teamPowerDelta → restoreWorldState reload'da uygular. Geçmiş haftaların
//  diğer-lig skorları WorldDB'deki SAKLI sonuçtan gösterilir (güç değişse de çelişmez).
//  _estWages: kullanıcı kulübü özel yolu kaldırıldı (herkes aynı formül).
//   http-server :3000 ayakta iken: node tools/test_powermid.js
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
        document.getElementById('player-firstname').value = 'Power';
        document.getElementById('player-lastname').value = 'Mid';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 400));

    const out = await page.evaluate(async () => {
        const r = {};
        const p = gameState.player;
        const buyer = DB.getTeam('tur-super-lig__kasimpasa');
        const seller = DB.getTeam('tur-super-lig__galatasaray');
        const b0 = buyer.power, s0 = seller.power;

        // ---- 1) Yıldız transferi: alıcı güçlenir, satan zayıflar (sezon ORTASINDA) ----
        const star = 90;
        const expB = Math.round((b0 + Math.min(1.5, (star - b0) * 0.08)) * 10) / 10;
        const expS = Math.round((s0 - Math.min(1.5, (star - s0) * 0.08)) * 10) / 10;
        applyTransferPowerDelta(buyer.id, seller.id, star);
        r.buyerUp = buyer.power === expB && buyer.power > b0;
        r.sellerDown = seller.power === expS && seller.power < s0;
        r.deltaRecorded = (gameState.teamPowerDelta[buyer.id] || 0) > 0 && (gameState.teamPowerDelta[seller.id] || 0) < 0;

        // ---- 2) Kulüp seviyesinin ALTINDAKİ oyuncu gücü değiştirmez ----
        const b1 = buyer.power;
        applyTransferPowerDelta(buyer.id, seller.id, 55);
        r.lowOvrNoChange = buyer.power === b1;

        // ---- 3) KALICILIK: taban'a dön → restoreWorldState delta'yı yeniden uygular ----
        const bAfter = buyer.power, sAfter = seller.power;
        resetWorldToBase();
        r.resetWorked = buyer.power === b0 && seller.power === s0;
        restoreWorldState(gameState);
        r.restoredDelta = buyer.power === bAfter && seller.power === sAfter;

        // ---- 4) Kullanıcı transferi de gücü etkiler ----
        p.ovr = 88;
        const target = DB.getTeam('tur-super-lig__antalyaspor');
        const t0 = target.power;
        acceptTransferOffer({ clubId: target.id, clubName: target.name, wage: 40000, duration: 3, squadRole: 'İlk 11', fee: 0, type: 'free' });
        r.userTransferPower = target.power > t0;

        // ---- 5) O9: finans simetrik — kullanıcının kulübü de AYNI formülle ----
        const tt = DB.getTeam(p.teamId);
        const formula = Math.round((tt.squadSize || 25) * calcWage(Math.max(50, (tt.power || 65) - 3), tt.prestige || 2) * 52 * 0.6);
        r.wagesSymmetric = _estWages(tt) === formula;

        // ---- 6) Geçmiş haftanın DİĞER-lig skoru SAKLI sonuçtan gösterilir ----
        gameState.currentWeek = 3;   // hafta 1 artık geçmiş
        const lid = 'eng-premier-league';
        const fx = leagueFixtures(lid)[0].find(m => !m.isBay);
        await WorldDB.recordMatches([{
            slot: gameState._slot, id: gameState.currentSeason + ':' + lid + ':0:' + fx.home + ':' + fx.away,
            season: gameState.currentSeason, week: 0, leagueId: lid,
            home: fx.home, away: fx.away, sh: 9, sa: 9, events: [], homeXI: [], homeSubs: [], awayXI: [], awaySubs: []
        }]);
        gameState.viewStandingsLeague = lid;
        renderFixturesForWeek(1);
        await new Promise(res => setTimeout(res, 600));
        const row = document.querySelector(`#fixtures-list .fixture-item[data-h="${fx.home}"][data-a="${fx.away}"] .fix-score`);
        r.storedScoreShown = !!row && row.textContent.trim() === '9 - 9';
        return r;
    });

    await browser.close();

    const c = [];
    c.push(['Yıldız alan kulüp AYNI sezon güçlendi', out.buyerUp === true, '']);
    c.push(['Satan kulüp zayıfladı', out.sellerDown === true, '']);
    c.push(['Delta kalıcı kayda yazıldı (teamPowerDelta)', out.deltaRecorded === true, '']);
    c.push(['Seviye altı oyuncu gücü değiştirmez', out.lowOvrNoChange === true, '']);
    c.push(['resetWorldToBase tabana döndürür', out.resetWorked === true, '']);
    c.push(['restoreWorldState delta\'yı yeniden uygular (reload kalıcılığı)', out.restoredDelta === true, '']);
    c.push(['Kullanıcı transferi de gücü etkiler', out.userTransferPower === true, '']);
    c.push(['Finans simetrik: kullanıcı kulübü aynı formülle', out.wagesSymmetric === true, '']);
    c.push(['Geçmiş hafta skoru WorldDB\'deki SAKLI sonuçtan', out.storedScoreShown === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== ORTA FIX — SEZON İÇİ GÜÇ ETKİSİ + FİNANS SİMETRİSİ ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
