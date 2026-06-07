# ⚽ Rise Football — Futbol Kariyeri Simülasyonu

Tek oyunculu, tarayıcı tabanlı **Türkçe** futbol kariyer simülasyonu. Kendi
futbolcunu yarat, gerçek dünya verisiyle dolu bir futbol evreninde antrenman yap,
gelişip yıldızlaş, dünya çapındaki kulüplere transfer ol, kıtasal kupalar kazan ve
emekliliğe kadar uzanan bir kariyer yaşa.

> Veritabanı **EA Sports FC 26** reyting setinden (Kaggle) türetilmiştir:
> **45 lig/kupa · 644 takım · 16.228 gerçek oyuncu** (gerçek isim, foto, stat),
> ayrıca gerçek **stadyumlar** (Football Stadiums.csv ile eşleştirilmiş).

---

## 🚀 Nasıl Çalıştırılır?

Gereksinim: **Node.js** (npm ile birlikte). Başka bir şey gerekmez — derleme/bundler yok.

```bash
npm install      # tek bağımlılık: http-server (geliştirme sunucusu)
npm run dev      # http://localhost:3000 adresinde yayınlar
```

Ardından tarayıcıda **http://localhost:3000** adresini aç. Karakter oluşturma
ekranı gelir; bir lig + takım seç, mevkiini belirle ve kariyerine başla.

- Kayıtlar tarayıcının **localStorage**'ında tutulur (anahtar: `football_career_save_v2`).
- Sıfırlamak için: oyundaki **"Sıfırla"** butonu **veya** DevTools → Application →
  Local Storage temizliği.

---

## 🗂️ Proje Yapısı (Modüler)

Derleme adımı yok; dosyalar `index.html` içinde **sıralı `<script>`** ile yüklenir.
Her modül belirli bir sorumluluğa sahiptir ve global kapsamı paylaşır.

