// Faz C doğrulama — FM rol/mevki yetkinliği: rol uygunluğu, familiarity, efektif OVR (Puppeteer).
//   http-server :3000 ayakta iken: node tools/test_roles.js
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
    await new Promise(r => setTimeout(r, 500));

    const out = await page.evaluate(() => {
        const r = {};
        const A = (over) => Object.assign({ bitiricilik: 50, pozisyonAlma: 50, reaksiyon: 50, kafaVurusu: 50, guc: 50, topKontrol: 50, vizyon: 50, kisaPas: 50, uzunPas: 50, ayaktaMudahale: 50, topKapma: 50, sprintHizi: 50, dayaniklilik: 50, ortaPas: 50, topSurme: 50, uzaktanSut: 50, sogukkanlilik: 50, hizlanma: 50, gkRefleks: 50, gkUcus: 50, gkTopTutma: 50, gkYerTutma: 50 }, over || {});

        // 1) Katalog tüm aileleri kapsıyor
        r.fams = Object.keys(ROLE_CATALOG).sort().join(',');
        r.stRoles = rolesForFamily('ST').length;

        // 2) Rol uygunluğu: fırsatçı golcü = bitiricilik+pozisyonAlma+reaksiyon ağırlıklı
        const poacher = { pos: 'Santrfor', attrs: A({ bitiricilik: 92, pozisyonAlma: 90, reaksiyon: 88 }) };
        const target = { pos: 'Santrfor', attrs: A({ bitiricilik: 40, pozisyonAlma: 45, reaksiyon: 42, guc: 90, kafaVurusu: 88 }) };
        r.poacherFirsatci = roleSuitability(poacher, 'st_firsatci');   // yüksek olmalı
        r.targetFirsatci = roleSuitability(target, 'st_firsatci');     // düşük
        r.targetPivot = roleSuitability(target, 'st_pivot');           // güç/kafa → yüksek
        r.suitOrder = r.poacherFirsatci > r.targetFirsatci && r.targetPivot > r.targetFirsatci;
        const best = bestRoleForPlayer(target);
        r.bestIsPivot = best && best.roleKey === 'st_pivot';

        // 3) Mevki yetkinliği
        const pl = { pos: 'Santrfor', altPos: ['Sağ Kanat'] };
        r.fNat = positionFamiliarity(pl, 'Santrfor').key;     // NAT
        r.fAcc = positionFamiliarity(pl, 'Sağ Kanat').key;    // ACC
        r.fComp = positionFamiliarity({ pos: 'Sağ Kanat' }, 'Sol Kanat').key;  // aynı aile (W) → COMP
        r.fAwk = positionFamiliarity(pl, 'Kaleci').key;       // ZAYIF

        // 4) familiarity çarpanı monoton
        r.facMono = familiarityFactorFromAffinity(1) === 1.0 &&
            familiarityFactorFromAffinity(1) > familiarityFactorFromAffinity(0.85) &&
            familiarityFactorFromAffinity(0.85) > familiarityFactorFromAffinity(0.5) &&
            familiarityFactorFromAffinity(0.5) > familiarityFactorFromAffinity(0.1);

        // 5) _buildXI: doğal yerleşim → efektif OVR = ham; mevki-dışı → düşük
        function mk(id, pos, ovr) { return { id, name: 'P' + id, pos, ovr, attrs: A({}), age: 25 }; }
        // dengeli kadro (her mevkiden) → herkes doğal slotta
        const balanced = [
            mk(1, 'Kaleci', 80), mk(2, 'Kaleci', 70),
            mk(3, 'Stoper', 80), mk(4, 'Stoper', 79), mk(5, 'Sağ Bek', 78), mk(6, 'Sol Bek', 78),
            mk(7, 'DOS', 80), mk(8, 'Merkez OS', 80), mk(9, 'Ofansif OS', 81),
            mk(10, 'Sağ Kanat', 82), mk(11, 'Sol Kanat', 82), mk(12, 'Santrfor', 85),
            mk(13, 'Stoper', 72), mk(14, 'Merkez OS', 72),
        ];
        const bx = _buildXI(balanced, 0, 70, null);
        const st = bx.xi.find(p => p.position === 'Santrfor');
        r.naturalEffEqBase = !!(st && st.famFactor >= 1.0 && st.ovr === st.baseOvr);
        r.xiHasRole = !!(st && st.roleKey && st.roleLabel);
        r.xiHasFamLabel = !!(st && st.famLabel);

        // mevki-dışı: sadece santrfor + 2 kaleci → defans/orta saha slotlarına ST konur → famFactor<1
        const stHeavy = [mk(1, 'Kaleci', 80), mk(2, 'Kaleci', 70)];
        for (let i = 3; i <= 14; i++) stHeavy.push(mk(i, 'Santrfor', 80));
        const bx2 = _buildXI(stHeavy, 0, 70, null);
        const cb = bx2.xi.find(p => p.position === 'Stoper');
        r.oopPenalty = !!(cb && cb.famFactor < 1.0 && cb.ovr < cb.baseOvr);
        r.oopSample = cb ? { fam: cb.famFactor, ovr: cb.ovr, base: cb.baseOvr, lbl: cb.famLabel } : null;
        return r;
    });

    await browser.close();

    const c = [];
    c.push(['Katalog 9 aileyi kapsıyor', out.fams === 'AM,CB,CM,DM,FB,GK,ST,W,WM', out.fams]);
    c.push(['ST rolleri var (>=4)', out.stRoles >= 4, `${out.stRoles}`]);
    c.push(['Rol uygunluğu mantıklı (fırsatçı vs pivot)', out.suitOrder === true, `poacher=${out.poacherFirsatci} targetFirsatci=${out.targetFirsatci} targetPivot=${out.targetPivot}`]);
    c.push(['bestRoleForPlayer doğru (güçlü ST → pivot)', out.bestIsPivot === true, '']);
    c.push(['Yetkinlik: Doğal', out.fNat === 'NAT', out.fNat]);
    c.push(['Yetkinlik: altPos → Çok İyi', out.fAcc === 'ACC', out.fAcc]);
    c.push(['Yetkinlik: aynı aile → Yeterli', out.fComp === 'COMP', out.fComp]);
    c.push(['Yetkinlik: alakasız → Zayıf', out.fAwk === 'AWK', out.fAwk]);
    c.push(['familiarity çarpanı monoton', out.facMono === true, '']);
    c.push(['Doğal yerleşim: efektif OVR = ham (denge korunur)', out.naturalEffEqBase === true, '']);
    c.push(['XI oyuncusunda rol + yetkinlik etiketi var', out.xiHasRole && out.xiHasFamLabel, '']);
    c.push(['Mevki-dışı oyuncu efektif OVR DÜŞER', out.oopPenalty === true, JSON.stringify(out.oopSample)]);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== FAZ C — FM rol/mevki yetkinliği ===`);
    console.log(JSON.stringify(out).slice(0, 600) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
