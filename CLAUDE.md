# CLAUDE.md

Bu dosya, bu depoda çalışırken Claude Code'a (claude.ai/code) rehberlik eder.

## Proje

"Rise Football — Futbol Kariyeri Simülasyonu" (eski ad: "Süper Lig: Futbol Kariyeri
Simülasyonu") — tek oyunculu, tarayıcı tabanlı, **Türkçe**
bir futbol kariyer simülasyonu. Oyuncu yarat, antrenmanla geliştir, hafta hafta
sezonu oyna/simüle et, dünya çapında transfer ol, kıtasal kupalar kazan ve emekliliğe
kadar çok sezonluk kariyer ilerlet.

Uygulama, UI metinleri, kod yorumları ve birçok kod-içi değer (mevki adları, stat
anahtarları) **Türkçe**'dir. Kullanıcıya görünen tüm metni Türkçe tut; kod eklerken
mevcut Türkçe adlandırmayı izle.

## Çalıştırma

```bash
npm install      # tek bağımlılık: http-server (dev)
npm run dev      # http://localhost:3000
```

**Derleme/bundler/transpiler yok, lint yok.** Dosyaları düzenle + tarayıcıyı yenile.
Durum tarayıcının `localStorage`'ında (`football_career_save_v2`). Test ederken
"Sıfırla" butonu veya DevTools → Application → Local Storage ile temizle.

**Regresyon testi (her değişiklik sonrası):** ayrı terminalde `npm run dev` açıkken
`node tools/run_all_tests.js` — ~28 tarayıcı testi + duman testi (~2-3 dk), sonunda
`tools/SON_TEST_RAPORU.md` (insan-okunur). Baseline için bkz. hafıza/`project-test-baseline`.
Bash/komut timeout'unu ≥600000ms yap (yoksa "asılı kaldı" görünür). İnsan/kullanıcı
odaklı kurulum + özellik + test anlatımı **README.md**'dedir.

## Mimari (Modüler)

ES module yok; `index.html` dosyaları **sıralı `<script>`** ile yükler ve hepsi
**ortak global kapsamı** paylaşır. Yükleme sırası **önemlidir** (taban
`updateUI`/`startMatchDay` 90-main'ce sarmalanır):

```
data/*.js → 00-config → 05-core → 06-dialog → 10-db → 12-store → 15-calendar →
            20-player → 25-career → 30-league → 35-promotion → 40-match → 42-matchux →
            45-matchengine → 50-transfer → 52-market → 54-negotiation → 80-cups → 85-euro →
            55-stats → 56-devtrack → 58-history → 60-ui → 70-save → 90-main →
            92-creation → 94-bindings → 95-menu
```

2026-06-11 **kritik kalıcılık + transfer dalgası (v2.8.0)**: (1) **Dünya kalıcılığı:** `evolveWorld(season)` artık DETERMİNİSTİK (careerSalt+sezon+takım tohumlu). `restoreWorldState` (30-league) kayıt yüklenince dünyayı yeniden kurar: `resetWorldToBase` (modül yüklenirken `captureWorldBase` ile alınan saf DB_TEAMS değerleri) + biten her sezonun evrimini replay + `gameState.teamLeagues` overlay'i (terfi/küme düşme — `runPromotionRelegation` yazar). Yeni kariyer `resetWorldToBase` ile başlar (aynı oturumda slotlar arası sızıntı yok). Eskiden `t.leagueId`/`t.power` mutasyonları reload'da kayboluyordu → terfi eden takım eski lige "ışınlanıyor", sezon 2+ skorlar puan durumuyla çelişiyordu. (2) **Reload fikstür koruması:** `loadFromSlot`/`loadGame` kayıttaki fikstürü (oynanmış skorlarla) KORUR; yalnız lig değiştiyse/boşsa yeniden üretir. Eskiden her yüklemede skorlar silinip geçmiş haftalar deterministik "yanlış" skorla gösteriliyor, oynanmış maç aynı gün yeniden oynanabiliyordu. (3) **Tek transfer-kabul yolu:** `acceptTransferOffer(offer,{wage,duration,viaNegotiation})` (60-ui) — hem "Kabul Et" hem pazarlık (54-negotiation) bundan geçer → bonservis (`applyTransferFee`+`clubSpend`), kiralık teklif KİRALIK kalır (`onLoan`/`loanReturn`), transfer geçmişi iki yolda da yazılır (eskiden pazarlık yolu bunların hiçbirini yapmıyordu). Testler: `test_worldpersist` (16) + `test_negaccept` (19); süit 475/475.

2026-06-04 **altyapı oyuncuları gerçek kadroya entegre (9c)**: Eskiden `p.youthProspects` yalnız dashboard'da gösterilen DEKORATİF listeydi (kadroda yok, maçta oynamıyor). Artık: kulübün genç yetenekleri `gameState.clubYouth[clubId]` altında tutulur; `DB.squadSync` bunları da döndürür → `_buildXI` otomatik değerlendirir (düşük OVR'la başta yedek/dışı, geliştikçe kimi zaman ilk 11). Her sezon sonu `developClubYouth` (25-career; `developPlayerSeason` ile yaş+1 + gelişim) çalışır, yeni mezunlar eklenir, en iyi 8 ile sınırlanır. `ageAdjustedOvr` `isYouth` için ham OVR döner (çift gelişim olmasın — manuel geliştiriliyorlar). Kreasyonda (92-creation) başlangıç filizi tohumlanır; default `gameState.clubYouth={}` (70-save/92-creation). Dashboard "Altyapı / Genç Yetenekler (kadroda)" olarak clubYouth'tan render eder. **AÇIK İŞ: dünya oyuncu/takım istatistikleri DETERMİNİSTİK-SENTETİK (detScore + computeLeagueLeaders "tahmini") → maç detayı (buildMatchDetail) ile oyuncu profili (openPlayerProfile) UZLAŞMIYOR (ör. maçta hat-trick, profilde 1G+1A "TAHMİNİ"). Kullanıcı GERÇEK, kalıcı, çok-sezonluk istatistik istiyor — tek doğruluk kaynağına bağlanmalı; localStorage 22k oyuncu×sezonu kaldırmaz → IndexedDB veya tutarlı-deterministik yeniden-kurulum gerek. Büyük iş, ayrı odakta yapılacak.**

2026-06-04 **temizlik + tutarlılık düzeltmeleri (9b)**: (1) **Ölü kod temizliği** (programatik tarama, 312 fonksiyon denetlendi): 6 export-edilmiş-ama-çağrılmayan fonksiyon silindi — `attrsForPos` (00-config), `calToday` (15-calendar), `teamRank` (30-league), `leagueHasLowerDivision`/`leagueHasUpperDivision` (35-promotion), `resetStandings` (60-ui) + export listelerinden çıkarıldı. 7 bayat "app.js'i override eder" yorumu (app.js modülerleştirmede silinmişti) güncel duruma göre düzeltildi. Yorum-içi ölü kod / debug console.log / TODO / gerçek mükerrer fonksiyon YOK (kod tabanı temiz). (2) **`simulateMatchInstantly` gol↔skor tutarsızlığı:** oyuncunun gol/asisti takım skorundan BAĞIMSIZ hesaplanıyordu → "2 gol attın ama takım skoru 1" mümkündü. Artık oyuncunun katkısı takımın ATTIĞI gollerin (`myScore`) bir ALT KÜMESİ: her takım golü için pozisyon-bazlı `goalShare`/`assistShare`×`involve` ile "bu golü oyuncu mu attı/asist mi yaptı" dönülür → `gol ≤ takım skoru` garanti (300binx maçta 0 ihlal, oranlar canlı yolla tutarlı). (3) **Sezon-sonu derece gösterimi:** `${lg.name} ${myRank}. Sıra` → "Ligue 1" + "1. Sıra" birleşip "Ligue 11. Sıra" gibi okunuyordu (logic doğruydu, görsel hata); `${myRank}. Sıra — ${lg.name}` yapıldı.

2026-06-04 **gol dengesi + karar-anı modeli (9. dalga)**: Önceki turda "çok gol oluyor"u düzeltirken DENGE ters kaçtı (10 maçta 1 gol). Kök nedenler ve kalıcı çözüm (`45-matchengine.js`): (1) **KRİTİK — `decisionCount` sıfırlanmıyordu:** `activeMatch` KALICI bir global nesne (satır ~80); `startMatchDay` `decisionCount`/`lastDecisionMin`'i sıfırlamıyordu → 1. maçta sayaç 4'e (tavan) çıkıyor, SONRAKİ tüm maçlarda `_decReady` hep false → karar anı HİÇ tetiklenmiyordu (interaktif gol gelmiyordu). Düzeltme: `startMatchDay`'de `activeMatch.decisionCount=0; activeMatch.lastDecisionMin=-99;`. **DERS: activeMatch'e eklenen her per-maç sayaç startMatchDay'de sıfırlanmalı.** (2) **Dönüşüm kapısı kalibrasyonu:** başarılı hücum kararı artık otomatik gol DEĞİL — `_convP` (gol 0.52, asist 0.55) ile dönüşüm yapılır; dönüşmezse "şans yaratıldı" anlatımı (`_DECISION_CHANCE_MISS`/`_DECISION_ASSIST_MISS`) + küçük puan. Oran Node kalibrasyon scriptiyle simülasyon yoluna (kullanıcının "doğal" dediği `simulateMatchInstantly`: `attackChance=0.4×form/100×ovr/75`, ~0.57 gol/maç güçlü ST) EŞİTLENDİ → güçlü ST gerçekçi oyunda ~0.55, iyi seçimlerle ~0.79 gol/maç; sezon 21-31 gol; maçların %48'i golsüz, %38 tek, %12 ikili, %1.7 hat-trick. (3) **Karar sıklık sınırı:** maç başına en çok 4 karar anı, arada en az 12 dk (`activeMatch.decisionCount<4 && minute-lastDecisionMin>=12`) — eskiden ~%15/dk → maç başına ~13 karar anı (enflasyonun ana nedeni). (4) **Metin-tahmini KALDIRILDI:** `_decisionOutcome` artık YALNIZ açık etiketlerden (`isGoal`/`isAssist`/`isChance`) okur; 8. dalgadaki "başarı mesajından gol/asist çıkar" regex'i kaldırıldı. Bunun için 23 etiketsiz hücum seçeneğine açık etiket eklendi (120 seçenek scriptle doğrulandı, etiketsiz-gol-seçeneği=0). (5) **Ambient (seçeneksiz) gol kullanıcıya YAZILMAZ:** `simulateGenericEvent`'teki takım golü artık `simulateGoalForLineup('MY', false)` — kullanıcının gol/asisti YALNIZ karar anlarından gelir (eskiden allowUser=true → kullanıcı hiçbir şey yapmadan "seçeneksiz" gol sayısı artıyordu, /btw şikayeti). **NOT: bu ortamda arka-plan Workflow/agent takılıyor + uzun tek-blok turlar limit/cut'a takılıyor → ön planda küçük doğrulanabilir adımlarla çalış.**

2026-05-31 **maç motoru + antrenman + bug-hunt dalgası (8. dalga)**: (1) **Karar anı (decision) gol/asist sayımı:** `resolvePlayerDecision` artık `_decisionOutcome(option,pos)` ile sonucu belirler — açık `isGoal`/`isAssist` flag yoksa BAŞARI mesajından çıkarır ("gol/GOL/ağlar"→gol, "asist/tamamladı/o da gol/kendi kalesine/gol oldu"→asist, "gol pozisyonu/şans/fırsat"→none). Önceden ~23 seçenekte flag eksikti (HIZ dahil) → gol mesajı çıkıyor ama skor/istatistik sayılmıyordu. 120 seçenek scriptle doğrulandı; tek anahtar-kelimesiz istisnaya (Merkez OS "kaleciyi avladın") açık `isGoal` eklendi. Kaleci başarısız kurtarışta artık gol yer (concedeProb 0.85). (2) **Sub-out maçı bitirmez:** kullanıcı/hoca oyundan çıkardığında `_resumeAfterSubOut()` (ticker DEVAM, kullanıcı yedekten izler) — eskiden `simulateRemainingMatchFast()` maçı 90'a atlatıp bitiriyordu. (3) **Maç olayları ev/dep'e göre:** `renderMatchEvents` tarafı `ev.team`+`activeMatch.isHome` ile (ev solda, dep sağda) — skor tablosuyla tutarlı; eskiden hep MY solda. (4) **Yedek/değişiklik mantığı (40-match):** kullanıcı `bench`'te başlarsa `myBench`'te görünür (`isUser`); `_doSub`/`_subInForUser`/`_subUserIntoXI` çıkan oyuncuyu `subbedOut:true` ile kulübede SOLUK + aşağı-ok ile bırakır (kaybolmaz), gelen yalnız oynayabilir yedekten (`!subbedOut && !isUser`); CSS `.subbed-off`. (5) **Akıllı Hızlı Antrenman (`_smartQuickTrainingType`, 90-main):** mevki ailesi-önem (`POS_STAT_IMPORTANCE`) × stat-zayıflık açığı + yaş + hoca güveni ile her basışta en mantıklı türü seçer; `performTraining` "Antrenman Puanı: +X.X" gösterir. 2 yeni tür: `technique`, `aerial` (Gelişim sekmesinde 10 kart). (6) **Gelişim kartları kompakt:** `.training-grid` `auto-fill minmax(215px)`, kart padding/ikon/font küçültüldü. (7) **Serbest oyuncuda** Hoca Güveni/Taraftar Sevgisi kutuları gizli (`#qs-box-trust`/`#qs-box-fans`, `updateUI`). (8) **Bug-hunt:** [HIGH-REGRESYON] reload'da fikstür skorları silinmesi düzeltildi (yukarı bak, `_fxLeague` null yapma kaldırıldı); [MED] karar senaryoları 12 mevkiye AİLE bazlı eşlendi (`FAM_TO_KEY`, eskiden Sağ Bek/Kanat → Santrfor senaryosu); [MED] `simulateMatchInstantly` kanat gol branch'i `posFamily` ile (eski `'Kanat'` ölü kontrolü); [MED] `_totalWeeks` *38→*36 (leftClubAtWeek/joinedClubWeek *36 konvansiyonuyla hizalandı). **NOT: bu ortamda arka-plan Workflow/agent'lar takılıyor — araştırma+düzeltme doğrudan veya ön-plan tek agent ile yapıldı.**

2026-05-31 **bildirim & kupa-UX dalgası (6. dalga)**: (1) Takım logoları paketlendi (`tools/fetch_logos.py` → 262 gerçek crest, detay aşağıda). (2) **Bildirimler sağ-ÜST köşeye taşındı** (`#toast-container` `top:20px`); kalıcı "haber akışı" denemesi KALDIRILDI (kullanıcı istemedi). "Hafta X başladı" toast'ı yok. Yeni teklif gelince HEM nav rozeti HEM sağ-üst toast (yalnız gerçekten yeni teklif eklenince — `_b`/`_n` before/after sayımı). (3) **Teklif rozeti:** Transfer & Sözleşme nav sekmesinde bekleyen teklif sayısı (`#nav-offers-badge`, `updateOffersBadge`, `updateUI`'den). (4) **Kupa butonu birleştirildi:** ayrı "Kupa Maçına Çık"/euro-prompt butonları kaldırıldı; kupa maçı da normal "Maça Çık!" + "Maçı Simüle Et" akışından oynanır (`setupNextActionLabel` kupa branch'i lig gibi; `btn-simulate-match-instantly` kupa gününde `simEuroMatch`'e yönlenir; `renderEuroPrompt` artık butonsuz bilgi banner'ı, kupa gününde gizli). (5) **Kupa sim → modal:** `simEuroMatch(fx,phase,round,quiet)` — oyuncu bizzat simüle ederse (`quiet=false`) normal maç gibi `_showCupSummary` maç-sonu özetini gösterir; otomatik (`quiet=true`) ise kısa toast. (6) **Kupa rakibi GERÇEK oyuncular:** `startEuroMatch` artık `startMatchDay`'den ÖNCE rakibin ligini (`oppId.split('__')[0]` + `srcLeague`) `DB.loadPlayers` ile yükler — yoksa `squadSync` boş döner ve `fillSquadIfNeeded` rastgele dolgu üretirdi. (7) **2. yarı pause fix:** `btn-match-resume-half` handler'ı `cloneNode` ile kopmuş eski referans yerine butonları ID ile yeniden sorgular (Duraklat/Oyundan Çık 2. yarıda kayboluyordu). (8) **İstatistik varsayılan lig:** `_ensureGameStateFields` load'da `viewStandingsLeague` + `statsView.league`'i oyuncunun mevcut ligine DOĞRUDAN eşitler (eski kayıtta İngiltere'ye sıkışma fix'i). NOT: `_fxLeague`'e DOKUNULMAZ — onu null yapmak reload'da `setActiveLeagueFixtures`'ı tetikleyip oynanmış maç skorlarını cache'ten null'a çevirirdi (8. dalgada düzeltildi). (9) Kariyer oluşturmada takım dropdown'ında takım logoları (`_populateTeamDropdown`), maç-içi kadro toggle logoları 14→22px.

2026-05-31 **panel sadeleştirme + dropdown dalgası (7. dalga)**: (1) **Action-first düzen:** dashboard `.grid-layout` çocuklarına CSS `order` (card-actions=1, card-player-details=2, club-info=3, season=4) — HTML taşımadan "Sıradaki Aktivite" öne/sola alındı. (2) **Statik bio → modal:** millet/no/doğum/boy/kilo/yaş + sarı/kırmızı kart dashboard'dan `#profile-detail-modal`'a taşındı (ID'ler korundu → `updateUI` aynı ID'leri doldurur, eleman modalda); profil kartı başlığındaki "Detay" butonu (`#btn-profile-detail`) açar. (3) **Kulüp bilgi kartı collapse:** `renderClubInfoCard` artık başlığa tıklanınca açılan gövde (`.club-card-body`, `_clubCardOpen` modül-state, varsayılan KAPALI). (4) **Sezon Performansı mini:** dashboard'da 3 kutu (`.season-stats-mini`), sarı/kırmızı profil modalında. (5) **Takım dropdown'u `setupDropdown`'a geçti** (lig/ülke ile aynı bileşen, + arama kutusu): elle implementasyon `.selected` class'ını güncellemediği için "tekrar açınca en güçlü seçili görünüyor" bug'ı vardı — düzeldi. (6) Profil kartı/takvim logoları 16→24/22px (nokta kadar görünüyordu).

2026-05-31 **modülerleştirme dalgası**: dev `05-core.js` (3611 satır; UI+maç+pazarlık+oluşturma+binding karışık) tek-sorumluluk modüllere bölündü. Çekirdek `05-core.js` artık YALNIZ `gameState` + temel yardımcılar (`getTeamLogoHtml`/`formatMoney`/`getWeekDateString`/`showToast`/`getStatModifierFromHeightWeight`) + `setupDropdown` (~266 satır). Çıkan modüller:
- `45-matchengine.js` — maç motoru: `startMatchDay`/`runMatchTicker`/`simulateGoalForLineup`/`triggerPlayerDecision`/`resolvePlayerDecision`/`endMatch`/`simulateMatchInstantly`/`renderMatchLineupPitch` + maç durumu (`activeMatch`/`matchLineups`/`PITCH_COORDINATES`/`SQUAD_SLOTS`). 40-match (kadro) + 42-matchux (UX) üzerine çalışır.
- `54-negotiation.js` — sözleşme + transfer pazarlık modalları (`negotiationState`/`transferNegotiationState`, `requestContractNegotiation`/`submitCounterOffer`/`openTransferNegotiationModal`/`submitTransferCounterOffer`).
- `92-creation.js` — karakter oluşturma: `updateCreationStatsPreview` + form submit + `setupCreationScreen`/`initCustomDropdowns`/`_renderPositionRadios`/`_populateTeamDropdown` (sonuncular 90-main'den taşındı).
- `94-bindings.js` — TÜM DOM olay bağlama + oyun akışı geçişleri (hafta ilerleme, sezon-sonu handler, `triggerRetirement`, `resetCareer`, nav sekmeleri, modal binding'leri) + boot girişi (`window.load`). En sonlarda yüklenir; tüm referanslar runtime'da çözülür.
- `60-ui.js` artık `updateUI` (taban) + `updateActionButtonsState` + `setupNextActionLabel` + fikstür/navigasyon + `renderTransferTab`/`openTransferModal` da içerir. `90-main.js` `updateUI`'yi (60-ui tabanı) ve `startMatchDay`'i (45-matchengine tabanı) `const _orig = window.X; window.X = function(){…}` deseniyle sarmalar (yük sırası: tabanlar 90-main'den ÖNCE).

2026-05-30 dalgası (UI/maç/takvim/veri büyük güncellemesi) ile eklenen modüller:
- `06-dialog.js` — `gameConfirm`/`gameAlert` (Promise tabanlı modern modal; tüm `confirm()` çağrıları buna taşındı). `05-core`'dan sonra (showToast'a bağlı).
- `12-store.js` — IndexedDB kayıt aynası (write-through `storeMirrorSave`, boot'ta `storeHydrateMissingSlots`) + `.json` `exportSaveToFile`/`importSaveFromFile` (ana menü).
- `15-calendar.js` — GÜN-BAZLI takvim katmanı. `gameState.gameDate` (sezon-günü), değişmez kontrat `dayToWeek(gameDate)===currentWeek`. `advanceDay('event'|'one')` gün gün ilerler, sonraki maça kadar gider; hafta sınırında `advanceWeek()` çağrılır. `matchToday()` (lig günü=5, kupa günü=2 → çakışma çözümü), `calFormat` (gerçek tarih, yıl ilerler), `renderCalendarStrip`.
- `42-matchux.js` — maç UX: olay akışı (`pushMatchEvent`/`renderMatchEvents`), gol/olay animasyonu (`triggerGoalFx`), maç-içi istatistik (`bumpStat`/`renderMatchStats`), maç hızı (`MATCH_SPEED`/`setMatchSpeed`, `gameState.settings.matchSpeed`). `40-match`'ten sonra.
- `58-history.js` — maç detayı (`buildMatchDetail` deterministik dünya skoru + golcü/kart; `openMatchDetail` modal), kullanıcı `matchLog`/`transferHistory` kaydı (`recordRealMatch`/`recordTransferHistory`). `55-stats`'tan sonra.

Maç motoru & hoca AI (`40-match.js` kadro/AI + `45-matchengine.js` simülasyon): `decideUserMatchStatus` kullanıcının statüsünü belirler (rotasyon/yedek/kadro-dışı; OVR-rakip + güven + kupa/zayıf-rakip + `seasonStarts`/`seasonBenched` dengesi). `_buildXI` affinity-bazlı yerleşim (`_slotAffinity`/`FAM_AFFINITY` — santrfor kanatta da oynayabilir). Yedek oyuncu maçı 0'dan izler, hoca `userEntryMinute`'da `_subUserIntoXI` ile alır. `_autoSubsForTeam` skor/kondisyon/dakika-bazlı 2-4 akıllı değişiklik. `endMatch` `neverPlayed` ise stat/enerji yazmaz.

Dünya maç skorları artık DETERMINISTIK (`detScore`/`worldMatchScore`, `gameState.careerSalt` ile tohumlu) → puan durumu, fikstür gösterimi ve maç detayı birebir tutarlı, depolama gerektirmez.

Sonradan eklenen modüller (hepsi global kapsamı paylaşır, `window.*`'a export eder):
- `35-promotion.js` — küme düşme/çıkme (yalnız çok kademeli ülke piramitleri: ENG/GER/ESP/ITA/FRA). `runPromotionRelegation` `DB.invalidate()`+`resetFixtureCache()` çağırır; oyuncu JSON'ları orijinal ligde kalır (`team.srcLeague`).
- `52-market.js` — transfer ekonomisi: `clubBudget`, `transferWindowKind`/`isTransferWindowOpen`, `generateFreeAgentPool`→`gameState.freeAgents`, `generateTransferNews`→`gameState.transferNews`/`clubSpend`, `maybeRunMarket` (advanceWeek'ten, `_lastMarketKey` ile bir kez), `fillSquadIfNeeded`→`gameState.genFillers` (squadSync bunları da döndürür).
- `85-euro.js` — OYNANABİLİR kıta kupası kampanyası (`gameState.euro`). `window._euroMatchCtx` bayrağı maç motorunu kupa moduna alır; `endMatch` `endEuroMatch()`'e dallanır.
- `55-stats.js` — lig krallıkları (deterministik sentetik dağıtım, kullanıcı gerçek statlar), yıl sonu ödülleri (`computeSeasonAwards`), FM-tarzı `openPlayerProfile` (id eşleşmesi için `String()` zorlaması).
- `56-devtrack.js` — gelişim takibi: `recordDevSnapshot` (`p.trainingHistory`; antrenman/sezon/başlangıç), `renderDevTrack` (SVG sparkline + filtre).
- `95-menu.js` — açılış menüsü, 10 kariyer slotu, avatar (DiceBear galeri + yükleme), boot yönlendirme.
- `50-transfer.js` artık bonservis (`fee`) + tür (`transfer`/`loan`/`free`) içeren teklif üretir; sözleşmeli transfer yalnız pencerede.
- `40-match.js` yedek kulübesi + canlı kondisyon + maç-içi oyuncu değişikliği içerir.

### Veritabanı (`data/`, otomatik üretilir)
`tools/build_database.py`, Kaggle CSV'lerinden (`Footballers.csv` =
EA Sports FC 26 + `Football Stadiums.csv`) üretir. **Bunları elle düzenleme;**
script'i yeniden çalıştır (`python tools/build_database.py`; bağımlılık: pandas, pycountry).
- `leagues.js` → `window.DB_LEAGUES` (45 lig/kupa: id, ülke, konfederasyon, kademe, `type:'league'|'cup'`, `startable`).
- `teams.js` → `window.DB_TEAMS` (644 takım: `power/attack/defense/prestige`, renk, logoUrl, `stadium{name,capacity}`, `facilities{training,youth}`). Takım ID = `<ligId>__<slug>`. `logoUrl`: 262 takımda yerel `assets/logos/<takımId>.png` (gerçek crest, `tools/fetch_logos.py` ile paketlendi), kalan 382'de `null` → `getTeamLogoHtml` baş-harf rozetine düşer (ölü URL/404 yok).
- `players/<ligId>.json` → lig başına oyuncu detayları, **talep üzerine fetch** (DB.loadPlayers). Oyuncu: 6 ana stat + ~29 alt-özellik + foto (`img`) + EA pozisyonu.
- `nations.js`, `ovr_coef.js`.

### Tek doğruluk kaynağı: `gameState`
Global `gameState` her şeyi tutar: `player`, `currentSeason`, `currentWeek`,
`fixtures` (**yalnız aktif lig**), `standings` (**tüm ligler**: `standings[ligId][takımId]`),
`transferOffers`, `trophies`, `cups`, `euro` (kıta kupası kampanyası), `freeAgents`,
`transferNews`, `clubSpend` (al-sat), `genFillers` (üretilen dolgu oyuncular),
`_lastMarketKey`, haftalık eylem sayaçları, `_lastSimWeek`, `_fxLeague`,
`viewStandingsLeague`, çok-slotlu kayıt için `_slot`. Fonksiyonlar bu global'i doğrudan okur/yazar.
Oyuncu gelişim geçmişi `player.trainingHistory`, kiralık durumu `player.onLoan`/`player.loanReturn`.
2026-05 dalgasıyla eklenenler: `gameDate`+`seasonStartDate` (gün-bazlı takvim), `careerSalt`
(deterministik dünya skoru tohumu), `settings.matchSpeed`, `worldTransferLog` (dünya transfer arşivi);
`player.matchLog`/`player.transferHistory` (maç/transfer geçmişi), `player.seasonStarts`/`seasonBenched`
(rotasyon dengesi). Hepsi `70-save.js` `_ensurePlayerFields`/`_ensureGameStateFields` ile default'lanır.
`gameState` global `let`'tir (window özelliği DEĞİL); fonksiyonlar `window.*`'a atanır.

### Durum akışı
Her değişiklikten sonra `saveGame()` (→ `70-save.js`, v2 anahtarı; `loadGame` v1→v2
migrasyon yapar) ardından `updateUI()`. `updateUI` `90-main.js`'te **sarmalanır**:
aktif lig değişince fikstürü yeniler (`_syncActiveLeague`) ve kulüp kartı + kupa
sekmesini render eder. Yeni `player` alanı eklerken `70-save.js` `_ensurePlayerFields`
içine default koy (geriye uyumluluk).

### Oyuncu & lig modeli
- **12 mevki** (`POSITIONS`, `src/00-config.js`): Kaleci, Stoper, Sağ/Sol Bek, DOS,
  Merkez OS, Ofansif OS, Sağ/Sol Açık, Sağ/Sol Kanat, Santrfor (EA mevkileriyle birebir).
- **Statlar:** 6 ana (`hiz,sut,pas,teknik,defans,fizik`) = ilgili alt-özellik grubunun
  ortalaması (`recomputeMainStats`). `calculateOVR` (`20-player.js`) alt-özelliklerden
  mevki-bazlı ağırlıkla hesaplar (`OVR_COEF`, EA'ya kalibre, ort. hata 0.28). DB
  oyuncuları CSV'nin gerçek OVR'ını taşır.
- **Takım gücü** gerçek kadrodan türetilmiştir; maç motoru `power`'ı gol-olasılık
  formüllerinde kullanır (`simScore`, `30-league.js`).

### Oyun döngüsü
- `advanceWeek()` (`90-main.js`): aktif ligin hafta sayısına göre sezon-sonu kontrolü,
  `simulateWorldWeek` (45 lig, kullanıcı maçı hariç; `_lastSimWeek` çift-sayımı önler),
  enerji/sakatlık/menajer-güveni/teklif mantığı. Sezon sonu → `openSeasonEndModal`;
  yeni sezon → yaş eğrisi (`developPlayerSeason`), altyapı (`generateYouthProspects`),
  dünya evrimi (`evolveWorld`), kupalar (`runSeasonCups`).
- **Antrenman** (`performTraining`, `90-main.js`): 8 tür, alt-özellikleri hedefler;
  tesis + yaş + potansiyel-boşluğu ile ölçeklenir; sakatken engellenir; haftada 2 eylem.
- **Maç motoru** (`45-matchengine.js`): `startMatchDay` (sakatsa `90-main` sarmalayıcısı
  oynatmaz), `generateMatchLineups` (`40-match.js`, gerçek kadrodan 11 + foto),
  `runMatchTicker` (dakika dakika), karar anları, `endMatch`. `simulateMatchInstantly` de var.
- **Transfer** (`50-transfer.js`): dünya çapı kulüp havuzu; kabul → aktif lig değişir.
- **Kupalar** (`80-cups.js`): sezon sonunda kıtasal kupalar simüle edilir; **lig
  mantığına dokunmaz**. `type:'cup'` ligler (Libertadores/Sudamericana) round-robin'e girmez.

### Geliştirici araçları (`tools/`)
`build_database.py` (veri), `fetch_logos.py` (takım logoları — TEK SEFERLİK; GitHub
`luukhopman/football-logos` 2024-25 tarball'ını indirir, 22 Avrupa üst-ligindeki takım
adlarını bulanık eşleştirir, `assets/logos/<takımId>.png` olarak paketler ve `teams.js`
`logoUrl`'lerini günceller — eşleşmeyen/kapsanmayan → `null`. Yalnız stdlib, idempotent),
`smoke_test.js` (Puppeteer 15-senaryo uçtan uca test). Oyun çalışması için gerekmez.
(Eski `cleanup_core.js` app.js→05-core migrasyon aracıydı; app.js kaldırıldığı için silindi.)
