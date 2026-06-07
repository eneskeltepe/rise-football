// FAZ B: "Lig & Fikstür" hub'ı — Tarihçe + Kupalar sekmeleri kaldırıldı, fonksiyon hub'a taşındı.
//  Sezon seçici + lig/kupa seçici; fikstür SEÇİLİ ligi takip eder (herkesin fikstürü); kupa branch'i.
//   http-server :3000 ayakta iken: node tools/test_hub.js
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
        document.getElementById('player-lastname').value = 'Hub';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 400));

    const out = await page.evaluate(async () => {
        const r = {};
        // (1) Nav: Kupalar + Tarihçe butonları KALKTI
        r.cupsNavGone = !document.querySelector('.nav-btn[data-target="cups-tab"]');
        r.histNavGone = !document.querySelector('.nav-btn[data-target="history-tab"]');
        r.standingsNav = !!document.querySelector('.nav-btn[data-target="standings-tab"]');

        // Lig & Fikstür sekmesini aç
        document.querySelector('.nav-btn[data-target="standings-tab"]').click();
        await new Promise(res => setTimeout(res, 100));
        if (typeof ensureEuroForCurrentTeam === 'function') ensureEuroForCurrentTeam();
        updateStandingsTable(); renderFixturesForWeek(1);
        await new Promise(res => setTimeout(res, 100));

        // (2) Sezon seçici (custom dropdown) + lig seçici + KITA grup başlıkları + kupa seçeneği
        const sp = document.getElementById('standings-season-picker');
        r.seasonPicker = !!(sp && sp.classList.contains('custom-dropdown'));
        r.seasonOpts = sp ? sp.querySelectorAll('.dropdown-option').length : 0;
        r.leaguePicker = !!document.getElementById('standings-league-picker');
        r.groupHeaders = document.querySelectorAll('#standings-league-picker .dropdown-group-header').length;
        const lddTxt = document.getElementById('standings-league-picker').textContent;
        r.hasContinents = /AVRUPA/.test(lddTxt) && /(ASYA|AMERİKA)/.test(lddTxt);
        r.lddOptionCount = document.querySelectorAll('#standings-league-picker .dropdown-option').length;

        // (3) Fikstür SEÇİLİ ligi takip eder: EPL seç → puan durumu + fikstür EPL takımları
        gameState.viewStandingsLeague = 'eng-premier-league';
        updateStandingsTable(); renderFixturesForWeek(2);
        await new Promise(res => setTimeout(res, 100));
        const stxt = document.getElementById('standings-body').textContent;
        r.eplStandings = /Liverpool|Arsenal|Manchester|Chelsea/.test(stxt);
        const fxItems = document.querySelectorAll('#fixtures-list .fixture-item').length;
        r.eplFixtures = fxItems > 0;
        const fxtxt = document.getElementById('fixtures-list').textContent;
        r.fixturesFollowLeague = /Liverpool|Arsenal|Manchester|Chelsea|Everton|Tottenham|Newcastle/.test(fxtxt);

        // (4) Geçmiş sezon seçilince çökmeden WorldDB yoluna girer (veri yoksa "kayıt yok")
        gameState.viewStandingsSeason = gameState.currentSeason - 1;
        let pastOk = true; try { updateStandingsTable(); renderFixturesForWeek(1); } catch (e) { pastOk = false; }
        r.pastNoCrash = pastOk;
        gameState.viewStandingsSeason = gameState.currentSeason;

        // (5) KUPA branch: kullanıcının turnuvası ('__cup__'+compId) seç → tablo gizlenir, kampanya görünür
        r.hasEuro = !!(gameState.euro && gameState.euro.compName);
        gameState.viewStandingsLeague = '__cup__' + (gameState.euro ? gameState.euro.compId : 'ucl');
        updateStandingsTable();
        await new Promise(res => setTimeout(res, 80));
        const layout = document.querySelector('#standings-tab .standings-layout');
        const euroCard = document.getElementById('euro-campaign-card');
        r.cupHidesLayout = layout && layout.style.display === 'none';
        r.cupShowsCard = r.hasEuro ? (euroCard && euroCard.style.display === 'block') : true;
        r.euroCardInStandings = !!document.querySelector('#standings-tab #euro-campaign-card');

        // (6) Geri lige dön → tablo görünür, kupa kartı gizli
        gameState.viewStandingsLeague = 'tur-super-lig';
        updateStandingsTable(); renderFixturesForWeek(1);
        await new Promise(res => setTimeout(res, 80));
        r.backToLeague = layout && layout.style.display !== 'none' && euroCard && euroCard.style.display === 'none';
        return r;
    });

    await browser.close();

    const c = [];
    c.push(['Nav: "Kupalar" sekmesi kaldırıldı', out.cupsNavGone === true, '']);
    c.push(['Nav: "Tarihçe" sekmesi kaldırıldı', out.histNavGone === true, '']);
    c.push(['Nav: "Lig & Fikstür" duruyor', out.standingsNav === true, '']);
    c.push(['Sezon seçici var (+opsiyon)', out.seasonPicker === true && out.seasonOpts >= 1, `opts=${out.seasonOpts}`]);
    c.push(['Lig/kupa seçici var', out.leaguePicker === true, '']);
    c.push(['Dropdown KITA grup başlıkları (≥3)', out.groupHeaders >= 3, `=${out.groupHeaders}`]);
    c.push(['Avrupa + (Asya/Amerika) kıtaları listeleniyor', out.hasContinents === true, '']);
    c.push(['Tüm ligler + turnuvalar listede (≥45)', out.lddOptionCount >= 45, `=${out.lddOptionCount}`]);
    c.push(['Puan durumu seçili ligi takip eder (EPL)', out.eplStandings === true, '']);
    c.push(['Fikstür render edildi', out.eplFixtures === true, '']);
    c.push(['Fikstür SEÇİLİ ligin takımlarını gösterir', out.fixturesFollowLeague === true, '']);
    c.push(['Geçmiş sezon seçimi çökmüyor', out.pastNoCrash === true, '']);
    c.push(['Euro kartı standings-tab içinde', out.euroCardInStandings === true, '']);
    c.push(['Kupa seçilince lig tablosu gizlenir', out.cupHidesLayout === true, '']);
    c.push(['Kupa seçilince kupa kartı görünür', out.cupShowsCard === true, `euro=${out.hasEuro}`]);
    c.push(['Lige dönünce tablo görünür + kupa gizli', out.backToLeague === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== FAZ B — LİG & FİKSTÜR HUB (tarihçe+kupalar birleşti) ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
