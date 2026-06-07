// FM-tarzı ARAMA + takım kadrosu önizleme (57-search.js).
//  (1) Oluşturma: takım dropdown'ında "kadroyu önizle" (göz) butonu → seçmeden kadro açar.
//  (2) Kariyer içi global arama: takım (ad), ülke alias (Türkiye→Turkey), stadyum, oyuncu (ad).
//  (3) Sonuç tıklama zinciri: takım → kadro modalı → oyuncu → profil.
//   http-server :3000 ayakta iken: node tools/test_search.js
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

    // ---------- (1) OLUŞTURMA: göz butonu önizleme ----------
    const cr = await page.evaluate(async () => {
        const poll = async (fn, ms = 6000, step = 120) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, step)); } return fn(); };
        if (typeof initCustomDropdowns === 'function') initCustomDropdowns();
        await new Promise(r => setTimeout(r, 250));
        const acts = document.querySelectorAll('#dropdown-team .dd-opt-action');
        const r = { actionBtns: acts.length };
        const teamHidden = document.getElementById('player-team');
        const before = teamHidden ? teamHidden.value : '';
        // Varsayılandan farklı bir option'ın göz butonuna bas (seçim DEĞİŞMEMELİ)
        const target = acts.length > 1 ? acts[acts.length - 1] : acts[0];
        if (target) target.click();
        const opened = await poll(() => {
            const m = document.getElementById('team-squad-modal');
            return m && m.style.display === 'flex' && document.querySelectorAll('#team-squad-body .ts-row').length > 0;
        });
        r.squadOpened = opened;
        r.squadRows = document.querySelectorAll('#team-squad-body .ts-row').length;
        r.squadTeamName = (document.querySelector('#team-squad-body .ts-head-info h2') || {}).textContent || '';
        r.selectionUnchanged = (teamHidden ? teamHidden.value : '') === before;
        // kadro modalını kapat
        const cb = document.getElementById('btn-close-team-squad'); if (cb) cb.click();
        return r;
    });

    // ---------- Kariyer başlat ----------
    await page.evaluate(() => {
        document.getElementById('player-firstname').value = 'Test';
        document.getElementById('player-lastname').value = 'Arama';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 500));

    // ---------- (2)+(3) KARİYER İÇİ GLOBAL ARAMA ----------
    const se = await page.evaluate(async () => {
        const poll = async (fn, ms = 15000, step = 150) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, step)); } return fn(); };
        const type = (v) => { const i = document.getElementById('global-search-input'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); };
        const resultsTxt = () => (document.getElementById('global-search-results') || {}).textContent || '';
        const r = {};

        r.navBtn = !!document.getElementById('nav-search-btn');
        document.getElementById('nav-search-btn').click();
        await new Promise(res => setTimeout(res, 100));
        const modal = document.getElementById('global-search-modal');
        r.modalOpen = modal && modal.style.display === 'flex';

        // (a) Takım adı: "galatasaray"
        type('galatasaray');
        await new Promise(res => setTimeout(res, 150));
        r.teamByName = /Galatasaray/i.test(document.querySelector('#global-search-results .gs-team') ? resultsTxt() : '');

        // (b) Ülke alias: "türkiye" → Türk takımları (Turkey ligi)
        type('türkiye');
        await new Promise(res => setTimeout(res, 150));
        const turkRows = [...document.querySelectorAll('#global-search-results .gs-team')].map(e => e.textContent).join(' | ');
        r.countryAlias = /Turkey/i.test(turkRows) && /Galatasaray|Fenerbah|Beşiktaş|Trabzon/i.test(turkRows);

        // (c) Stadyum: bir takımın stadyum adıyla ara → o takım çıkar
        const gs = DB.getTeam('tur-super-lig__galatasaray');
        const stadName = gs && gs.stadium ? gs.stadium.name : '';
        r.stadName = stadName;
        if (stadName) {
            type(stadName);
            await new Promise(res => setTimeout(res, 150));
            r.stadiumSearch = [...document.querySelectorAll('#global-search-results .gs-team')].some(e => /Galatasaray/i.test(e.textContent));
        } else { r.stadiumSearch = true; }

        // (d) Oyuncu adı: "Osimhen" — oyuncular tüm liglerden lazy yüklenince çıkar
        type('osimhen');
        const playerOk = await poll(() => [...document.querySelectorAll('#global-search-results .gs-player')].some(e => /Osimhen/i.test(e.textContent)));
        r.playerByName = playerOk;
        r.playerCount = document.querySelectorAll('#global-search-results .gs-player').length;

        // (e) Takım sonucu tıkla → kadro modalı açılır
        type('galatasaray');
        await new Promise(res => setTimeout(res, 150));
        const gteam = [...document.querySelectorAll('#global-search-results .gs-team')].find(e => /Galatasaray/i.test(e.textContent));
        if (gteam) gteam.click();
        const squadOpen = await poll(() => { const m = document.getElementById('team-squad-modal'); return m && m.style.display === 'flex' && document.querySelectorAll('#team-squad-body .ts-row[data-pid]').length > 0; }, 8000);
        r.squadFromSearch = squadOpen;

        // (f) Kadroda oyuncuya tıkla → profil modalı açılır (kariyer içi)
        const prow = document.querySelector('#team-squad-body .ts-row[data-pid]');
        if (prow) prow.click();
        const profOpen = await poll(() => { const m = document.getElementById('player-profile-modal'); return m && m.style.display === 'flex'; }, 5000);
        r.profileFromSquad = profOpen;

        return r;
    });

    await browser.close();

    const c = [];
    c.push(['Oluşturma: takım göz (önizle) butonları var', cr.actionBtns > 0, `=${cr.actionBtns}`]);
    c.push(['Göz → kadro modalı açıldı (oyuncularla)', cr.squadOpened === true, `rows=${cr.squadRows}`]);
    c.push(['Kadro başlığında takım adı var', !!cr.squadTeamName, `="${cr.squadTeamName}"`]);
    c.push(['Göz basınca seçim DEĞİŞMEDİ', cr.selectionUnchanged === true, '']);
    c.push(['Nav "Ara" butonu var', se.navBtn === true, '']);
    c.push(['Global arama modalı açıldı', se.modalOpen === true, '']);
    c.push(['Takım adıyla arama (galatasaray)', se.teamByName === true, '']);
    c.push(['Ülke alias (türkiye → Türk takımları)', se.countryAlias === true, '']);
    c.push(['Stadyum adıyla arama → takım', se.stadiumSearch === true, `stad="${se.stadName}"`]);
    c.push(['Oyuncu adıyla arama (osimhen)', se.playerByName === true, `players=${se.playerCount}`]);
    c.push(['Takım sonucu tıkla → kadro modalı', se.squadFromSearch === true, '']);
    c.push(['Kadroda oyuncu tıkla → profil', se.profileFromSquad === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== FM ARAMA + KADRO ÖNİZLEME ===`);
    console.log(JSON.stringify({ cr, se }) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
