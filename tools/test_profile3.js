// Profil GEÇMİŞİ: gelişim eğrisi (OVR sparkline) + oynadığı maçlar tek-tek performans.
//  Kullanıcı: trainingHistory + matchLog. NPC: WorldDB matches'ten çıkarım.
//   http-server :3000 ayakta iken: node tools/test_profile3.js
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
        document.getElementById('player-firstname').value = 'Test';
        document.getElementById('player-lastname').value = 'Forvet';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 300));

    const out = await page.evaluate(async () => {
        const r = {};
        await DB.loadPlayers('tur-super-lig');
        const gala = 'tur-super-lig__galatasaray';
        const opp = 'tur-super-lig__fenerbahce';
        const season = gameState.currentSeason;

        // --- KULLANICI: sentetik gelişim + maç geçmişi enjekte et ---
        gameState.player.trainingHistory = [
            { season, week: 1, src: 'başlangıç', ovr: 70, main: {}, ovrDelta: 0 },
            { season, week: 3, src: 'antrenman', ovr: 72, main: {}, ovrDelta: 2 },
            { season, week: 6, src: 'antrenman', ovr: 75, main: {}, ovrDelta: 3 },
        ];
        gameState.player.matchLog = [
            { season, week: 2, leagueId: 'tur-super-lig', home: gala, away: opp, sh: 2, sa: 1, rating: 7.8, g: 1, a: 1, motm: 1 },
            { season, week: 4, leagueId: 'tur-super-lig', home: opp, away: gala, sh: 0, sa: 3, rating: 8.5, g: 2, a: 0, motm: 1 },
            { season, week: 5, leagueId: null, comp: 'Şampiyonlar Ligi', home: gala, away: opp, sh: 1, sa: 1, rating: null, g: 0, a: 0, motm: 0, dnp: 1 },
        ];
        openPlayerProfile('USER', gameState.player.teamId);
        await new Promise(res => setTimeout(res, 250));
        const body = document.getElementById('player-profile-body');
        r.u_devCurve = !!document.querySelector('#pp-devcurve svg.dev-chart');
        r.u_matchRows = document.querySelectorAll('#pp-matches .pp-m-row').length;
        r.u_clickRows = document.querySelectorAll('#pp-matches .pp-m-click').length;   // 2 lig maçı tıklanabilir
        r.u_hasDnp = !!document.querySelector('#pp-matches .pp-m-dnp');
        r.u_hasComp = (document.querySelector('#pp-matches .pp-m-comp') || {}).textContent || '';
        // lig maçına tıkla → maç detayı açılır
        const det = document.getElementById('match-detail-modal'); det.style.display = 'none';
        const clk = document.querySelector('#pp-matches .pp-m-click'); if (clk) clk.click();
        await new Promise(res => setTimeout(res, 200));
        r.u_matchDetailOpened = det.style.display === 'flex';
        det.style.display = 'none';
        document.getElementById('player-profile-modal').style.display = 'none';

        // --- NPC: WorldDB'ye gerçek bir maç yaz → profilde görünmeli ---
        const npc = DB.squadSync(gala).find(p => p.attrs && /^\d+$/.test(String(p.id)) && p.pos !== 'Kaleci');
        const slot = gameState._slot;
        r.slotOk = slot != null;
        await WorldDB.recordMatches([{
            slot, id: season + ':tur-super-lig:0:' + gala + ':' + opp, season, week: 0, leagueId: 'tur-super-lig',
            home: gala, away: opp, sh: 2, sa: 1,
            homeXI: [npc.id], homeSubs: [], awayXI: [], awaySubs: [],
            events: [{ min: 10, type: 'goal', teamId: gala, playerId: npc.id, assistId: null },
                     { min: 40, type: 'goal', teamId: gala, playerId: npc.id, assistId: null }]
        }]);
        openPlayerProfile(npc.id, gala);
        await new Promise(res => setTimeout(res, 350));
        const npcRows = document.querySelectorAll('#pp-matches .pp-m-row');
        r.npc_rows = npcRows.length;
        r.npc_firstGA = npcRows.length ? npcRows[0].querySelector('.pp-m-ga').textContent.trim() : '';
        r.npc_clickable = document.querySelectorAll('#pp-matches .pp-m-click').length > 0;
        return r;
    });

    await browser.close();

    const c = [];
    c.push(['Kullanıcı: gelişim eğrisi SVG çizildi', out.u_devCurve === true, '']);
    c.push(['Kullanıcı: 3 maç satırı', out.u_matchRows === 3, `=${out.u_matchRows}`]);
    c.push(['Kullanıcı: 2 lig maçı tıklanabilir', out.u_clickRows === 2, `=${out.u_clickRows}`]);
    c.push(['Kullanıcı: "oynamadı" (dnp) gösterildi', out.u_hasDnp === true, '']);
    c.push(['Kullanıcı: kupa rozeti (Şampiyonlar Ligi)', /Şampiyonlar/.test(out.u_hasComp), out.u_hasComp]);
    c.push(['Kullanıcı: maça tıkla → detay açıldı', out.u_matchDetailOpened === true, '']);
    c.push(['NPC: slot mevcut', out.slotOk === true, '']);
    c.push(['NPC: WorldDB maçı profilde göründü (1 satır)', out.npc_rows === 1, `=${out.npc_rows}`]);
    c.push(['NPC: maçta 2 gol doğru çıkarıldı', /2G/.test(out.npc_firstGA), out.npc_firstGA]);
    c.push(['NPC: maç satırı tıklanabilir', out.npc_clickable === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== PROFİL GEÇMİŞİ: GELİŞİM EĞRİSİ + MAÇ-MAÇ PERFORMANS ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