```
index.html              # Tüm ekran/markup (içerik JS ile dinamik dolar)
style.css               # Glassmorphism koyu tema

data/                   # OTOMATİK ÜRETİLEN veritabanı (tools/build_database.py)
  ├─ leagues.js         # window.DB_LEAGUES — 45 lig/kupa metadata
  ├─ teams.js           # window.DB_TEAMS   — 644 takım (güç/atak/def/prestij/stadyum/tesis)
  ├─ nations.js         # window.DB_NATIONS — milliyet → bayrak
  ├─ ovr_coef.js        # window.DB_OVR_COEF — OVR formül katsayıları
  └─ players/<ligId>.json   # lig başına oyuncu detayları (talep üzerine fetch)

src/                    # Oyun mantığı (modüller — index.html sırasıyla yükler)
  ├─ 00-config.js       # Pozisyonlar (12), statlar (6 ana + 29 alt), sabitler, değer/maaş
  ├─ 05-core.js         # Çekirdek: gameState + temel yardımcılar (logo/para/tarih/toast/boy-kilo) + dropdown altyapısı
  ├─ 06-dialog.js       # Modern onay/uyarı modalı (gameConfirm/gameAlert — alert/confirm yerine)
  ├─ 10-db.js           # Veri erişim katmanı (indeksler + lazy oyuncu yükleme + kadro dolgu)
  ├─ 12-store.js        # IndexedDB kayıt aynası (dayanıklılık) + .json dışa/içe aktarma
  ├─ 15-calendar.js     # Gün-bazlı takvim: gerçek tarih, "İlerle" sonraki maça kadar, kupa/lig çakışma çözümü
  ├─ 20-player.js       # Oyuncu modeli: alt-stat→ana stat, calculateOVR, değer
  ├─ 25-career.js       # Yaş eğrisi, altyapı, sakatlık, kariyer rastgeleliği
  ├─ 30-league.js       # Lig sistemi: fikstür, puan durumu, TÜM DÜNYA haftalık sim (deterministik skor)
  ├─ 35-promotion.js    # Küme düşme/çıkme (yalnız çok kademeli ülkeler)
  ├─ 40-match.js        # Diziliş + hoca AI (rotasyon, mevki esnekliği, akıllı değişiklik) + yedek kulübesi
  ├─ 42-matchux.js      # Maç UX: olay akışı, gol animasyonu, maç-içi istatistik, maç hızı
  ├─ 45-matchengine.js  # Maç motoru: gün simülasyonu, canlı ticker, karar anları, gol/olay, instant-sim, saha dizilişi
  ├─ 50-transfer.js     # Dünya çapı transfer/teklif/pazarlık (bonservis + kiralama + pencere)
  ├─ 52-market.js       # Transfer ekonomisi: kulüp bütçeleri, transfer haberleri, serbest oyuncu havuzu
  ├─ 54-negotiation.js  # Sözleşme + transfer pazarlık modalları (slider'lı karşı teklif, kabul olasılığı)
  ├─ 55-stats.js        # Lig krallıkları (gol/asist/MotM/sarı-kırmızı kart/clean sheet), yıl sonu ödülleri, profil
  ├─ 56-devtrack.js     # Gelişim takibi: antrenman/yaş eğrisi snapshot + filtrelenebilir grafik
  ├─ 58-history.js      # Maç detay modalı (tüm takımlar) + maç/transfer geçmişi kaydı
  ├─ 60-ui.js           # Ana UI render: updateUI, puan durumu, kulüp kartı, fikstür+navigasyon, transfer sekmesi/modalı
  ├─ 70-save.js         # Çok slotlu kayıt/yükleme (v2) + v1→v2 + alan migrasyonları
  ├─ 80-cups.js         # Sezon sonu kıtasal kupa simülasyonu
  ├─ 85-euro.js         # OYNANABİLİR Avrupa/kıta kupası kampanyası (lig fazı + knockout)
  ├─ 90-main.js         # Entegrasyon: updateUI/startMatchDay sarmalama, dünya sim, advanceWeek, sezon sonu, antrenman
  ├─ 92-creation.js     # Karakter oluşturma: stat önizleme, form submit, saha-üstü mevki seçici, lig/takım dropdown'ları
  ├─ 94-bindings.js     # DOM olay bağlama + oyun akışı (hafta/sezon-sonu/emeklilik/reset/nav sekmeleri) + boot girişi
  └─ 95-menu.js         # Açılış menüsü, kariyer slotları, avatar seçici, boot yönlendirme

tools/                  # Geliştirici araçları (oyun için gerekmez)
  ├─ build_database.py  # CSV → data/*  üretici (yeniden çalıştırılabilir, lisanssız ad eşleme dahil)
  ├─ ovr_coefficients.json
  └─ smoke_test.js      # Puppeteer uçtan uca test (15 senaryo)
```

---

## 🎮 Özellikler

### Temel
- **Gerçek dünya veritabanı:** 16.228 oyuncu gerçek isim, fotoğraf, milliyet ve
  EA statlarıyla; 644 takım gerçek kadro/güç/stadyum/tesisle. Lisanssız EA kulüpleri
  (Lombardia FC→Inter, Milano FC→AC Milan, Latium→Lazio, Bergamo Calcio→Atalanta)
  gerçek adlarına eşlenir.
- **12 mevki:** Kaleci, Stoper, Sağ/Sol Bek, DOS, Merkez OS, Ofansif OS,
  Sağ/Sol Açık, Sağ/Sol Kanat, Santrfor.
- **Detaylı statlar:** 6 ana stat (Hız/Şut/Pas/Teknik/Defans/Fizik) + her birinin
  altında ~29 EA alt-özelliği. Antrenman alt-özellikleri hedefler, OVR onlardan
  hesaplanır (EA formülüne kalibre; ortalama hata **0.28**).
- **Tüm dünya simülasyonu:** Her hafta 45 ligin tamamı oynanır, her lig için ayrı
  puan durumu. Kulübünün ligi "aktif lig" olur; yurt dışına transferde otomatik değişir.

### Açılış & kariyer yönetimi
- **Açılış menüsü:** En fazla **10 kariyer slotu** (tarayıcıda saklanır), kaydet/sil/devam et.
- **Dışa/içe aktarma:** Kariyerini `.json` olarak indir, başka tarayıcı/bilgisayarda geri yükle.
  Kayıtlar ayrıca **IndexedDB**'ye yedeklenir (localStorage temizlense bile kurtarılır).
