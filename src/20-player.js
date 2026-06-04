// ============================================================================
//  20-player.js  —  Oyuncu modeli: alt-stat -> ana stat rollup, OVR, deger
// ============================================================================

// ---- Mevki basina baslangic ana-stat araliklari (genc oyuncu) ----
// sira: {hiz,sut,pas,teknik,defans,fizik}
const STARTING_RANGES = {
    'Kaleci':     { hiz: [45, 55], sut: [20, 30], pas: [45, 60], teknik: [62, 74], defans: [20, 30], fizik: [50, 65] },
    'Stoper':     { hiz: [50, 62], sut: [30, 45], pas: [48, 60], teknik: [45, 58], defans: [66, 78], fizik: [70, 82] },
    'Sağ Bek':    { hiz: [70, 80], sut: [40, 52], pas: [58, 68], teknik: [58, 68], defans: [60, 70], fizik: [58, 70] },
    'Sol Bek':    { hiz: [70, 80], sut: [40, 52], pas: [58, 68], teknik: [58, 68], defans: [60, 70], fizik: [58, 70] },
    'DOS':        { hiz: [55, 66], sut: [45, 58], pas: [62, 72], teknik: [60, 70], defans: [66, 76], fizik: [65, 78] },
    'Merkez OS':  { hiz: [58, 68], sut: [52, 65], pas: [68, 78], teknik: [66, 76], defans: [52, 64], fizik: [58, 70] },
    'Ofansif OS': { hiz: [62, 72], sut: [62, 72], pas: [70, 80], teknik: [70, 80], defans: [38, 52], fizik: [52, 64] },
    'Sağ Açık':   { hiz: [72, 82], sut: [55, 66], pas: [62, 72], teknik: [68, 78], defans: [42, 55], fizik: [55, 66] },
    'Sol Açık':   { hiz: [72, 82], sut: [55, 66], pas: [62, 72], teknik: [68, 78], defans: [42, 55], fizik: [55, 66] },
    'Sağ Kanat':  { hiz: [75, 85], sut: [62, 72], pas: [60, 70], teknik: [72, 82], defans: [32, 46], fizik: [52, 64] },
    'Sol Kanat':  { hiz: [75, 85], sut: [62, 72], pas: [60, 70], teknik: [72, 82], defans: [32, 46], fizik: [52, 64] },
    'Santrfor':   { hiz: [68, 78], sut: [70, 80], pas: [50, 62], teknik: [62, 72], defans: [25, 38], fizik: [68, 80] },
};

function _rng(lo, hi) { return Math.floor(Math.random() * (hi - lo + 1)) + lo; }
function _clampStat(v) { return Math.max(1, Math.min(99, Math.round(v))); }

// Boy/kilo -> ana stat modifikatorleri (uzun=fizik/kafa+ hiz-, kisa=tersi)
function heightWeightMods(h, w, pos) {
    const m = { hiz: 0, sut: 0, pas: 0, teknik: 0, defans: 0, fizik: 0 };
    const dh = (h - 180), dw = (w - 75);
    m.fizik += dh * 0.25 + dw * 0.20;
    m.defans += dh * 0.12;
    m.hiz -= dh * 0.18 + dw * 0.12;
    m.teknik -= dh * 0.10;
    if (pos === 'Kaleci') m.teknik += dh * 0.15; // uzun kaleci avantaj
    for (const k in m) m[k] = Math.round(m[k]);
    return m;
}

