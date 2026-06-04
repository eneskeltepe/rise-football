// ============================================================================
//  00-config.js  —  Oyun konfigurasyonu: pozisyonlar, statlar, sabitler
//  Bagimlilik YOK. Diger tum modullerden once yuklenir.
// ============================================================================

// ---- 12 oynanabilir pozisyon (EA mevkileriyle birebir) ----
// fam: makro aile (saha/karar mantigi icin) | side: L/R/C (saha yerlesimi)
const POSITIONS = [
    { key: 'Kaleci',     short: 'KL',  ea: 'GK',  fam: 'GK',  side: 'C', renk: '#ffca28' },
    { key: 'Stoper',     short: 'STP', ea: 'CB',  fam: 'CB',  side: 'C', renk: '#42a5f5' },
    { key: 'Sağ Bek',    short: 'SğB', ea: 'RB',  fam: 'FB',  side: 'R', renk: '#26c6da' },
    { key: 'Sol Bek',    short: 'SoB', ea: 'LB',  fam: 'FB',  side: 'L', renk: '#26c6da' },
    { key: 'DOS',        short: 'DOS', ea: 'CDM', fam: 'DM',  side: 'C', renk: '#66bb6a' },
    { key: 'Merkez OS',  short: 'MOS', ea: 'CM',  fam: 'CM',  side: 'C', renk: '#9ccc65' },
    { key: 'Ofansif OS', short: 'OOS', ea: 'CAM', fam: 'AM',  side: 'C', renk: '#ffa726' },
    { key: 'Sağ Açık',   short: 'SğA', ea: 'RM',  fam: 'WM',  side: 'R', renk: '#ffb74d' },
    { key: 'Sol Açık',   short: 'SoA', ea: 'LM',  fam: 'WM',  side: 'L', renk: '#ffb74d' },
    { key: 'Sağ Kanat',  short: 'SğK', ea: 'RW',  fam: 'W',   side: 'R', renk: '#ef5350' },
    { key: 'Sol Kanat',  short: 'SoK', ea: 'LW',  fam: 'W',   side: 'L', renk: '#ef5350' },
    { key: 'Santrfor',   short: 'SF',  ea: 'ST',  fam: 'ST',  side: 'C', renk: '#e53935' },
];
const POSITION_KEYS = POSITIONS.map(p => p.key);
const POS_BY_KEY = Object.fromEntries(POSITIONS.map(p => [p.key, p]));
// Eski 8-mevki -> yeni 12-mevki (geriye donuk uyumluluk migrasyonu)
const LEGACY_POS_MAP = {
    'Kaleci': 'Kaleci', 'Stoper': 'Stoper', 'Bek': 'Sağ Bek', 'DOS': 'DOS',
    'Merkez OS': 'Merkez OS', 'Ofansif OS': 'Ofansif OS', 'Kanat': 'Sağ Kanat',
    'Santrfor': 'Santrfor',
};
function posFamily(key) { return (POS_BY_KEY[key] || {}).fam || 'CM'; }

// ---- 6 ana stat ----
const MAIN_STATS = [
    { key: 'hiz',    label: 'Hız',    kisa: 'HIZ' },
    { key: 'sut',    label: 'Şut',    kisa: 'ŞUT' },
    { key: 'pas',    label: 'Pas',    kisa: 'PAS' },
    { key: 'teknik', label: 'Teknik', kisa: 'TEK' },
    { key: 'defans', label: 'Defans', kisa: 'DEF' },
    { key: 'fizik',  label: 'Fizik',  kisa: 'FİZ' },
];
const MAIN_STAT_KEYS = MAIN_STATS.map(s => s.key);

// ---- 29 alt-ozellik: ana stata gruplu (EA mantigi) + Turkce etiket ----
// Ana stat = ilgili alt-ozelliklerin ortalamasi (rollup). Antrenman bunlari hedefler.
const ATTR_GROUPS = {
    hiz:    [['hizlanma', 'Hızlanma'], ['sprintHizi', 'Sprint Hızı']],
    sut:    [['pozisyonAlma', 'Pozisyon Alma'], ['bitiricilik', 'Bitiricilik'],
             ['sutGucu', 'Şut Gücü'], ['uzaktanSut', 'Uzaktan Şut'],
             ['vole', 'Vole'], ['penalti', 'Penaltı']],
    pas:    [['vizyon', 'Vizyon'], ['ortaPas', 'Orta'], ['serbestVurus', 'Serbest Vuruş'],
             ['kisaPas', 'Kısa Pas'], ['uzunPas', 'Uzun Pas'], ['falso', 'Falso']],
    teknik: [['ceviklik', 'Çeviklik'], ['denge', 'Denge'], ['reaksiyon', 'Reaksiyon'],
             ['topKontrol', 'Top Kontrolü'], ['sogukkanlilik', 'Soğukkanlılık'],
             ['topSurme', 'Top Sürme']],
    defans: [['topKapma', 'Top Kapma'], ['kafaVurusu', 'Kafa'], ['defansFarkindaligi', 'Defans Farkındalığı'],
             ['ayaktaMudahale', 'Ayakta Müdahale'], ['kayarakMudahale', 'Kayarak Müdahale']],
    fizik:  [['ziplama', 'Zıplama'], ['dayaniklilik', 'Dayanıklılık'],
             ['guc', 'Güç'], ['agresiflik', 'Agresiflik']],
};
// Kaleci icin teknik grubu yerine 6 kaleci ozelligi
const GK_ATTR_GROUP = [
    ['gkUcus', 'Uçuş'], ['gkTopTutma', 'Top Tutma'], ['gkVurus', 'Vuruş (Ayak)'],
    ['gkYerTutma', 'Yer Tutma'], ['gkRefleks', 'Refleks'], ['reaksiyon', 'Reaksiyon'],
];
// alt-ozellik anahtari -> hangi ana statin altinda (rollup icin)
const ATTR_TO_MAIN = (() => {
    const m = {};
    for (const main in ATTR_GROUPS) for (const [k] of ATTR_GROUPS[main]) m[k] = main;
    return m;
})();
function attrLabel(key) {
    for (const main in ATTR_GROUPS) { const f = ATTR_GROUPS[main].find(x => x[0] === key); if (f) return f[1]; }
    const g = GK_ATTR_GROUP.find(x => x[0] === key); return g ? g[1] : key;
}
// ---- OVR katsayilari (data/ovr_coef.js'ten; calibrasyon MAE 0.278) ----
const OVR_COEF = (typeof window !== 'undefined' && window.DB_OVR_COEF) || {};

