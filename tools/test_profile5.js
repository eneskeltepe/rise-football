// Profil düzeltmeleri: (1) Geçmiş sekmesi İLK/güncel sezonu da gösterir, (2) Maçlar'da sezon
// filtresi (#pp-mseason), (3) maça tıklayınca maç detayı profil modalının ÜSTÜNde (z-index).
//   http-server :3000 ayakta iken: node tools/test_profile5.js
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
        const r = {}, body = () => document.getElementById('player-profile-body');
        await DB.loadPlayers('tur-super-lig');
        const gala = 'tur-super-lig__galatasaray', fener = 'tur-super-lig__fenerbahce';
        const slot = gameState._slot, season = gameState.currentSeason;
        const npc = DB.squadSync(gala).find(p => p.attrs && /^\d+$/.test(String(p.id)) && p.pos !== 'Kaleci');

        // İlk sezonda NPC için bir maç yaz (Maçlar + tıklama testi)
        await WorldDB.recordMatches([{
            slot, id: season + ':tur-super-lig:0:' + gala + ':' + fener, season, week: 0, leagueId: 'tur-super-lig',
            home: gala, away: fener, sh: 3, sa: 1, homeXI: [npc.id], homeSubs: [], awayXI: [], awaySubs: [],
            events: [{ min: 12, type: 'goal', teamId: gala, playerId: npc.id, assistId: null }]
        }]);

        openPlayerProfile(npc.id, gala);
        await new Promise(res => setTimeout(res, 300));
        const b = body();

        // (1) Geçmiş sekmesi → güncel/ilk sezon satırı görünür
        b.querySelector('.pp-tab[data-pane="gecmis"]').click();
        await new Promise(res => setTimeout(res, 150));
        r.histRows = b.querySelectorAll('#pp-history tbody tr').length;
        r.histCurRow = b.querySelectorAll('#pp-history .pp-hist-cur').length === 1;
        r.histCurTag = !!b.querySelector('#pp-history .pp-cur-tag');

        // (2) Maçlar sekmesi → sezon filtresi var + maç listelenir
        b.querySelector('.pp-tab[data-pane="maclar"]').click();
        await new Promise(res => setTimeout(res, 300));
        r.seasonFilter = !!b.querySelector('#pp-mseason');
        r.seasonOptions = b.querySelectorAll('#pp-mseason option').length;
        r.matchRows = b.querySelectorAll('#pp-mlist .pp-m-row').length;

        // (3) Maça tıkla → maç detayı profil modalının ÜSTÜnde
        const det = document.getElementById('match-detail-modal'); det.style.display = 'none';
        const row = b.querySelector('#pp-mlist .pp-m-click'); if (row) row.click();
        await new Promise(res => setTimeout(res, 250));
        const prof = document.getElementById('player-profile-modal');
        r.detOpen = det.style.display === 'flex';
        r.profStillOpen = prof.style.display === 'flex';
        const detZ = parseInt(getComputedStyle(det).zIndex, 10) || 0;
        const profZ = parseInt(getComputedStyle(prof).zIndex, 10) || 0;
        r.detAbove = detZ > profZ;
        r.detZ = detZ; r.profZ = profZ;
        det.style.display = 'none'; prof.style.display = 'none';

        // Kullanıcı profili: Geçmiş ilk sezon satırı
        openPlayerProfile('USER', gameState.player.teamId);
        await new Promise(res => setTimeout(res, 200));
        const ub = body();
        ub.querySelector('.pp-tab[data-pane="gecmis"]').click();
        r.userHistCur = ub.querySelectorAll('#pp-history .pp-hist-cur').length === 1;
        return r;
    });

    await browser.close();

    const c = [];
    c.push(['Geçmiş: güncel/ilk sezon satırı var (≥1)', out.histRows >= 1, `=${out.histRows}`]);
    c.push(['Geçmiş: tam 1 "güncel" satırı işaretli', out.histCurRow === true, '']);
    c.push(['Geçmiş: "güncel" etiketi görünüyor', out.histCurTag === true, '']);
    c.push(['Maçlar: sezon filtresi (#pp-mseason) var', out.seasonFilter === true, '']);
    c.push(['Maçlar: sezon seçeneği ≥1', out.seasonOptions >= 1, `=${out.seasonOptions}`]);
    c.push(['Maçlar: maç listelendi', out.matchRows >= 1, `=${out.matchRows}`]);
    c.push(['Maça tıkla → detay açıldı', out.detOpen === true, '']);
    c.push(['Detay açılınca profil HÂLÂ açık', out.profStillOpen === true, '']);
    c.push(['Maç detayı profil modalının ÜSTÜnde', out.detAbove === true, `det=${out.detZ} prof=${out.profZ}`]);
    c.push(['Kullanıcı Geçmiş: güncel sezon satırı', out.userHistCur === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== PROFİL: GEÇMİŞ(GÜNCEL SEZON) + MAÇ SEZON FİLTRESİ + DETAY Z-INDEX ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
