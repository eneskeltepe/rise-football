// FM-tarzı ETKİLEŞİMLİ profil: sekmeler + mevki/rol/özellik senkronu + açılışta en iyi seçili
// + mevki haritası tıklama + kırmızı kart + kaleci 0-stat fix.
//   http-server :3000 ayakta iken: node tools/test_profile2.js
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

    const out = await page.evaluate(async () => {
        const r = {}, body = () => document.getElementById('player-profile-body');
        await DB.loadPlayers('tur-super-lig');
        const gs = 'tur-super-lig__galatasaray';
        const npc = DB.squadSync(gs).find(p => p.attrs && /^\d+$/.test(String(p.id)) && p.pos !== 'Kaleci');
        openPlayerProfile(npc.id, gs);
        await new Promise(res => setTimeout(res, 250));
        const b = body();
        const mc = document.querySelector('#player-profile-modal .modal-content');

        r.fullscreen = !!(mc && mc.classList.contains('pp-modal-content'));
        r.posmapSpots = b.querySelectorAll('.pp-posmap .pp-pos-spot').length;
        r.attrCells = b.querySelectorAll('.pp-attr[data-attr]').length;
        r.roleRows = b.querySelectorAll('.pp-role[data-rolekey]').length;
        r.redCardBox = b.querySelector('.pp-pane[data-pane="genel"]').textContent.includes('Kırmızı Kart');

        // AÇILIŞTA: en iyi mevki + rol seçili → vurgu hazır (tıklamadan)
        r.openHighlight = b.querySelectorAll('.pp-attr.attr-key').length;       // >0 olmalı
        r.openUseful = b.querySelectorAll('.pp-attr.attr-useful').length;
        r.roleSelOne = b.querySelectorAll('.pp-role.pp-role-sel').length === 1;
        r.roleBestOne = b.querySelectorAll('.pp-role.pp-role-best').length === 1;
        r.posSelOne = b.querySelectorAll('.pp-pos-spot.pp-pos-sel').length === 1;
        r.famSel = b.querySelectorAll('.pp-fam.pp-fam-sel').length >= 1;

        // FARKLI ROL seç → vurgu hâlâ var, seçim taşınır
        const rolesNow = [...b.querySelectorAll('.pp-role[data-rolekey]')];
        const other = rolesNow.find(e => !e.classList.contains('pp-role-sel'));
        if (other) { const k = other.dataset.rolekey; other.click(); r.roleSwitched = b.querySelector('.pp-role.pp-role-sel').dataset.rolekey === k; }
        else r.roleSwitched = true;
        r.afterRoleKey = b.querySelectorAll('.pp-attr.attr-key').length;

        // MEVKİ HARİTASINDAN Stoper seç → roller CB ailesine değişir (Kimmich senaryosu)
        const beforeKeys = [...b.querySelectorAll('.pp-role[data-rolekey]')].map(e => e.dataset.rolekey);
        const stp = b.querySelector('.pp-pos-spot[data-pos="Stoper"]');
        if (stp) {
            stp.click();
            const afterKeys = [...b.querySelectorAll('.pp-role[data-rolekey]')].map(e => e.dataset.rolekey);
            r.posClickChangedRoles = JSON.stringify(beforeKeys) !== JSON.stringify(afterKeys) && afterKeys.some(k => k.indexOf('cb_') === 0);
            r.posClickSel = b.querySelector('.pp-pos-spot[data-pos="Stoper"]').classList.contains('pp-pos-sel');
        } else { r.posClickChangedRoles = false; r.posClickSel = false; }

        // SEKMELER: Geçmiş'e geç → gecmis görünür, genel gizli
        b.querySelector('.pp-tab[data-pane="gecmis"]').click();
        r.tabGecmisShown = b.querySelector('.pp-pane[data-pane="gecmis"]').hidden === false;
        r.tabGenelHidden = b.querySelector('.pp-pane[data-pane="genel"]').hidden === true;

        // Kaleci profili: Fizik/Hız/Pas 0 değil + mevki haritası + açılış vurgusu
        const gk = DB.squadSync(gs).find(p => p.pos === 'Kaleci');
        openPlayerProfile(gk.id, gs);
        await new Promise(res => setTimeout(res, 200));
        const gb = body();
        const gkVals = [...gb.querySelectorAll('.pp-attr[data-attr]')].map(e => ({ k: e.getAttribute('data-attr'), v: parseInt(e.querySelector('strong').textContent, 10) }));
        r.gkPhysNonZero = ['hizlanma', 'guc', 'kisaPas', 'ziplama'].every(k => { const c = gkVals.find(x => x.k === k); return c && c.v > 0; });
        r.gkPosmap = gb.querySelectorAll('.pp-posmap .pp-pos-spot').length;
        r.gkOpenHighlight = gb.querySelectorAll('.pp-attr.attr-key').length;
        return r;
    });

    await browser.close();

    const c = [];
    c.push(['Profil tam-ekran', out.fullscreen === true, '']);
    c.push(['Mevki haritası 12 nokta', out.posmapSpots === 12, `=${out.posmapSpots}`]);
    c.push(['Özellik hücreleri data-attr', out.attrCells > 10, `=${out.attrCells}`]);
    c.push(['Rol satırları var (>1)', out.roleRows > 1, `=${out.roleRows}`]);
    c.push(['Kırmızı Kart kutusu var', out.redCardBox === true, '']);
    c.push(['AÇILIŞTA vurgu hazır (mavi>0, tıklamadan)', out.openHighlight > 0, `key=${out.openHighlight} useful=${out.openUseful}`]);
    c.push(['Açılışta tam 1 rol SEÇİLİ', out.roleSelOne === true, '']);
    c.push(['Açılışta tam 1 EN İYİ rol işaretli', out.roleBestOne === true, '']);
    c.push(['Açılışta tam 1 mevki (harita) seçili', out.posSelOne === true, '']);
    c.push(['Açılışta yetkinlik çipi seçili', out.famSel === true, '']);
    c.push(['Farklı rol seç → seçim taşındı', out.roleSwitched === true, '']);
    c.push(['Rol değişince vurgu hâlâ var', out.afterRoleKey > 0, `key=${out.afterRoleKey}`]);
    c.push(['Haritadan Stoper → roller CB ailesine değişti', out.posClickChangedRoles === true, '']);
    c.push(['Haritada Stoper seçili işaretlendi', out.posClickSel === true, '']);
    c.push(['Sekme: Geçmiş görünür oldu', out.tabGecmisShown === true, '']);
    c.push(['Sekme: Genel gizlendi', out.tabGenelHidden === true, '']);
    c.push(['Kaleci Fizik/Hız/Pas 0 DEĞİL', out.gkPhysNonZero === true, '']);
    c.push(['Kaleci mevki haritası 12 nokta', out.gkPosmap === 12, `=${out.gkPosmap}`]);
    c.push(['Kaleci açılış vurgusu hazır', out.gkOpenHighlight > 0, `key=${out.gkOpenHighlight}`]);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== FM-TARZI ETKİLEŞİMLİ PROFİL ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
