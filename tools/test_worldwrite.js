// ORTA FIX (O6+O8) — Dünya kayıt bütünlüğü:
//  (O6) Oynamadığın haftalarda (sakat/cezalı/kadro dışı) takımının maçı da WorldDB'ye
//       yazılır (takım arkadaşlarının istatistikleri eksik kalmaz; kullanıcıya bayat
//       kart/gol atfedilmez).
//  (O8) Dünya yazımları window._worldWriteSync zincirinde izlenir → sezon-sonu agregat
//       son haftanın maçları yazılmadan koşmaz (yarış fix'i).
//   http-server :3000 ayakta iken: node tools/test_worldwrite.js
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
    await new Promise(r => setTimeout(r, 500));
    await page.evaluate(() => {
        document.getElementById('player-firstname').value = 'World';
        document.getElementById('player-lastname').value = 'Write';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 500));

    const out = await page.evaluate(async () => {
        const r = {};
        const p = gameState.player;
        const slot = gameState._slot, season = gameState.currentSeason;
        const lid = activeLeagueId();
        await DB.loadPlayers('tur-super-lig');

        // ---- O6: SAKAT haftada takım maçı WorldDB'ye yazılır ----
        p.injury = { name: 'Test', weeks: 2 };
        gameState.gameDate = 5;   // maç günü
        startMatchDay();          // 90-main sarmalayıcısı: takım maçı oyuncusuz + kayıt
        const m = (gameState.fixtures[0] || []).find(x => !x.isBay && (x.home === p.teamId || x.away === p.teamId));
        r.teamPlayed = !!m && m.scoreHome !== null;
        const mid = season + ':' + lid + ':0:' + m.home + ':' + m.away;
        let rec = null;
        for (let k = 0; k < 20 && !rec; k++) {      // fire-and-forget yazımı bekle (maks 5sn)
            await new Promise(res => setTimeout(res, 250));
            rec = await WorldDB.get('matches', [slot, mid]);
        }
        r.recorded = !!rec && rec.userMatch === true && rec.sh === m.scoreHome && rec.sa === m.scoreAway;
        r.lineupsOk = !!rec && (rec.homeXI || []).length === 11 && (rec.awayXI || []).length === 11;
        // Kullanıcı OYNAMADI → USER'a gol/kart atfı OLMAMALI
        r.noUserEvents = !!rec && !(rec.events || []).some(ev => ev.playerId === 'USER' || ev.assistId === 'USER');

        // ---- O8: _worldWriteSync zinciri — dünya haftası yazımı beklenebilir ----
        p.injury = null;
        gameState._lastSimWeek = -1;
        simulateOtherWeekMatches(0);
        r.hasSync = !!window._worldWriteSync && typeof window._worldWriteSync.then === 'function';
        const t0 = Date.now();
        await window._worldWriteSync;             // sezon-sonu agregatın beklediği zincir
        r.syncMs = Date.now() - t0;
        const wk = await WorldDB.matchesOfWeek(slot, season, 'eng-premier-league', 0);
        r.weekWritten = (wk || []).length > 0;    // zincir çözüldüğünde maçlar GERÇEKTEN yazılmış
        return r;
    });

    await browser.close();

    const c = [];
    c.push(['Sakat haftada takım maçı oynandı', out.teamPlayed === true, '']);
    c.push(['Maç WorldDB\'ye yazıldı (skor birebir)', out.recorded === true, '']);
    c.push(['Dizilişler kadrodan (11+11)', out.lineupsOk === true, '']);
    c.push(['Oynamayan kullanıcıya gol/kart atfı YOK', out.noUserEvents === true, '']);
    c.push(['_worldWriteSync zinciri mevcut', out.hasSync === true, '']);
    c.push(['Zincir çözüldüğünde hafta maçları yazılmış', out.weekWritten === true, `${out.syncMs}ms beklendi`]);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== ORTA FIX — DÜNYA KAYIT BÜTÜNLÜĞÜ (O6+O8) ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
