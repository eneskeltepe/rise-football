// ============================================================================
//  run_all_tests.js — TÜM test_*.js + smoke_test'i tek elden koşar, CANLI ilerleme +
//  özet tablo verir. Gelecekteki her değişiklikte "bir şeyi bozduk mu / absürt durum
//  var mı" kıyası için TEK KOMUT:   node tools/run_all_tests.js
//  - Önce http-server (:3000) AÇIK mı diye bakar; kapalıysa net uyarıp çıkar.
//  - Her testten ÖNCE "▶ çalışıyor" yazar (canlı), sonra sonucu + süreyi yazar →
//    asla "boş boş bekliyor" görünmez. Tüm suite ~2-3 dk (24 tarayıcı testi).
//  Çıkış kodu: hepsi tam geçer + smoke 0 hata → 0, aksi halde 1.
// ============================================================================
const { execSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

function checkServer() {
    return new Promise((resolve) => {
        const req = http.get('http://127.0.0.1:3000/index.html', (res) => { res.resume(); resolve(res.statusCode === 200); });
        req.on('error', () => resolve(false));
        req.setTimeout(3000, () => { req.destroy(); resolve(false); });
    });
}

(async () => {
    const up = await checkServer();
    if (!up) {
        console.log('\n⚠  http-server (:3000) KAPALI. Tarayıcı testleri buna ihtiyaç duyar.');
        console.log('   Çözüm: AYRI bir terminalde  ->  npm run dev   (açık bırak), sonra bu komutu tekrar çalıştır.\n');
        process.exit(2);
    }
    console.log('✓ http-server açık. Testler başlıyor (tüm suite ~2-3 dk sürebilir)…\n');

    const TOOLS = __dirname;
    const tests = fs.readdirSync(TOOLS).filter(f => /^test_.*\.js$/.test(f)).sort();
    const all = tests.concat(['smoke_test.js']);

    let grandPass = 0, grandTotal = 0;
    const rows = [];
    const failed = [];

    for (let i = 0; i < all.length; i++) {
        const t = all[i];
        process.stdout.write(`▶ [${i + 1}/${all.length}] ${t.padEnd(26)} çalışıyor… `);
        let out = '', code = 0;
        const tt = Date.now();
        try { out = execSync(`node "${path.join(TOOLS, t)}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 }); }
        catch (e) { out = (e.stdout || '') + '\n' + (e.stderr || ''); code = (e.status != null ? e.status : 1); }
        const ms = Date.now() - tt;

        const m = out.match(/SONUÇ:\s*(\d+)\s*\/\s*(\d+)/);
        let label, ok;
        if (m) {
            const p = +m[1], q = +m[2];
            grandPass += p; grandTotal += q;
            ok = (p === q && code === 0); label = `${p}/${q}`;
        } else {
            const sm = out.match(/KONSOL HATALARI \((\d+)\)/);
            if (sm) { const n = +sm[1]; ok = (n === 0 && code === 0); label = `konsol hata: ${n}`; }
            else { ok = false; label = 'ÇIKTI YOK / ÇÖKTÜ'; }
        }
        if (!ok) failed.push({ t, out: out.trim().split('\n').slice(-8).join('\n') });
        console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}  (${(ms / 1000).toFixed(1)}s)`);
        rows.push([t, label, ok, ms]);
    }

    console.log('\n================== ÖZET (REGRESYON) ==================');
    console.log(`Toplam doğrulama: ${grandPass}/${grandTotal}  |  Test dosyası: ${rows.length}  |  Başarısız: ${failed.length}`);
    if (failed.length) {
        console.log('\n=== BAŞARISIZ TESTLERİN SON SATIRLARI ===');
        for (const f of failed) { console.log(`\n--- ${f.t} ---\n${f.out}`); }
    } else {
        console.log('TÜM TESTLER GEÇTİ ✓');
    }
    console.log('======================================================');

    // --- İnsan-okunur rapor dosyası (geliştirici olmayan biri de açıp anlayabilsin) ---
    const stamp = new Date().toLocaleString('tr-TR');
    const L = [];
    L.push('# Rise Football — Test Raporu', '');
    L.push(`**Tarih:** ${stamp}`);
    L.push(`**Genel sonuç:** ${failed.length ? '❌ BAŞARISIZ — aşağıdaki testler geçmedi' : '✅ TÜM TESTLER GEÇTİ'}`);
    L.push(`**Toplam doğrulama:** ${grandPass}/${grandTotal} &nbsp;·&nbsp; **Test dosyası:** ${rows.length} &nbsp;·&nbsp; **Başarısız dosya:** ${failed.length}`, '');
    L.push('| Test | Sonuç | Durum | Süre |', '|------|-------|:----:|-----:|');
    for (const [t, label, ok, ms] of rows) {
        L.push(`| \`${t}\` | ${label} | ${ok ? '✅' : '❌ FAIL'} | ${(ms / 1000).toFixed(1)}s |`);
    }
    if (failed.length) {
        L.push('', '## Başarısız testlerin çıktısı (son satırlar)');
        for (const f of failed) { L.push('', `### ${f.t}`, '```', f.out, '```'); }
    } else {
        L.push('', '> Bu sürüm regresyon açısından temiz: önceki davranışları bozan bir değişiklik tespit edilmedi.');
    }
    L.push('');
    const reportPath = path.join(TOOLS, 'SON_TEST_RAPORU.md');
    fs.writeFileSync(reportPath, L.join('\n'), 'utf8');
    console.log(`📄 Okunabilir rapor yazıldı → ${path.relative(process.cwd(), reportPath)}\n`);

    process.exit(failed.length ? 1 : 0);
})();
