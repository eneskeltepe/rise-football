// YUKSEK FIX (Y2) — Sözleşme görüşme sayaçları KARİYER-TOPLAM hafta cinsinden:
//  lastContractRenewalWeek / negotiationBlockUntil artık sezon devrinde kırılmaz.
//  Eski bug: sezon-içi currentWeek ile karşılaştırma → yeni sezonda fark negatif
//  ("yakın zamanda yeniledin" yanlış engeli) ve hafta 30'daki 10 haftalık blok
//  (blockUntil=40) tüm yeni sezonu blokluyordu (currentWeek<40).
//   http-server :3000 ayakta iken: node tools/test_negweeks.js
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
        document.getElementById('player-lastname').value = 'Weeks';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 400));

    const out = await page.evaluate(async () => {
        const r = {};
        const p = gameState.player;
        const modal = document.getElementById('contract-negotiation-modal');
        // Senaryo zemini: 2. sezon (2027), hafta 10 → kariyer-toplam hafta = 36 + 10 = 46
        gameState.currentSeason = 2027; gameState.currentWeek = 10;
        p.currentSeasonStats.matches = 10;
        p.currentSeasonStats.ratings = [7, 7, 7, 7, 7, 7.2, 6.9, 7, 7, 7];   // sıradan form (istisna kapısı kapalı)
        p.managerTrust = 60; p.form = 70; p.joinedClubWeek = 0;

        // 1) GEÇEN SEZON hafta 30'da yenilendi (toplam 30) → 16 hafta geçti → görüşme AÇIK
        //    (eski kod: 10 - 30 = -20 < 15 → yanlış "yakın zamanda yeniledin" engeli)
        p.lastContractRenewalWeek = 30; p.negotiationBlockUntil = 0;
        requestContractNegotiation();
        r.crossSeasonRenewalOk = modal.style.display === 'flex';
        modal.style.display = 'none';

        // 2) Blok GEÇEN SEZON doldu (blockUntil=40 toplam < 46) → görüşme AÇIK
        //    (eski kod: currentWeek 10 < 40 → tüm sezon blok)
        p.lastContractRenewalWeek = 0; p.negotiationBlockUntil = 40;
        requestContractNegotiation();
        r.expiredBlockOk = modal.style.display === 'flex';
        modal.style.display = 'none';

        // 3) Blok hâlâ AKTİF (blockUntil=50 toplam > 46) → görüşme KAPALI (doğru engel korunur)
        p.negotiationBlockUntil = 50;
        requestContractNegotiation();
        r.activeBlockStillBlocks = modal.style.display !== 'flex';

        // 4) KABUL → lastContractRenewalWeek TOPLAM hafta (46) olarak yazılır
        p.negotiationBlockUntil = 0;
        openContractNegotiationModal();
        let _mr = Math.random; Math.random = () => 0;     // zar=1 → kabul
        submitCounterOffer();
        Math.random = _mr;
        r.renewalStoredTotal = p.lastContractRenewalWeek === 46;

        // 5) RED → negotiationBlockUntil TOPLAM hafta + 10 (= 56) olarak yazılır
        p.lastContractRenewalWeek = 0;
        openContractNegotiationModal();
        _mr = Math.random; Math.random = () => 0.999;     // zar=100 → red
        submitCounterOffer();
        Math.random = _mr;
        r.blockStoredTotal = p.negotiationBlockUntil === 56;

        // 6) Transfer kabulü de TOPLAM hafta yazar (60-ui acceptTransferOffer)
        const buyer = DB.teamsInLeague('ita-serie-a')[0];
        acceptTransferOffer({ clubId: buyer.id, clubName: buyer.name, wage: 30000, duration: 3, squadRole: 'İlk 11', fee: 0, type: 'free' });
        r.transferRenewalTotal = p.lastContractRenewalWeek === 46;
        return r;
    });

    await browser.close();

    const c = [];
    c.push(['Sezon-aşan yenileme: 16 hafta sonra görüşme AÇIK', out.crossSeasonRenewalOk === true, '']);
    c.push(['Geçen sezon dolan blok artık engellemiyor', out.expiredBlockOk === true, '']);
    c.push(['Hâlâ aktif blok doğru şekilde engelliyor', out.activeBlockStillBlocks === true, '']);
    c.push(['Kabul: yenileme sayacı TOPLAM hafta (46)', out.renewalStoredTotal === true, '']);
    c.push(['Red: blok TOPLAM hafta + 10 (56)', out.blockStoredTotal === true, '']);
    c.push(['Transfer kabulü de TOPLAM hafta yazar', out.transferRenewalTotal === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== YUKSEK FIX — SÖZLEŞME SAYAÇLARI (SEZON SINIRI) ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
