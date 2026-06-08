// Faz 3: finans UI — takım kadrosu modalında kulüp finans bloğu (kasa + gelir/gider kırılımı + net).
//   http-server :3000 ayakta iken: node tools/test_finance3.js
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
        document.getElementById('player-lastname').value = 'Three';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 400));

    const out = await page.evaluate(async () => {
        const poll = async (fn, ms = 6000, step = 120) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, step)); } return fn(); };
        const res = {};
        await window.DB.loadPlayers('tur-super-lig');

        // (1) Hesaplaşma öncesi: finans bloğu (tahmini)
        openTeamSquad('tur-super-lig__galatasaray');
        await poll(() => document.querySelector('#team-squad-body .ts-finance'));
        const fin = document.querySelector('#team-squad-body .ts-finance');
        res.finExists = !!fin;
        const txt = fin ? fin.textContent : '';
        res.balShown = /Kasa:/.test(txt) && /€/.test(txt);
        res.revLines = /Bilet\/Maç/.test(txt) && /Yayın/.test(txt) && /Sponsor/.test(txt);
        res.expLines = /Maaşlar/.test(txt) && /İşletme/.test(txt);
        res.netShown = !!document.querySelector('#team-squad-body .fin-net');
        res.estimatedTag = /tahmini/.test(txt);   // hesaplaşmadan önce tahmini
        document.getElementById('team-squad-modal').style.display = 'none';

        // (2) Sezon-sonu hesaplaşma → blok artık GERÇEK (tahmini değil) + gelir > 0
        settleClubFinances(gameState.currentSeason);
        openTeamSquad('tur-super-lig__galatasaray');
        await poll(() => document.querySelector('#team-squad-body .ts-finance'));
        const fin2 = document.querySelector('#team-squad-body .ts-finance').textContent;
        res.settledNoEst = !/tahmini/.test(fin2);
        const f = _finOf('tur-super-lig__galatasaray');
        res.settledRev = f.rev.gate > 0 && f.rev.tv > 0;
        return res;
    });

    await browser.close();

    const c = [];
    c.push(['Finans bloğu var (.ts-finance)', out.finExists === true, '']);
    c.push(['Kasa gösteriliyor (€)', out.balShown === true, '']);
    c.push(['Gelir kalemleri (Bilet/Yayın/Sponsor)', out.revLines === true, '']);
    c.push(['Gider kalemleri (Maaşlar/İşletme)', out.expLines === true, '']);
    c.push(['Net gösterimi', out.netShown === true, '']);
    c.push(['Hesaplaşmadan önce "tahmini" etiketi', out.estimatedTag === true, '']);
    c.push(['Hesaplaşma sonrası gerçek (tahmini değil)', out.settledNoEst === true, '']);
    c.push(['Hesaplaşma sonrası gelir > 0', out.settledRev === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== FAZ 3 — FİNANS UI ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
