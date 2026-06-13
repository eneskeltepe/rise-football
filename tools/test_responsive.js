// ============================================================================
//  test_responsive.js — Mobil / Responsive doğrulama (v2.15.0)
//  Çoklu viewport (iPhone SE/12 dikey, küçük dikey, telefon yatay, tablet) altında:
//   • yatay TAŞMA yok (documentElement.scrollWidth ≤ innerWidth) — her sekme + ekran
//   • mobil dikeyde alt sabit sekme çubuğu görünür + dokunmatik hedefler ≥38px +
//     içerik alt çubuğun arkasında kalmıyor (tab-content-container padding-bottom)
//   • yatayda üst nav korunur (bottom-fixed değil)
//   • maç ekranı: "Maç/Kadro" sekme toggle çalışır; karar anı "Kadro"dayken
//     otomatik "Maç" görünümüne döner (kaçırılmaz) + karar kutusu görünür
//   • modal'lar (profil/arama/diyalog) viewport'a sığar, taşmaz
//  GERÇEK görünürlük: getBoundingClientRect ile ölçülür (salt display/node DEĞİL).
//   http-server :3000 ayakta iken:  node tools/test_responsive.js
// ============================================================================
const puppeteer = require('puppeteer');

const VPS = [
    { name: 'iPhoneSE-dikey', w: 375, h: 667, portrait: true },
    { name: 'iPhone12-dikey', w: 390, h: 844, portrait: true },
    { name: 'kucuk-dikey',    w: 360, h: 640, portrait: true },
    { name: 'telefon-yatay',  w: 844, h: 390, portrait: false },
    { name: 'tablet-dikey',   w: 768, h: 1024, portrait: false },
];
const TABS = ['dashboard-tab', 'training-tab', 'standings-tab', 'calendar-tab', 'transfer-tab', 'stats-tab'];

