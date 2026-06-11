// KRITIK FIX (K3) — Pazarlıkla kabul edilen transfer, doğrudan kabulle AYNI ortak
//  yoldan (acceptTransferOffer) geçer: bonservis (applyTransferFee + clubSpend),
//  kiralık teklif KİRALIK kalır (onLoan/loanReturn), transfer geçmişi yazılır.
//  (Eski bug: pazarlık yolu bonservis ödemiyor, kiralığı kalıcı transfere çeviriyordu.)
//   http-server :3000 ayakta iken: node tools/test_negaccept.js
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
        document.getElementById('player-firstname').value = 'Neg';
        document.getElementById('player-lastname').value = 'Accept';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 400));

    const out = await page.evaluate(async () => {
        const r = {};
        await DB.loadPlayers('tur-super-lig');
        const oldId = gameState.player.teamId;
        const buyer = DB.getTeam('eng-premier-league__liverpool') || DB.teamsInLeague('eng-premier-league')[0];
        const fee = 25000000;

        // ---- 1) KALICI transfer: pazarlıkla kabul (uçtan uca: modal + slider + submit) ----
        gameState.transferOffers = [{
            clubId: buyer.id, clubName: buyer.name, wage: 30000, duration: 3, squadRole: 'İlk 11',
            fee, type: 'transfer', isEurope: false, leagueName: 'Premier League', leagueFlag: ''
        }];
        const b0 = _finOf(buyer.id).balance, s0 = _finOf(oldId).balance;
        openTransferModal(0);
        openTransferNegotiationModal(0);
        document.getElementById('tneg-slider-wage').value = '36000';
        document.getElementById('tneg-slider-duration').value = '4';
        updateTransferNegotiationProbability();
        const _mr = Math.random; Math.random = () => 0;     // zar=1 → her zaman kabul
        submitTransferCounterOffer();
        Math.random = _mr;

        r.moved = gameState.player.teamId === buyer.id;
        r.wageNeg = gameState.player.wage === 36000;
        r.durNeg = gameState.player.contractDuration === 4;
        r.buyerPaid = _finOf(buyer.id).balance === b0 - fee;
        r.sellerGot = _finOf(oldId).balance === s0 + fee;
        r.buyerLedger = _finOf(buyer.id).exp.transfers >= fee;
        r.sellerLedger = _finOf(oldId).rev.sales >= fee;
        r.spendOk = (gameState.clubSpend[buyer.id] || 0) >= fee && (gameState.clubSpend[oldId] || 0) <= -fee;
        const th1 = (gameState.player.transferHistory || []).slice(-1)[0] || {};
        r.histOk = th1.type === 'transfer' && th1.fee === fee && th1.toId === buyer.id;
        r.offersCleared = gameState.transferOffers.length === 0;
        r.leagueSwitched = gameState._fxLeague === (DB.getTeam(buyer.id) || {}).leagueId;

        // ---- 2) KİRALIK teklif: pazarlıkla kabul → KİRALIK KALMALI (kalıcıya dönüşmemeli) ----
        const loanClub = DB.getTeam('esp-laliga__real-madrid') || DB.teamsInLeague('esp-laliga')[0];
        const loanFee = 500000;
        gameState.transferOffers = [{
            clubId: loanClub.id, clubName: loanClub.name, wage: 20000, duration: 1, squadRole: 'Rotasyon',
            fee: loanFee, type: 'loan', isEurope: false, leagueName: 'LaLiga', leagueFlag: ''
        }];
        const l0 = _finOf(loanClub.id).exp.transfers || 0;
        openTransferModal(0);
        openTransferNegotiationModal(0);
        document.getElementById('tneg-slider-wage').value = '22000';
        updateTransferNegotiationProbability();
        const _mr2 = Math.random; Math.random = () => 0;
        submitTransferCounterOffer();
        Math.random = _mr2;

        r.loanStaysLoan = gameState.player.onLoan === true;
        r.loanReturnOk = !!gameState.player.loanReturn && gameState.player.loanReturn.clubId === buyer.id;
        r.loanWageNeg = gameState.player.wage === 22000;
        r.loanContractKept = gameState.player.contractDuration === 4;   // ana sözleşme süresi DEĞİŞMEZ
        r.loanFeePaid = (_finOf(loanClub.id).exp.transfers || 0) >= l0 + loanFee;
        const th2 = (gameState.player.transferHistory || []).slice(-1)[0] || {};
        r.loanHistOk = th2.type === 'loan' && th2.toId === loanClub.id;

        // ---- 3) RED yolu değişmedi: zar kaybedilince takım değişmez, teklif maaşı kırpılır ----
        const rejClub = DB.teamsInLeague('ita-serie-a')[0];
        gameState.transferOffers = [{
            clubId: rejClub.id, clubName: rejClub.name, wage: 40000, duration: 3, squadRole: 'İlk 11',
            fee: 10000000, type: 'transfer', isEurope: false, leagueName: 'Serie A', leagueFlag: ''
        }];
        openTransferModal(0);
        openTransferNegotiationModal(0);
        updateTransferNegotiationProbability();
        const _mr3 = Math.random; Math.random = () => 0.999;   // zar=100 → her zaman red
        submitTransferCounterOffer();
        Math.random = _mr3;
        r.rejectNoMove = gameState.player.teamId === loanClub.id;
        r.rejectWageCut = gameState.transferOffers.length === 1 && gameState.transferOffers[0].wage === Math.round(40000 * 0.85);
        return r;
    });

    await browser.close();

    const c = [];
    c.push(['Pazarlık: kalıcı transfer gerçekleşti', out.moved === true, '']);
    c.push(['Pazarlık: anlaşılan maaş uygulandı (36k)', out.wageNeg === true, '']);
    c.push(['Pazarlık: anlaşılan süre uygulandı (4 yıl)', out.durNeg === true, '']);
    c.push(['Alıcı kulüp bonservisi ÖDEDİ (−fee)', out.buyerPaid === true, '']);
    c.push(['Satan kulüp bonservisi ALDI (+fee)', out.sellerGot === true, '']);
    c.push(['Finans defterleri (exp.transfers / rev.sales)', out.buyerLedger === true && out.sellerLedger === true, '']);
    c.push(['clubSpend al-sat kaydı', out.spendOk === true, '']);
    c.push(['Transfer geçmişine yazıldı (type+fee)', out.histOk === true, '']);
    c.push(['Teklifler temizlendi', out.offersCleared === true, '']);
    c.push(['Aktif lig yeni kulübün ligine geçti', out.leagueSwitched === true, '']);
    c.push(['Kiralık teklif KİRALIK kaldı (onLoan)', out.loanStaysLoan === true, '']);
    c.push(['loanReturn ana kulübü gösteriyor', out.loanReturnOk === true, '']);
    c.push(['Kiralıkta pazarlık maaşı uygulandı (22k)', out.loanWageNeg === true, '']);
    c.push(['Kiralıkta ana sözleşme süresi korunur', out.loanContractKept === true, '']);
    c.push(['Kiralama bedeli finansa işlendi', out.loanFeePaid === true, '']);
    c.push(['Kiralık transfer geçmişine yazıldı', out.loanHistOk === true, '']);
    c.push(['Red: takım değişmedi', out.rejectNoMove === true, '']);
    c.push(['Red: teklif maaşı %85\'e kırpıldı', out.rejectWageCut === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== KRITIK FIX — PAZARLIKLA TRANSFER KABULÜ (ORTAK YOL) ===`);
    console.log(JSON.stringify(out).slice(0, 400) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