- **Profil resmi/avatar:** Gerçekçi yüz portreleri **galeri**si ya da **kendi resmini yükle**.
- **Kulüpsüz başlama:** İstersen serbest oyuncu olarak başla, gelen tekliflerle yolunu çiz.
- **Saha üstünde mevki seçimi:** Oluşturma ekranında futbol sahasındaki noktalara tıklayarak mevki seç.
- **Modern arayüz:** Tüm `alert`/`confirm` kutuları yerine şık modallar; dropdown açılma bug'ı giderildi.

### Takvim & oyun akışı
- **Gün bazlı takvim:** Her maçın gerçek bir tarihi var; **"İlerle"** bir sonraki maça/olaya
  kadar gün gün gider, istediğin günde durabilirsin (FM/FIFA tarzı). Tarih yıllarla ilerler.
- **Kupa/lig çakışması çözüldü:** Aynı haftadaki kupa (hafta ortası) ve lig (hafta sonu) maçları
  ayrı günlere düşer; birini oynamak diğerini bozmaz.
- **Haftalık takvim şeridi:** Panelde günler + maç işaretleri (rakip logosu, kupa rozeti).

### Maç motoru & hoca yapay zekası
- **Akıllı kadro seçimi:** Hoca seni gücüne göre rotasyona sokar — bazen ilk 11, bazen 60+ dakikada
  oyuna girersin, bazen yedek kalırsın (68'lik oyuncu 87'lik yıldızı sürekli kesmez).
- **Mevki esnekliği:** Santrfor olsan da özelliklerine göre kanat/OOS gibi yakın mevkilerde oynayabilirsin.
- **Yedekten maçı izleme:** Yedek başladıysan maçı baştan izlersin; hoca seni gerçek dakikada oyuna alır.
- **Maç olay akışı:** Gol/asist/sarı-kırmızı kart/sakatlık/penaltı/değişiklikler ayrı bir akış panelinde;
  gol ve önemli olaylarda **animasyon**. Maç-içi **detaylı istatistik** (şut, isabet, korner, faul...).
- **Maç hızı** ayarı (yavaş/normal/hızlı). Dizilişte oyuncuya tıkla → profili açılır.
- **Maç sonu serbest:** Özeti kapatıp canlı anlatım/olaylar/istatistikleri inceleyebilirsin.

### Kupalar & yedekler
- **Oynanabilir kupa maçları:** Avrupa/kıta kupası kampanyası (Şampiyonlar/Avrupa/Konferans
  Ligi, AFC, Libertadores/Sudamericana) — lig fazı + knockout, maçları **kendin oynarsın**.
- **Yedek kulübesi & oyuncu değişikliği:** Her takım 7 yedek + 5 değişiklik hakkı; hoca
  skor/kondisyon/performansa göre **mantıklı 2-4 değişiklik** yapar; çıkan/giren net görünür;
  **canlı kondisyon** tüm oyuncularda görünür.
- **Gelişim takibi ekranı:** Antrenman ve yaş eğrisi geçmişi; her ana statın zaman içindeki
  değişimini grafik + olay listesiyle **filtreleyerek** (sezon/kariyer) izlersin.
- **Gelişim sistemi:** Gizli potansiyel & zirve yaşı (her kariyerde farklı); gençler hızlı
  gelişir, yaşlanınca düşer; antrenman tesisi gelişimi etkiler.
- **Altyapı, sakatlık, kart cezaları:** Sezon başı altyapı gençleri; orantılı sakatlık;
  **sarı kart birikimi** (4 sarı → ceza) ve kırmızı kart cezası.

### Transfer ekonomisi
- **Transfer pencereleri:** Yaz & kış; sözleşmeli oyuncu transferi yalnız pencerede olur
  (serbest oyuncular her zaman imzalayabilir).
- **Bonservis & kiralama:** Teklifler gerçek bonservis bedeli taşır; kulüp **bütçesi**
  bonservisi karşılamalı; **kiralık** (loan) teklifleri sezon sonu ana kulübe dönüşle.
