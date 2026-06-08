// Faz 0: kulüp finansı — kalıcı kasa (lazy init), gelir/gider settlement, bonservis akışı,
//  clubBudget gerçek kasadan türer.
//   http-server :3000 ayakta iken: node tools/test_finance.js
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
        document.getElementById('player-lastname').value = 'Test';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 400));

    const out = await page.evaluate(async () => {
        const res = {};
        await window.DB.loadPlayers('tur-super-lig');
        const teams = DB.teams();
        const big = teams.slice().sort((a, b) => (b.power || 0) - (a.power || 0))[0];
        const small = teams.slice().sort((a, b) => (a.power || 0) - (b.power || 0))[0];

        // (1) Lazy init + bütçe > 0
        const bigBudget = clubBudget(big);
        const bigBal0 = _finOf(big.id).balance;
        res.budgetPositive = bigBudget > 0 && bigBal0 > 0;
        res.bigVsSmall = clubBudget(big) > clubBudget(small);

        // (2) Bonservis akışı: alıcı −, satıcı +
        const A = big.id, B = small.id;
        const a0 = _finOf(A).balance, b0 = _finOf(B).balance;
        applyTransferFee(A, B, 10000000);
        const a1 = _finOf(A).balance, b1 = _finOf(B).balance;
        res.feeBuyer = a1 === a0 - 10000000;
        res.feeSeller = b1 === b0 + 10000000;
        res.feeLedger = _finOf(A).exp.transfers >= 10000000 && _finOf(B).rev.sales >= 10000000;

        // (3) Bütçe kasayı takip eder: büyük harcama → bütçe düşer
        const budBefore = clubBudget(big);
        applyTransferFee(A, null, 60000000);
        res.budgetDropsAfterSpend = clubBudget(big) < budBefore;

        // (4) Sezon-sonu settlement: gelir kırılımı + bakiye değişir
        const balPre = _finOf(big.id).balance;
        settleClubFinances(gameState.currentSeason);
        const f = _finOf(big.id);
        res.settleRevenue = f.rev.gate > 0 && f.rev.tv > 0 && f.rev.sponsor > 0;
        res.settleExpense = f.exp.wages > 0 && f.exp.ops > 0;
        res.settleChangedBalance = _finOf(big.id).balance !== balPre;
        res.settleBigRevGtSmall = (_estRevenue(big, 5).gate + _estRevenue(big, 5).tv) > (_estRevenue(small, 5).gate + _estRevenue(small, 5).tv);
        res.bigName = big.name; res.smallName = small.name;
        res.bigBalM = Math.round(bigBal0 / 1000000);
        return res;
    });

    await browser.close();

    const c = [];
    c.push(['Kasa lazy init + bütçe > 0', out.budgetPositive === true, `${out.bigName} ~${out.bigBalM}M`]);
    c.push(['Büyük kulüp bütçesi > küçük', out.bigVsSmall === true, `${out.bigName} > ${out.smallName}`]);
    c.push(['Bonservis: alıcı bakiyesi −fee', out.feeBuyer === true, '']);
    c.push(['Bonservis: satıcı bakiyesi +fee', out.feeSeller === true, '']);
    c.push(['Bonservis defteri (transfers/sales)', out.feeLedger === true, '']);
    c.push(['Harcama → transfer bütçesi düşer', out.budgetDropsAfterSpend === true, '']);
    c.push(['Settlement: gelir kalemleri (bilet/tv/sponsor)', out.settleRevenue === true, '']);
    c.push(['Settlement: gider kalemleri (maaş/işletme)', out.settleExpense === true, '']);
    c.push(['Settlement: bakiye güncellendi', out.settleChangedBalance === true, '']);
    c.push(['Büyük kulüp geliri > küçük', out.settleBigRevGtSmall === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== FAZ 0 — KULÜP FİNANSI ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
