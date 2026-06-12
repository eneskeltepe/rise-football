// TEKNİK BORÇ #22 — "Sezon-2 + reload tutarlılığı" regresyon senaryosu:
//  GERÇEK sezon-devri yolu (btn-start-next-season handler'ı) çalıştırılır, sezon 2'de
//  oynanmış skorlar + dünya durumu kaydedilir, sayfa YENİLENİR ve karşılaştırılır:
//  lig üyelikleri (terfi/küme düşme), takım güçleri (evrim replay), puan durumu,
//  fikstür skorları ve dolgu oyuncu yaşlanması reload öncesi-sonrası BİREBİR aynı olmalı.
//  (Eski test sınıfı bunu hiç yakalamıyordu; dünya kayması ancak sezon 2+ reload'da görünür.)
//   http-server :3000 ayakta iken: node tools/test_reloadseason.js
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
        document.getElementById('player-firstname').value = 'Reload';
        document.getElementById('player-lastname').value = 'Season';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 500));

    // ---- Bölüm 1: GERÇEK sezon-devri yolu (buton handler'ı) + sezon-2 durumu kaydet ----
    const s1 = await page.evaluate(() => {
        // Dolgu oyuncu tohumla: sezon devrinde yaşlanmalı (D4 e2e — gerçek pipeline üstünden)
        const tid = gameState.player.teamId;
        gameState.genFillers = {};
        gameState.genFillers[tid] = [
            { id: 'gen_rs_0', name: 'Dolgu', pos: 'Santrfor', position: 'Santrfor', ovr: 60, age: 20, teamId: tid, img: '', isGen: true },
        ];
        gameState.currentWeek = (typeof activeLeagueWeeks === 'function' ? activeLeagueWeeks() : 36) + 1;
        document.getElementById('btn-start-next-season').click();   // GERÇEK rollover yolu
        return { clicked: true };
    });
    await new Promise(r => setTimeout(r, 2500));   // async WorldDB zinciri (agregat/evrim) otursun

    const s2 = await page.evaluate(() => {
        const r = {};
        const p = gameState.player;
        r.season2 = gameState.currentSeason === START_SEASON + 1;
        // Dolgu yaşlandı mı (gerçek sezon-devri pipeline'ı ageGenFillers'ı çağırdı mı)
        const gf = (gameState.genFillers && gameState.genFillers[p.teamId]) || [];
        r.fillerAged = gf.length === 1 && gf[0].age === 21;
        // Terfi/küme düşme overlay'e yazıldı + DB'ye uygulandı
        const moves = Object.keys(gameState.teamLeagues || {});
        r.movesN = moves.length;
        r.movesApplied = moves.length > 0 && moves.every(id => DB.getTeam(id).leagueId === gameState.teamLeagues[id]);

        // Sezon 2'de "oynanmış" hafta-1 skorları + hafta ilerlet
        const wk0 = gameState.fixtures[0];
        const my = wk0.find(m => !m.isBay && (m.home === p.teamId || m.away === p.teamId));
        my.scoreHome = 4; my.scoreAway = 2;
        gameState.matchesPlayedThisWeek = true;
        gameState.currentWeek = 5;   // reload sonrası fikstür navigasyonu buradan başlamalı
        r.myHome = my.home; r.myAway = my.away;

        // Dünya anlık görüntüsü: tüm overlay takımları + ilk 40 takım (id → lig, güç)
        const sample = Array.from(new Set(moves.concat(DB.teams().slice(0, 40).map(t => t.id))));
        r.worldSnap = sample.map(id => { const t = DB.getTeam(id); return [id, t.leagueId, t.power]; });
        r.standingsSnap = JSON.stringify(gameState.standings[activeLeagueId()]);
        saveGame();
        r.slot = gameState._slot;
        return r;
    });

    // ---- Bölüm 2: RELOAD → sezon-2 dünyası + skorlar + navigasyon BİREBİR geri gelmeli ----
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 600));
    const s3 = await page.evaluate((ctx) => {
        const r = {};
        r.loaded = loadFromSlot(ctx.slot) === true;
        r.seasonKept = gameState.currentSeason === START_SEASON + 1 && gameState.currentWeek === 5;
        // Lig üyeliği + güç: kayıt öncesi anlık görüntüyle BİREBİR (restoreWorldState replay'i)
        let leagueOk = true, powerOk = true;
        for (const [id, lg, pw] of ctx.worldSnap) {
            const t = DB.getTeam(id);
            if (!t || t.leagueId !== lg) leagueOk = false;
            if (!t || t.power !== pw) powerOk = false;
        }
        r.leagueOk = leagueOk; r.powerOk = powerOk;
        // Puan durumu aynen (yeniden kurulup sıfırlanMAdı)
        r.standingsKept = JSON.stringify(gameState.standings[activeLeagueId()]) === ctx.standingsSnap;
        // Oynanmış sezon-2 skoru korunur
        const wk0 = gameState.fixtures[0] || [];
        const my = wk0.find(m => m.home === ctx.myHome && m.away === ctx.myAway);
        r.scoreKept = !!my && my.scoreHome === 4 && my.scoreAway === 2;
        // Dolgu oyuncular kayıttan aynen döner (yeniden yaşlanmaz / kaybolmaz)
        const gf = (gameState.genFillers && gameState.genFillers[gameState.player.teamId]) || [];
        r.fillerKept = gf.length === 1 && gf[0].age === 21;
        // D1: fikstür hafta navigasyonu güncel haftadan başlar
        r.fixWeekSynced = (typeof fixtureViewingWeek !== 'undefined') && fixtureViewingWeek === 5;
        return r;
    }, s2);

    await browser.close();

    const c = [];
    c.push(['Gerçek sezon-devri yolu çalıştı (sezon 2)', s2.season2 === true, '']);
    c.push(['Sezon devrinde dolgu oyuncu yaşlandı (pipeline)', s2.fillerAged === true, '']);
    c.push(['Terfi/küme düşme overlay\'e yazıldı + uygulandı', s2.movesN > 0 && s2.movesApplied === true, `${s2.movesN} hamle`]);
    c.push(['Reload: kayıt yüklendi', s3.loaded === true, '']);
    c.push(['Reload: sezon/hafta korundu (S2, hafta 5)', s3.seasonKept === true, '']);
    c.push(['Reload: TÜM lig üyelikleri birebir aynı', s3.leagueOk === true, '']);
    c.push(['Reload: TÜM takım güçleri birebir aynı (evrim replay)', s3.powerOk === true, '']);
    c.push(['Reload: puan durumu birebir aynı', s3.standingsKept === true, '']);
    c.push(['Reload: oynanmış sezon-2 skoru korundu (4-2)', s3.scoreKept === true, '']);
    c.push(['Reload: dolgu oyuncular aynen döndü', s3.fillerKept === true, '']);
    c.push(['Reload: fikstür navigasyonu güncel haftada', s3.fixWeekSynced === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== TEKNİK BORÇ #22 — SEZON-2 + RELOAD TUTARLILIĞI ===`);
    console.log(JSON.stringify({ s2: { season2: s2.season2, movesN: s2.movesN, fillerAged: s2.fillerAged }, s3 }).slice(0, 500) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
