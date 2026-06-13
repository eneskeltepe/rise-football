// ============================================================================
//  test_matchcontrols.js — Maç-içi kompakt kontroller (v2.15.0 polish)
//   (1) Maç HIZI butonu (yavaş/normal/hızlı) ayırt edilebilir RENK alır (mqc-sp-*)
//   (2) Efor/PRES butonu AYRI renk ailesi alır (mqc-ef-*) → hızla karışmaz
//       (aynı nominal seviyede hız vs efor rengi FARKLI)
//   (3) Sahada DEĞİLKEN (yedek/çıkış sonrası) pres butonu KİLİTLİ görünür (mqc-locked)
//       ve tıklayınca seviye DEĞİŞMEZ
//   http-server :3000 ayakta iken:  node tools/test_matchcontrols.js
// ============================================================================
const puppeteer = require('puppeteer');

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
    await page.evaluate(() => {
        document.getElementById('player-firstname').value = 'Ctrl';
        document.getElementById('player-lastname').value = 'Test';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 500));
    await page.evaluate(async () => { await window.DB.loadPlayers('tur-super-lig'); });

    const out = await page.evaluate(async () => {
        const res = {};
        const cls = el => el ? el.className : '';
        // Renk doğrulama: HER seviye için TAZE element (headless Chrome aynı element üzerinde
        // ardışık className değişiminde getComputedStyle'ı "stale" döndürebiliyor → izole ölç).
        const colorOf = (variant) => {
            const t = document.createElement('button');
            t.className = 'mqc-btn ' + variant; t.textContent = 'X';
            document.body.appendChild(t);
            const c = getComputedStyle(t).color; t.remove(); return c;
        };
        try { startMatchDay(); } catch (e) { res.startErr = e.message; }
        await new Promise(r => setTimeout(r, 400));
        if (window.activeMatch) activeMatch.isPaused = true;   // ticker dursun

        const spB = document.getElementById('mqc-speed');
        const efB = document.getElementById('mqc-effort');

        // ---- HIZ: tıkla → SINIF döngüsü (yavaş/normal/hızlı) ----
        setMatchSpeed('normal'); syncQuickControls();
        res.spHasNormal = /mqc-sp-normal/.test(cls(spB));
        spB.click(); await new Promise(r => setTimeout(r, 40));   // normal→fast
        res.spHasFast = /mqc-sp-fast/.test(cls(spB));
        spB.click(); await new Promise(r => setTimeout(r, 40));   // fast→slow
        res.spHasSlow = /mqc-sp-slow/.test(cls(spB));

        // ---- RENKLER: izole taze elementlerle (üç hız + üç efor) ----
        const cSpSlow = colorOf('mqc-sp-slow'), cSpNorm = colorOf('mqc-sp-normal'), cSpFast = colorOf('mqc-sp-fast');
        const cEfLow = colorOf('mqc-ef-low'), cEfNorm = colorOf('mqc-ef-normal'), cEfHigh = colorOf('mqc-ef-high');
        res.spColorsDiffer = (cSpSlow !== cSpNorm) && (cSpNorm !== cSpFast) && (cSpSlow !== cSpFast);
        res.efColorsDiffer = (cEfLow !== cEfNorm) && (cEfNorm !== cEfHigh) && (cEfLow !== cEfHigh);
        // Hız ailesi ile efor ailesi HİÇBİR seviyede çakışmamalı (karışmaz)
        const spSet = [cSpSlow, cSpNorm, cSpFast], efSet = [cEfLow, cEfNorm, cEfHigh];
        res.speedVsEffortDiffer = spSet.every(s => !efSet.includes(s));

        // ---- EFOR sahadayken: renk sınıfı + tıkla değiştir ----
        window._setEffortEnabled(true);
        activeMatch.effortLevel = 'normal'; syncQuickControls();
        res.efHasColorClass = /mqc-ef-normal/.test(cls(efB));
        res.efNotLockedWhenOn = !/mqc-locked/.test(cls(efB));
        const before = activeMatch.effortLevel;
        efB.click();
        await new Promise(r => setTimeout(r, 40));
        res.effortCyclesWhenOn = activeMatch.effortLevel !== before;
        res.efColorClassAfter = /mqc-ef-(low|normal|high)/.test(cls(efB));

        // ---- EFOR sahada DEĞİLKEN: kilitli + tıklayınca DEĞİŞMEZ ----
        window._setEffortEnabled(false);
        await new Promise(r => setTimeout(r, 40));
        res.efLockedClass = /mqc-locked/.test(cls(efB));
        res.efLockIcon = !!efB.querySelector('.fa-lock');
        const lockedBefore = activeMatch.effortLevel;
        efB.click();   // kilitliyken tıkla
        await new Promise(r => setTimeout(r, 40));
        res.effortBlockedWhenLocked = activeMatch.effortLevel === lockedBefore;
        // tekrar aç → kilit kalkar
        window._setEffortEnabled(true);
        await new Promise(r => setTimeout(r, 40));
        res.efUnlocks = !/mqc-locked/.test(cls(efB));

        res._dbg = { cSpSlow, cSpNorm, cSpFast, cEfLow, cEfNorm, cEfHigh };
        return res;
    });

    await browser.close();

    const c = [];
    c.push(['Hız: normal → mqc-sp-normal sınıfı', out.spHasNormal === true, '']);
    c.push(['Hız: hızlı → mqc-sp-fast sınıfı', out.spHasFast === true, '']);
    c.push(['Hız: yavaş → mqc-sp-slow sınıfı', out.spHasSlow === true, '']);
    c.push(['Hız: üç seviye RENGİ birbirinden farklı', out.spColorsDiffer === true, JSON.stringify(out._dbg)]);
    c.push(['Efor: üç seviye RENGİ birbirinden farklı', out.efColorsDiffer === true, JSON.stringify(out._dbg)]);
    c.push(['Efor: sahadayken renk sınıfı (mqc-ef-*)', out.efHasColorClass === true, '']);
    c.push(['Efor: sahadayken kilitli DEĞİL', out.efNotLockedWhenOn === true, '']);
    c.push(['Hız ile efor renk aileleri HİÇ çakışmaz — karışmaz', out.speedVsEffortDiffer === true, JSON.stringify(out._dbg)]);
    c.push(['Efor: sahadayken tıkla → seviye değişir', out.effortCyclesWhenOn === true, '']);
    c.push(['Efor: değişimden sonra renk sınıfı korunur', out.efColorClassAfter === true, '']);
    c.push(['Pres: sahada DEĞİLKEN kilitli (mqc-locked)', out.efLockedClass === true, '']);
    c.push(['Pres: kilitliyken kilit ikonu', out.efLockIcon === true, '']);
    c.push(['Pres: kilitliyken tıkla → seviye DEĞİŞMEZ', out.effortBlockedWhenLocked === true, '']);
    c.push(['Pres: tekrar sahaya → kilit kalkar', out.efUnlocks === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== MAÇ-İÇİ KONTROLLER (HIZ/PRES RENK + KİLİT) ===`);
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${ok ? '' : (info ? '  — ' + info : '')}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
