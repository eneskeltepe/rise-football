// Faz 1: kullanıcı transferi finans-bilinçli — teklif kabul edilince alıcı kulüp bonservis öder,
//  satan kulüp alır (gerçek kasa); kullanıcı yeni kulübe geçer.
//   http-server :3000 ayakta iken: node tools/test_finance1.js
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
    await new Promise(r => setTimeout(r, 400));
    await page.evaluate(() => {
        document.getElementById('player-firstname').value = 'Fin';
        document.getElementById('player-lastname').value = 'One';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 400));

    const out = await page.evaluate(async () => {
        const res = {};
        await window.DB.loadPlayers('tur-super-lig');
        const buyer = DB.getTeam('tur-super-lig__fenerbahce');
        const oldTeamId = gameState.player.teamId;
        const fee = 20000000;
        gameState.transferOffers = [{
            clubId: buyer.id, clubName: buyer.name, wage: 120000, duration: 3, squadRole: 'İlk 11',
            fee, type: 'transfer', isEurope: false, leagueName: 'Süper Lig', leagueFlag: '🇹🇷'
        }];
        const buyer0 = _finOf(buyer.id).balance, sell0 = _finOf(oldTeamId).balance;
        openTransferModal(0);                 // selectedOfferIndex = 0
        document.getElementById('btn-accept-transfer').click();
        await new Promise(r => setTimeout(r, 150));
        res.buyerPaid = _finOf(buyer.id).balance === buyer0 - fee;
        res.sellerGot = _finOf(oldTeamId).balance === sell0 + fee;
        res.buyerLedger = _finOf(buyer.id).exp.transfers >= fee;
        res.sellerLedger = _finOf(oldTeamId).rev.sales >= fee;
        res.userMoved = gameState.player.teamId === buyer.id;
        return res;
    });

    await browser.close();

    const c = [];
    c.push(['Alıcı kulüp bonservis ödedi (−fee)', out.buyerPaid === true, '']);
    c.push(['Satan kulüp bonservis aldı (+fee)', out.sellerGot === true, '']);
    c.push(['Alıcı defteri (exp.transfers)', out.buyerLedger === true, '']);
    c.push(['Satan defteri (rev.sales)', out.sellerLedger === true, '']);
    c.push(['Kullanıcı yeni kulübe geçti', out.userMoved === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== FAZ 1 — KULLANICI TRANSFERİ FİNANS ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