(async () => {
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PE: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('CE: ' + m.text()); });

    await page.goto('http://127.0.0.1:3000/index.html', { waitUntil: 'networkidle2', timeout: 30000 });
    await page.evaluate(() => { localStorage.clear(); });
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 500));

    // ---- Oyuncu yarat (Santrfor / Galatasaray) ----
    await page.evaluate(() => {
        document.getElementById('player-firstname').value = 'Resp';
        document.getElementById('player-lastname').value = 'Test';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 500));
    await page.evaluate(async () => { await window.DB.loadPlayers('tur-super-lig'); });

    // Sayfada çalışacak yardımcılar (overflow + taşıran eleman tespiti)
    const VP_PROBE = `
        window.__probeOverflow = function() {
            const iw = window.innerWidth;
            const sw = document.documentElement.scrollWidth;
            let offender = null, ww = 0;
            if (sw > iw + 3) {
                document.querySelectorAll('body *').forEach(el => {
                    const cs = getComputedStyle(el);
                    if (cs.display === 'none' || cs.visibility === 'hidden') return;
                    const r = el.getBoundingClientRect();
                    if (r.width === 0 || r.height === 0) return;
                    if (r.right > iw + 3 && r.width > ww && r.width <= iw * 4) {
                        ww = r.width; offender = (el.id ? '#' + el.id : '.' + (el.className || el.tagName).toString().split(' ')[0]) + ' w=' + Math.round(r.width);
                    }
                });
            }
            return { ok: sw <= iw + 3, sw, iw, offender };
        };
    `;
    await page.evaluate(VP_PROBE);

    // ===================== Viewport döngüsü =====================
    const vpResults = {};
    for (const vp of VPS) {
        // NOT: isMobile/hasTouch SABİT (false) — değiştirmek Puppeteer'da sayfayı RELOAD
        // ettirir (boot → ana menü → gameState.player null). Genişlik-bazlı media query'ler
        // yine çalışır; bu testte ölçülen şey layout (touch hover-query yalnız tap-highlight).
        await page.setViewport({ width: vp.w, height: vp.h, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
        await new Promise(r => setTimeout(r, 160));
        await page.evaluate(VP_PROBE);   // setViewport sonrası tekrar enjekte (reflow garanti)

        const r = await page.evaluate(async (portrait) => {
            const out = { tabsOk: true, tabOverflow: {}, offenders: [] };
            for (const t of ['dashboard-tab', 'training-tab', 'standings-tab', 'calendar-tab', 'transfer-tab', 'stats-tab']) {
                const btn = document.querySelector(`.nav-btn[data-target="${t}"]`);
                if (btn) btn.click();
                await new Promise(res => setTimeout(res, 140));
                const p = window.__probeOverflow();
                out.tabOverflow[t] = p.ok;
                if (!p.ok) { out.tabsOk = false; out.offenders.push(t + ': ' + p.offender); }
            }
            // Nav konum + dokunmatik hedef + viewport içi
            const nav = document.querySelector('.game-nav');
            const cs = getComputedStyle(nav);
            const navRect = nav.getBoundingClientRect();
            const iw = window.innerWidth, ih = window.innerHeight;
            out.navPosition = cs.position;
            out.navPinnedBottom = (cs.position === 'fixed') && (Math.abs(navRect.bottom - ih) <= 2);
            const btns = [...document.querySelectorAll('.game-nav .nav-btn, .game-nav .nav-search-btn')];
            out.navBtnCount = btns.length;
            out.navBtnsOk = btns.length >= 6 && btns.every(b => {
                const r = b.getBoundingClientRect();
                return r.height >= 38 && r.right <= iw + 1 && r.left >= -1 && r.width > 0;
            });
            const tc = document.querySelector('.tab-content-container');
            out.tcPadBottom = parseInt(getComputedStyle(tc).paddingBottom, 10) || 0;
            return out;
        }, vp.portrait);
        vpResults[vp.name] = r;
    }

    // ===================== Modal'lar (390×844, oyun arayüzü aktifken) =====================
    await page.setViewport({ width: 390, height: 844, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
    await new Promise(r => setTimeout(r, 160));
    await page.evaluate(() => {
        // Oyun arayüzünü garanti aktif tut (önceki döngü stats sekmesinde bıraktı)
        document.getElementById('matchday-screen').classList.remove('active');
        document.getElementById('game-interface').classList.add('active');
    });
    await page.evaluate(VP_PROBE);
    const modals = await page.evaluate(async () => {
        const out = {};
        const iw = window.innerWidth, ih = window.innerHeight;
        const fits = (sel) => {
            const el = document.querySelector(sel);
            if (!el) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.right <= iw + 2 && r.left >= -2;
        };
        // (1) Oyuncu profili
        openPlayerProfile('USER', gameState.player.teamId);
        await new Promise(res => setTimeout(res, 250));
        out.profileFits = fits('#player-profile-modal .pp-modal-content');
        out.profileOverflow = window.__probeOverflow().ok;
        document.getElementById('player-profile-modal').style.display = 'none';

        // (2) Global arama
        openGlobalSearch();
        await new Promise(res => setTimeout(res, 120));
        out.searchFits = fits('#global-search-modal .gsearch-content');
        out.searchOverflow = window.__probeOverflow().ok;
        closeGlobalSearch();

        // (3) Diyalog (gameConfirm)
        const p = gameConfirm({ title: 'Test', message: 'Mobil diyalog sığma testi — yeterince uzun bir metin olsun ki taşma kontrol edilsin.' });
        await new Promise(res => setTimeout(res, 150));
        out.dialogFits = fits('#game-dialog-overlay .game-dialog');
        out.dialogOverflow = window.__probeOverflow().ok;
        const btn = document.querySelector('#game-dialog-overlay .game-dialog-actions .btn-secondary, #game-dialog-overlay .game-dialog-actions .btn');
        if (btn) btn.click();
        try { await p; } catch (e) {}
        return out;
    });

    // ===================== Maç ekranı (390×844 dikey) — EN SON (state'i değiştirir) =====================
    await page.evaluate(VP_PROBE);
    const match = await page.evaluate(async () => {
        const out = {};
        try { startMatchDay(); } catch (e) { out.startErr = e.message; }
        await new Promise(res => setTimeout(res, 500));
        if (window.activeMatch) activeMatch.isPaused = true;   // ticker'ı durdur (layout stabil)
        out.screenActive = document.getElementById('matchday-screen').classList.contains('active');
        out.overflow = window.__probeOverflow();

        const main = document.querySelector('.match-main-column');
        const squad = document.querySelector('.match-lineups-column');
        const toggle = document.querySelector('.md-mobile-toggle');
        const vis = el => el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;

        out.toggleVisible = vis(toggle);
        // Başlangıç: Maç görünür, Kadro gizli
        out.initMatchVisible = vis(main) && !vis(squad);

        // "Kadro" sekmesine geç → kadro görünür, maç gizli
        document.getElementById('md-view-squad').checked = true;
        document.getElementById('md-view-squad').dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(res => setTimeout(res, 80));
        out.squadSwap = vis(squad) && !vis(main);

        // Karar anı tetikle (Kadro'dayken) → hook "Maç" görünümüne döndürmeli + kutu görünür
        try { triggerPlayerDecision(); } catch (e) { out.decErr = e.message; }
        await new Promise(res => setTimeout(res, 120));
        out.backToMatchView = document.getElementById('md-view-match').checked === true;
        const box = document.getElementById('match-decision-box');
        out.decisionVisible = vis(box) && box.getBoundingClientRect().right <= window.innerWidth + 2;
        const optBtns = document.querySelectorAll('#decision-options .btn-decision');
        out.decisionButtons = optBtns.length;
        out.decisionBtnsFit = [...optBtns].every(b => b.getBoundingClientRect().right <= window.innerWidth + 2);
        return out;
    });

    await browser.close();

    // ===================== Değerlendirme =====================
    const c = [];
    for (const vp of VPS) {
        const r = vpResults[vp.name] || {};
        c.push([`[${vp.name}] tüm sekmeler yatay taşmasız`, r.tabsOk === true, (r.offenders || []).join(' ; ')]);
        if (vp.portrait) {
            c.push([`[${vp.name}] alt sekme çubuğu en altta sabit`, r.navPinnedBottom === true, `pos=${r.navPosition}`]);
            c.push([`[${vp.name}] nav butonları dokunulabilir + viewport içinde (${r.navBtnCount})`, r.navBtnsOk === true, '']);
            c.push([`[${vp.name}] içerik alt çubuk arkasında kalmıyor (pad-bottom=${r.tcPadBottom})`, (r.tcPadBottom || 0) >= 50, '']);
        } else {
            c.push([`[${vp.name}] nav üstte kalır (bottom-fixed değil)`, r.navPinnedBottom === false, `pos=${r.navPosition}`]);
        }
    }

    c.push(['Maç ekranı aktifleşti', match.screenActive === true, match.startErr || '']);
    c.push(['Maç ekranı yatay taşmasız', match.overflow && match.overflow.ok === true, match.overflow ? ('offender: ' + match.overflow.offender) : '']);
    c.push(['Maç: mobil "Maç/Kadro" toggle görünür', match.toggleVisible === true, '']);
    c.push(['Maç: başlangıçta Maç görünür / Kadro gizli', match.initMatchVisible === true, '']);
    c.push(['Maç: "Kadro" sekmesi → kadro görünür / maç gizli', match.squadSwap === true, '']);
    c.push(['Maç: karar anı "Kadro"dayken otomatik "Maç" görünümüne döner', match.backToMatchView === true, match.decErr || '']);
    c.push(['Maç: karar kutusu görünür + viewport içinde', match.decisionVisible === true, '']);
    c.push(['Maç: karar butonları (' + match.decisionButtons + ') ekrana sığar', match.decisionBtnsFit === true && match.decisionButtons > 0, '']);

    c.push(['Modal: oyuncu profili viewport\'a sığar', modals.profileFits === true && modals.profileOverflow === true, '']);
    c.push(['Modal: arama viewport\'a sığar', modals.searchFits === true && modals.searchOverflow === true, '']);
    c.push(['Modal: diyalog viewport\'a sığar', modals.dialogFits === true && modals.dialogOverflow === true, '']);

    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== RESPONSIVE / MOBİL DOĞRULAMA ===`);
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${ok ? '' : (info ? '  — ' + info : '')}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
