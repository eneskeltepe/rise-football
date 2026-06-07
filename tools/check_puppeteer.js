// ============================================================================
//  check_puppeteer.js — HIZLI TANI: Puppeteer/Chromium çalışıyor mu? Sunucu açık mı?
//  Her adımı zaman damgasıyla yazar → "boş boş bekliyor mu, nerede takıldı" belli olur.
//  Kullanım:  node tools/check_puppeteer.js
// ============================================================================
const t0 = Date.now();
const log = (m) => console.log(((Date.now() - t0) / 1000).toFixed(1) + 's | ' + m);

log('Başla — node ' + process.version);
let pup;
try { pup = require('puppeteer'); } catch (e) { log('HATA: puppeteer require edilemedi → ' + e.message + '\n   Çözüm: npm install'); process.exit(3); }
log('puppeteer yüklendi (sürüm ' + (pup.version || require('puppeteer/package.json').version) + ')');

(async () => {
    log('Tarayıcı başlatılıyor (launch)…');
    let b;
    try { b = await pup.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] }); }
    catch (e) { log('HATA: launch başarısız → ' + e.message + '\n   (Chromium eksikse: npx puppeteer browsers install chrome)'); process.exit(4); }
    log('✓ Tarayıcı açıldı');
    const p = await b.newPage();
    log('✓ Sayfa oluşturuldu — http-server kontrol ediliyor…');
    const res = await p.goto('http://127.0.0.1:3000/index.html', { waitUntil: 'domcontentloaded', timeout: 12000 })
        .then(x => 'durum ' + (x && x.status())).catch(e => 'BAĞLANAMADI → ' + e.message);
    if (res.indexOf('durum 200') >= 0) log('✓ http-server AÇIK (' + res + ')');
    else log('✗ http-server KAPALI veya ulaşılamıyor (' + res + ')\n   Çözüm: ayrı terminalde "npm run dev" çalıştır, sonra tekrar dene.');
    await b.close();
    log('BİTTİ — her şey çalışıyor.' + (res.indexOf('durum 200') < 0 ? ' (yalnız sunucuyu başlatman gerek)' : ''));
    process.exit(0);
})().catch(e => { log('BEKLENMEDİK HATA: ' + (e && e.message)); process.exit(5); });
