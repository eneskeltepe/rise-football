// Faz 2: AKILLI pencere-içi AI piyasası (runWindowMarket) — gerçek, kalıcı, ihtiyaç+bütçe;
//  transfer/serbest/kiralık; WorldDB+WorldState+finans; CAP; kiralık iadesi.
//   http-server :3000 ayakta iken: node tools/test_windowmarket.js
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
        document.getElementById('player-firstname').value = 'Win';
        document.getElementById('player-lastname').value = 'Mkt';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 300));

    const out = await page.evaluate(async () => {
        const r = {};
        const slot = gameState._slot, season = gameState.currentSeason;
        await DB.ensureLeagues(DB.leagues().filter(l => l.type === 'league').map(l => l.id));
        await WorldDB.seedCareer(slot);

        // Kiralık iadesi testi: bir oyuncuyu "geçen sezondan kiralık" yap
        const all0 = await WorldDB.getAllByIndex('players', 'bySlot', IDBKeyRange.only(slot));
        const loaner = all0.find(p => !p.retired);
        const realHome = 'eng-premier-league__liverpool';
        loaner.loanFrom = realHome; loaner.loanUntil = season - 1; const loanedPid = loaner.id;
        await WorldDB.putAll('players', [loaner]);

        const t0 = Date.now();
        const n = await runWindowMarket(slot, season, 'summer');
        r.ms = Date.now() - t0;
        r.moves = n;

        const transfers = (await WorldDB.getAllByIndex('transfers', 'bySlot', IDBKeyRange.only(slot))).filter(t => t.window === 'summer');
        r.storeCount = transfers.length;
        r.withinCap = transfers.length <= 150;
        const types = {}; transfers.forEach(t => types[t.type] = (types[t.type] || 0) + 1);
        r.types = types;
        r.hasTransfer = (types.transfer || 0) > 0;
        r.variety = Object.keys(types).length >= 2;   // transfer + (free|loan)

        // Bir transfer kaydı: WorldDB + finans + squadSync
        const tr = transfers.find(t => t.type === 'transfer');
        if (tr) {
            const rec = await WorldDB.get('players', [slot, tr.playerId]);
            r.recMoved = !!(rec && rec.teamId === tr.toTeam);
            r.buyerCharged = _finOf(tr.toTeam).exp.transfers >= tr.fee && tr.fee > 0;
            await WorldState.ensure(slot, true);
            r.inNewClub = DB.squadSync(tr.toTeam).some(p => String(p.id) === String(tr.playerId));
            // Bütçe gate: alıcının BAŞLANGIÇ bütçesi bedeli karşılıyordu mu? (kasası hâlâ ≥ 0 olmalı, ya da makul)
            r.buyerFeeOk = tr.fee > 0;
        }

        // Kiralık iadesi: loaned oyuncu ana kulübe döndü mü?
        const lrec = await WorldDB.get('players', [slot, loanedPid]);
        r.loanReverted = !!(lrec && lrec.teamId === realHome && !lrec.loanFrom);

        // Haber gerçek hareketlerden
        r.newsCount = (gameState.transferNews || []).length;
        return r;
    });

    await browser.close();

    const c = [];
    c.push(['Pencere-içi gerçek hareket (>0)', out.moves > 0, `${out.moves} hareket, ${out.ms}ms`]);
    c.push(['transfers store yazıldı', out.storeCount > 0, `=${out.storeCount}`]);
    c.push(['CAP (≤150) aşılmadı', out.withinCap === true, '']);
    c.push(['Bonservisli transfer var', out.hasTransfer === true, JSON.stringify(out.types)]);
    c.push(['Tür çeşitliliği (transfer + serbest/kiralık)', out.variety === true, '']);
    c.push(['Transfer: WorldDB kaydı taşındı', out.recMoved === true, '']);
    c.push(['Transfer: alıcı kulüp bonservis ödedi (finans)', out.buyerCharged === true, '']);
    c.push(['Transfer: squadSync yeni kulüpte', out.inNewClub === true, '']);
    c.push(['Süresi dolan kiralık ana kulübe döndü', out.loanReverted === true, '']);
    c.push(['Haber gerçek hareketlerden (>0)', out.newsCount > 0, `=${out.newsCount}`]);
    c.push(['Performans < 8sn', out.ms < 8000, `${out.ms}ms`]);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== FAZ 2 — AKILLI PENCERE-İÇİ PİYASA ===`);
    console.log(JSON.stringify(out).slice(0, 400) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