- **Dünya transfer piyasası:** Diğer kulüpler de transfer yapar — dünya transfer haberleri,
  kulüp al-sat verileri, oyunun ürettiği **serbest oyuncu havuzu** (FM tarzı).
- **Yetersiz kadro dolgu:** Eksik kadrolu kulüplere seviyeye uygun oyuncular eklenir.

### İstatistik, geçmiş & ödüller
- **Lig krallıkları:** Gol, asist, maçın adamı (reyting-bazlı — kaleci/stoper de alabilir), **sarı VE
  kırmızı kart**, gol yenmeyen maç — **kendi ligin dahil tüm ligler** için.
- **Tıklanabilir maç detayları:** Fikstürde tüm takımların skorları görünür; bir maça tıkla → skor +
  golcüler + kartlar (deterministik üretim, puan durumuyla **birebir tutarlı**, sıfır depolama).
- **Maç & transfer geçmişi:** Oynadığın maçlar ve transfer/kiralama hareketlerin kaydedilir; oyuncu
  profilinde transfer geçmişi görünür.
- **FM-tarzı oyuncu profilleri:** maaş, değer, kariyer geçmişi, statlar.
- **Yıl sonu ödülleri** + **FUT-tarzı kart** + küme düşme/çıkme + emeklilik.

---

## 🔧 Veritabanını Yeniden Üretme

`Footballers.csv` ve `Football Stadiums.csv` (Kaggle) kök dizinde olmalı.

```bash
pip install pandas pycountry        # build script bağımlılıkları
python tools/build_database.py      # data/ altını yeniden üretir
```

Çıktı raporu lig/takım/oyuncu sayılarını ve OVR formül hata payını (< 2.0 hedef)
gösterir.

---

## 🧪 Her Şey Doğru Çalışıyor mu? (Tek Komutla Test)

Oyunu indiren herkes (geliştirici olmasa da) tek bir komutla **tüm otomatik testleri**
çalıştırıp düzgün çalışıp çalışmadığını görebilir. Testler gerçek bir tarayıcıyı
(Puppeteer + Chromium) otomatik açar, oyunu baştan sona oynar ve sonucu raporlar.

**1. Hazırlık (ilk sefer):**
```bash
npm install                          # bağımlılıklar (http-server + puppeteer)
npx puppeteer browsers install chrome
```

**2. Sunucuyu başlat (AYRI bir terminalde, açık bırak):**
```bash
npm run dev                          # http://localhost:3000
```

**3. Tüm testleri çalıştır (asıl komut):**
```bash
node tools/run_all_tests.js
```

Bu komut:
- ~28 test dosyasını + uçtan uca duman testini **sırayla** koşar (toplam **~2-3 dakika**).
- Ekranda **canlı ilerleme** yazar (her test için `▶ çalışıyor… ✓/✗ X/Y (Ns)`) — asla
  "boş boş bekliyor" görünmez; donmuş değildir, sadece her tarayıcı testi birkaç saniye sürer.
- Sonunda bir **özet tablo** + okunabilir bir rapor dosyası üretir:
  **`tools/SON_TEST_RAPORU.md`** (Markdown — herhangi biri açıp anlayabilir).
- Hepsi geçerse çıkış kodu **0**, bir şey bozulursa **1** döner (CI'a uygun).

> **İpucu:** Komut "asılı kaldı" gibi görünürse panik yok — suite ~3 dk sürer ve testler
> bitene kadar çoğu sessizdir. Komut satırı zaman aşımını ≥10 dk yap.

### Tek bir test / teşhis
```bash
node tools/smoke_test.js             # yalnız uçtan uca duman testi (15 senaryo)
node tools/check_puppeteer.js        # Puppeteer/Chromium + sunucu sağlık teşhisi (adım adım)
```

`run_all_tests.js` çıktısı, oyunda bir geliştirme yapıldıktan sonra **"bir şeyi bozduk mu?"**
sorusunun cevabıdır: doğrulama sayısı düşerse veya yeni bir FAIL çıkarsa son değişikliğe bakılır.

---

Keyifli kariyerler! 🏆
