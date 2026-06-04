// Profil modalı geliştirmeleri: FM-tarzı özellik VURGULAMA (rol/mevkiye tıkla) + MEVKİ HARİTASI
// + tam-ekran. Ayrıca kaleci 0-stat fix doğrulaması.
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
        const r = {};
        await DB.loadPlayers('tur-super-lig');
        const gs = 'tur-super-lig__galatasaray';
        const npc = DB.squadSync(gs).find(p => p.attrs && /^\d+$/.test(String(p.id)) && p.pos !== 'Kaleci');
        openPlayerProfile(npc.id, gs);
        await new Promise(res => setTimeout(res, 250));
        const body = document.getElementById('player-profile-body');
        const mc = document.querySelector('#player-profile-modal .modal-content');

        r.fullscreen = !!(mc && mc.classList.contains('pp-modal-content'));
        r.posmapSpots = body.querySelectorAll('.pp-posmap .pp-pos-spot').length;
        r.attrCells = body.querySelectorAll('.pp-attr[data-attr]').length;
        r.roleRows = body.querySelectorAll('.pp-role[data-rolekey]').length;

        // Rol satırına tıkla → en az bir özellik "attr-key" (mavi) olmalı
        const role = body.querySelector('.pp-role[data-rolekey]');
        role.click();
        r.afterRoleKey = body.querySelectorAll('.pp-attr.attr-key').length;
        r.afterRoleUseful = body.querySelectorAll('.pp-attr.attr-useful').length;
        r.roleActiveMark = body.querySelectorAll('.pp-role.hl-active').length === 1;
        // tekrar tıkla → temizlenir
        role.click();
        r.afterClear = body.querySelectorAll('.pp-attr.attr-key, .pp-attr.attr-useful').length;

        // Mevki çipine tıkla → vurgu uygulanır
        const fam = body.querySelector('.pp-fam[data-pos]');
        if (fam) { fam.click(); r.afterPos = body.querySelectorAll('.pp-attr.attr-key, .pp-attr.attr-useful').length; }
        else r.afterPos = 0;

        // Kaleci profili: Fizik/Hız/Pas artık 0 değil + mevki haritası + rol vurgulama
        const gk = DB.squadSync(gs).find(p => p.pos === 'Kaleci');
        openPlayerProfile(gk.id, gs);
        await new Promise(res => setTimeout(res, 200));
        const gb = document.getElementById('player-profile-body');
        const gkAttrVals = [...gb.querySelectorAll('.pp-attr[data-attr]')].map(e => ({ k: e.getAttribute('data-attr'), v: parseInt(e.querySelector('strong').textContent, 10) }));
        const physKeys = ['hizlanma', 'guc', 'kisaPas', 'ziplama'];
        r.gkPhysNonZero = physKeys.every(k => { const c = gkAttrVals.find(x => x.k === k); return c && c.v > 0; });
        r.gkPosmap = gb.querySelectorAll('.pp-posmap .pp-pos-spot').length;
        const gkRole = gb.querySelector('.pp-role[data-rolekey]');
        if (gkRole) { gkRole.click(); r.gkRoleKey = gb.querySelectorAll('.pp-attr.attr-key').length; }
        else r.gkRoleKey = 0;

        return r;
    });

    await browser.close();

    const c = [];
    c.push(['Profil tam-ekran (pp-modal-content)', out.fullscreen === true, '']);
    c.push(['Mevki haritası 12 nokta', out.posmapSpots === 12, `=${out.posmapSpots}`]);
    c.push(['Özellik hücreleri data-attr taşıyor', out.attrCells > 10, `=${out.attrCells}`]);
    c.push(['Rol satırları tıklanabilir', out.roleRows > 1, `=${out.roleRows}`]);
    c.push(['Role tıkla → mavi (çok önemli) özellik var', out.afterRoleKey > 0, `key=${out.afterRoleKey}`]);
    c.push(['Role tıkla → aktif işaret (1)', out.roleActiveMark === true, '']);
    c.push(['Tekrar tıkla → vurgu temizlenir', out.afterClear === 0, `kalan=${out.afterClear}`]);
    c.push(['Mevki çipine tıkla → vurgu uygulanır', out.afterPos > 0, `=${out.afterPos}`]);
    c.push(['Kaleci Fizik/Hız/Pas artık 0 DEĞİL', out.gkPhysNonZero === true, '']);
    c.push(['Kaleci profili mevki haritası 12 nokta', out.gkPosmap === 12, `=${out.gkPosmap}`]);
    c.push(['Kaleci rol vurgulaması çalışıyor', out.gkRoleKey > 0, `key=${out.gkRoleKey}`]);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== PROFİL: VURGULAMA + MEVKİ HARİTASI + KALECİ STAT ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
