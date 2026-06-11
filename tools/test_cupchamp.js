// YUKSEK FIX (Y5) — Kupalar görünümü ↔ oynanan kıta kupası kampanyası ÇELİŞMEZ:
//  runSeasonCups, oyuncunun OYNADIĞI turnuvanın şampiyonunu/akıbetini KAMPANYADAN
//  alır (sen UCL'yi kazandıysan Kupalar sekmesi başka takımı şampiyon yazamaz),
//  oyuncunun kulübünü diğer kıtasal kupalara SOKMAZ ve bitmemiş kampanyayı
//  otomatik tamamlar (şampiyon kesinleşir).
//   http-server :3000 ayakta iken: node tools/test_cupchamp.js
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
        document.getElementById('player-lastname').value = 'Champ';
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
        const myTeam = p.teamId;
        const season = gameState.currentSeason;

        // ---- A) Kampanyayı ŞAMPİYON bitir → Kupalar görünümü SENİ şampiyon göstermeli ----
        e.done = true; e.champion = true; e.eliminated = false;
        e.championTeamId = e._team; e.championName = (DB.getTeam(e._team) || {}).name;
        let res = runSeasonCups(season);
        let rr = res[e.compId];
        r.champFromCampaign = !!rr && rr.champion === myTeam;          // eski bug: rastgele başka takım
        r.exitChampion = !!rr && rr.playerIn === true && rr.playerExit === 'Şampiyon';
        r.notChampElsewhere = Object.keys(res).every(id => id === e.compId || res[id].champion !== myTeam);
        r.noPlayerInElsewhere = Object.keys(res).every(id => id === e.compId || !res[id].playerIn);

        // ---- B) ELENDİN → kupalar görünümü kampanyanın şampiyonunu + elenme turunu gösterir ----
        const otherChamp = e.teams.find(id => id !== e._team);
        e.champion = false; e.eliminated = true; e.eliminatedRound = 'Çeyrek Final';
        e.championTeamId = otherChamp; e.championName = (DB.getTeam(otherChamp) || {}).name;
        res = runSeasonCups(season);
        rr = res[e.compId];
        r.elimChampSync = !!rr && rr.champion === otherChamp;
        r.elimExit = !!rr && rr.playerExit === 'Çeyrek Final';

        // ---- C) Kampanya BİTMEMİŞ → runSeasonCups otomatik tamamlar; sonuç senkron ----
        qualifyPlayerEuro();                          // taze kampanya (done=false)
        r.freshNotDone = !!gameState.euro && !gameState.euro.done;
        res = runSeasonCups(season);
        const e2 = gameState.euro;
        r.autoFinished = !!e2 && e2.done === true;
        rr = res[(e2 || {}).compId];
        const expChamp = e2 && (e2.champion ? e2._team : e2.championTeamId);
        r.autoChampSync = !!rr && !!expChamp && rr.champion === expChamp;
        return r;
    });

    await browser.close();

    const c = [];
    c.push(['Euro kampanyası kuruldu', out.hasEuro === true, '']);
    c.push(['Şampiyon kampanyadan: Kupalar sende gösteriyor', out.champFromCampaign === true, '']);
    c.push(['Akıbet: "Şampiyon" + katılım işareti', out.exitChampion === true, '']);
    c.push(['Kulübün BAŞKA kıta kupasında şampiyon değil', out.notChampElsewhere === true, '']);
    c.push(['Başka kupada "katıldın" görünmüyor', out.noPlayerInElsewhere === true, '']);
    c.push(['Elenince: şampiyon kampanyadan senkron', out.elimChampSync === true, '']);
    c.push(['Elenince: elenme turu gösteriliyor', out.elimExit === true, '']);
    c.push(['Bitmemiş kampanya otomatik tamamlanıyor', out.freshNotDone === true && out.autoFinished === true, '']);
    c.push(['Otomatik biten kampanya da senkron', out.autoChampSync === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== YUKSEK FIX — KUPALAR ↔ KAMPANYA ŞAMPİYON SENKRONU ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
