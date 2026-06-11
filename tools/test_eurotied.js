// ORTA FIX (O2) — Sezon ortası transferde KUPA-BAĞLILIK (cup-tied):
//  Bu sezon kupada eski kulübünle OYNADIYSAN, transferde kampanya sessizce silinip
//  yeni takım için sıfırdan kurulmaz → kupa dışında kalırsın (gerçek kural), toast'la
//  bildirilir; sezon boyu yeniden kurulmaz. HİÇ oynamadıysan (erken yaz transferi)
//  yeni kulüple kampanya serbestçe kurulur. Ek: lig fazı skorları kampanyada SABİTLENİR
//  (takım gücü sezon içinde değişse de geçmiş kupa sonuçları değişmez).
//   http-server :3000 ayakta iken: node tools/test_eurotied.js
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
        document.getElementById('player-firstname').value = 'Cup';
        document.getElementById('player-lastname').value = 'Tied';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 400));

    const out = await page.evaluate(async () => {
        const r = {};
        const p = gameState.player;
        if (!gameState.euro) {
            gameState._prevStandingPos = {}; gameState._prevStandingPos[p.teamId] = 1;
            qualifyPlayerEuro();
        }
        const e = gameState.euro;
        r.hasEuro = !!e;
        if (!e) return r;
        const season = gameState.currentSeason;

        // ---- Lig fazı skorları SABİTLENİR (güç değişse de geçmiş kupa sonuçları aynı) ----
        _lpStandings(e, true);
        const snap = JSON.stringify(e._lpScores);
        e.teams.forEach(id => { const t = DB.getTeam(id); if (t && t.id !== e._team) t.power = Math.max(48, t.power - 8); });
        _lpStandings(e, true);
        r.lpScoresStable = JSON.stringify(e._lpScores) === snap;

        // ---- 1) Kupada OYNADIN + sezon ortası transfer → KUPA-BAĞLI ----
        e.myLp[0].played = true; e.myLp[0].gf = 1; e.myLp[0].ga = 0; e.matches = 1;
        gameState.currentWeek = 20;
        const t1 = DB.getTeam('tur-super-lig__besiktas');
        acceptTransferOffer({ clubId: t1.id, clubName: t1.name, wage: 30000, duration: 3, squadRole: 'İlk 11', fee: 0, type: 'free' });
        r.cupTied = gameState.euro === null && gameState._euroCupTied === season;
        // sonraki render'larda yeniden KURULMAZ
        updateUI();
        r.staysNull = gameState.euro === null;

        // ---- 2) HİÇ oynamadıysan: yeni kulüple kampanya serbest ----
        gameState._euroCupTied = null;
        if (!gameState._prevStandingPos) gameState._prevStandingPos = {};
        gameState._prevStandingPos[p.teamId] = 1;
        qualifyPlayerEuro();                       // yeni kulüple taze kampanya (maç yok)
        const fresh = gameState.euro;
        r.freshBuilt = !!fresh && fresh._team === p.teamId && !(fresh.myLp || []).some(f => f.played);
        const t2 = DB.getTeam('tur-super-lig__trabzonspor');
        acceptTransferOffer({ clubId: t2.id, clubName: t2.name, wage: 30000, duration: 3, squadRole: 'İlk 11', fee: 0, type: 'free' });
        r.rebuiltForNewClub = !!gameState.euro && gameState.euro._team === t2.id;
        r.notTiedWhenUnplayed = gameState._euroCupTied !== season || gameState._euroCupTied == null;
        return r;
    });

    await browser.close();

    const c = [];
    c.push(['Euro kampanyası kuruldu', out.hasEuro === true, '']);
    c.push(['Lig fazı skorları güç değişse de SABİT', out.lpScoresStable === true, '']);
    c.push(['Kupada oynadıktan sonra transfer → kupa-bağlı (kampanya yok)', out.cupTied === true, '']);
    c.push(['Sezon boyu yeniden kurulmuyor', out.staysNull === true, '']);
    c.push(['Hiç oynamadan: taze kampanya kuruldu', out.freshBuilt === true, '']);
    c.push(['Hiç oynamadan transfer → yeni kulüple kampanya serbest', out.rebuiltForNewClub === true, '']);
    c.push(['Oynamamışken kupa-bağlılık işaretlenmez', out.notTiedWhenUnplayed === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== ORTA FIX — KUPA-BAĞLILIK (SEZON ORTASI TRANSFER) ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