// Baslangic alt-ozellik seti uret (ana-stat araligi + grup ici varyans)
function rollStartingAttrs(posKey, height, weight) {
    const base = STARTING_RANGES[posKey] || STARTING_RANGES['Merkez OS'];
    const mods = heightWeightMods(height, weight, posKey);
    const attrs = {};
    const isGK = posKey === 'Kaleci';
    // ana statlardan alt-ozellik dolumu
    const groups = isGK
        ? { teknik: GK_ATTR_GROUP, hiz: ATTR_GROUPS.hiz, sut: ATTR_GROUPS.sut, pas: ATTR_GROUPS.pas, defans: ATTR_GROUPS.defans, fizik: ATTR_GROUPS.fizik }
        : ATTR_GROUPS;
    for (const main in groups) {
        const [lo, hi] = base[main];
        const mod = mods[main] || 0;
        for (const [akey] of groups[main]) {
            attrs[akey] = _clampStat(_rng(lo, hi) + mod + _rng(-3, 3));
        }
    }
    return attrs;
}

// ---- Ana stat rollup (alt-ozelliklerin grup ortalamasi) ----
function recomputeMainStats(player) {
    const a = player.attrs || {};
    const stats = {};
    const isGK = player.position === 'Kaleci';
    for (const k of MAIN_STAT_KEYS) {
        if (isGK && k === 'teknik') {
            const gk = ['gkUcus', 'gkTopTutma', 'gkVurus', 'gkYerTutma', 'gkRefleks'];
            stats.teknik = Math.round(gk.reduce((s, x) => s + (a[x] || 0), 0) / gk.length);
        } else {
            const grp = ATTR_GROUPS[k];
            stats[k] = Math.round(grp.reduce((s, [x]) => s + (a[x] || 0), 0) / grp.length);
        }
    }
    player.stats = stats;
    return stats;
}

// ---- OVR ----
// Yedek (legacy/eski kayit): 6 ana stattan basit mevki-aile agirligi
const LEGACY_OVR_W = {
    GK: { teknik: .65, fizik: .15, pas: .1, hiz: .1 },
    CB: { defans: .5, fizik: .3, pas: .1, hiz: .1 },
    FB: { defans: .3, hiz: .3, pas: .2, fizik: .12, teknik: .08 },
    DM: { defans: .38, pas: .3, fizik: .2, teknik: .12 },
    CM: { pas: .38, teknik: .25, defans: .15, sut: .1, fizik: .12 },
    AM: { teknik: .33, pas: .33, sut: .2, hiz: .14 },
    WM: { hiz: .3, teknik: .25, pas: .2, sut: .15, defans: .1 },
    W:  { hiz: .42, teknik: .28, sut: .18, pas: .12 },
    ST: { sut: .52, fizik: .2, hiz: .15, teknik: .13 },
};
function calcOVRFromMains(posKey, stats) {
    const w = LEGACY_OVR_W[posFamily(posKey)] || LEGACY_OVR_W.CM;
    let v = 0; for (const k in w) v += (stats[k] || 0) * w[k];
    return _clampStat(v);
}
function calcOVRFromAttrs(posKey, attrs) {
    const c = OVR_COEF[posKey];
    if (!c) return null;
    let v = c.b || 0;
    for (const k in c.w) v += c.w[k] * (attrs[k] || 0);
    return _clampStat(v);
}
// Ana giris noktasi (her yerde kullanilir)
function calculateOVR(player) {
    if (player.attrs && Object.keys(player.attrs).length) {
        const o = calcOVRFromAttrs(player.position, player.attrs);
        if (o != null) return o;
    }
    return calcOVRFromMains(player.position, player.stats || {});
}

// Oyuncuyu bastan hesapla: ana statlar + ovr + deger
function recalcPlayer(player) {
    if (player.attrs && Object.keys(player.attrs).length) recomputeMainStats(player);
    player.ovr = calculateOVR(player);
    const prestige = (window.DB && DB.getTeam(player.teamId)) ? DB.getTeam(player.teamId).prestige : 2;
    player.value = calcMarketValue(player.ovr, player.age, prestige);
    return player;
}

if (typeof window !== 'undefined') {
    Object.assign(window, {
        STARTING_RANGES, heightWeightMods, rollStartingAttrs, recomputeMainStats,
        calcOVRFromMains, calcOVRFromAttrs, calculateOVR, recalcPlayer,
    });
}