// ---- Sabitler ----
const SAVE_KEY = 'football_career_save_v2';
const LEGACY_SAVE_KEY = 'football_career_save_v1';
const START_SEASON = 2026;
const RETIRE_AGE = 36;

// ---- 8 antrenman tipi: hangi alt-ozellikleri yukseltir + enerji maliyeti ----
const TRAINING_TYPES = [
    { id: 'hiz',     ad: 'Sürat Antrenmanı',   ikon: 'fa-bolt',          enerji: 25, attrs: ['hizlanma', 'sprintHizi', 'ceviklik'] },
    { id: 'sut',     ad: 'Şut Antrenmanı',     ikon: 'fa-futbol',        enerji: 25, attrs: ['bitiricilik', 'sutGucu', 'uzaktanSut', 'pozisyonAlma'] },
    { id: 'pas',     ad: 'Pas Antrenmanı',     ikon: 'fa-share-nodes',   enerji: 20, attrs: ['kisaPas', 'uzunPas', 'vizyon', 'ortaPas'] },
    { id: 'teknik',  ad: 'Teknik Antrenman',   ikon: 'fa-wand-magic',    enerji: 22, attrs: ['topSurme', 'topKontrol', 'falso', 'ceviklik'] },
    { id: 'defans',  ad: 'Defans Antrenmanı',  ikon: 'fa-shield-halved', enerji: 25, attrs: ['ayaktaMudahale', 'kayarakMudahale', 'topKapma', 'defansFarkindaligi'] },
    { id: 'fizik',   ad: 'Kondisyon',          ikon: 'fa-dumbbell',      enerji: 30, attrs: ['guc', 'dayaniklilik', 'ziplama'] },
    { id: 'kafa',    ad: 'Hava Topu',          ikon: 'fa-arrows-up-to-line', enerji: 22, attrs: ['kafaVurusu', 'ziplama', 'guc'] },
    { id: 'kaleci',  ad: 'Kaleci Antrenmanı',  ikon: 'fa-hands',         enerji: 25, attrs: ['gkUcus', 'gkRefleks', 'gkTopTutma', 'gkYerTutma'] },
];

// ---- yardimci: deger / maas formulleri ----
function calcMarketValue(ovr, age, prestige) {
    // ustel: her ~5 OVR degeri 2'ye katlar (68~3M, 80~16M, 87~42M, 90~64M)
    let base = Math.pow(2, (Math.max(45, ovr) - 50) / 5) * 250000;
    let ageF = age <= 21 ? 1.15 : age <= 25 ? 1.05 : age <= 28 ? 1.0 : age <= 31 ? 0.72 : age <= 33 ? 0.45 : 0.22;
    let prF = 0.9 + (prestige || 2) * 0.045;
    return Math.max(50000, Math.round(base * ageF * prF / 50000) * 50000);
}
function calcWage(ovr, prestige) {
    // 68~13K, 80~48K, 87~110K, 90~155K /hafta
    return Math.max(2000, Math.round(Math.pow(2, (ovr - 50) / 6) * 1600 * (0.7 + (prestige || 2) * 0.08) / 500) * 500);
}

if (typeof window !== 'undefined') {
    Object.assign(window, {
        POSITIONS, POSITION_KEYS, POS_BY_KEY, LEGACY_POS_MAP, posFamily,
        MAIN_STATS, MAIN_STAT_KEYS, ATTR_GROUPS, GK_ATTR_GROUP, ATTR_TO_MAIN,
        attrLabel, OVR_COEF, TRAINING_TYPES,
        SAVE_KEY, LEGACY_SAVE_KEY, START_SEASON, RETIRE_AGE,
        calcMarketValue, calcWage,
    });
}
