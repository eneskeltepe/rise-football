// ============================================================================
//  26-roles.js  —  FAZ C: FM-tarzı OYUNCU ROLLERİ + MEVKİ YETKİNLİĞİ.
//  Her mevki ailesinin spesifik rolleri vardır; her rol, önemsediği alt-özellikleri
//  (attrW) ağırlıklandırır → "rol uygunluğu" (FM yeşil daire) hesaplanır. Mevki
//  yetkinliği (Doğal/Çok İyi/Yeterli/Zayıf) oyuncunun ana + ikincil mevkilerinden gelir.
//  Saf veri/fonksiyon: DOM/IndexedDB yok. UI (profil, Faz D) ve maç yerleşimi kullanır.
//  Maç performans etkisi: mevki-dışı oyuncu _buildXI'da düşük EFEKTİF OVR ile oynar.
// ============================================================================

// Rol kataloğu — anahtar: mevki ailesi (posFamily). attrW: alt-özellik ağırlıkları.
const ROLE_CATALOG = {
    GK: [
        { key: 'gk_standart', label: 'Standart Kaleci', w: { gkRefleks: 3, gkUcus: 2, gkTopTutma: 2, gkYerTutma: 2, reaksiyon: 1 } },
        { key: 'gk_libero', label: 'Libero Kaleci', w: { gkRefleks: 2, kisaPas: 3, sogukkanlilik: 2, gkYerTutma: 1, hizlanma: 1 } },
    ],
    CB: [
        { key: 'cb_cakili', label: 'Çakılı Stoper', w: { ayaktaMudahale: 3, kafaVurusu: 2, guc: 2, pozisyonAlma: 2 } },
        { key: 'cb_pasor', label: 'Pasör Stoper', w: { uzunPas: 3, kisaPas: 2, vizyon: 2, sogukkanlilik: 2 } },
        { key: 'cb_standart', label: 'Standart Stoper', w: { ayaktaMudahale: 2, pozisyonAlma: 2, guc: 2, kafaVurusu: 1 } },
        { key: 'cb_libero', label: 'Libero', w: { topKapma: 2, kisaPas: 2, hizlanma: 2, pozisyonAlma: 2, uzunPas: 1 } },
    ],
    FB: [
        { key: 'fb_kanatbek', label: 'Kanat Bek', w: { sprintHizi: 3, dayaniklilik: 2, ortaPas: 2, topSurme: 1 } },
        { key: 'fb_cakili', label: 'Çakılı Bek', w: { ayaktaMudahale: 3, pozisyonAlma: 2, guc: 1 } },
        { key: 'fb_sahte', label: 'Sahte Bek', w: { kisaPas: 3, vizyon: 2, topKontrol: 2, pozisyonAlma: 1 } },
    ],
    DM: [
        { key: 'dm_onlibero', label: 'Ön Libero', w: { topKapma: 3, kisaPas: 2, pozisyonAlma: 2, sogukkanlilik: 1 } },
        { key: 'dm_savasci', label: 'Savaşçı Orta Saha', w: { topKapma: 3, ayaktaMudahale: 2, guc: 2, dayaniklilik: 1 } },
        { key: 'dm_kurucu', label: 'Defansif Oyun Kurucu', w: { uzunPas: 3, vizyon: 3, kisaPas: 2 } },
    ],
    CM: [
        { key: 'cm_box', label: 'İki Yönlü Orta Saha', w: { dayaniklilik: 3, kisaPas: 2, topKapma: 2, bitiricilik: 1, hizlanma: 1 } },
        { key: 'cm_mezzala', label: 'Mezzala', w: { topSurme: 2, uzaktanSut: 2, vizyon: 2, hizlanma: 1, kisaPas: 1 } },
        { key: 'cm_kurucu', label: 'Ofansif Oyun Kurucu', w: { vizyon: 3, kisaPas: 3, uzunPas: 2 } },
    ],
    AM: [
        { key: 'am_10', label: '10 Numara', w: { vizyon: 3, kisaPas: 2, topKontrol: 2, bitiricilik: 1, sogukkanlilik: 1 } },
        { key: 'am_golcu', label: 'Gölge Forvet', w: { bitiricilik: 2, pozisyonAlma: 2, topKontrol: 2, uzaktanSut: 1 } },
    ],
    W: [
        { key: 'w_ters', label: 'Ters Ayaklı Kanat', w: { bitiricilik: 2, topSurme: 2, uzaktanSut: 2, hizlanma: 2 } },
        { key: 'w_klasik', label: 'Klasik Kanat', w: { ortaPas: 3, sprintHizi: 2, topSurme: 2 } },
        { key: 'w_forvet', label: 'Kanat Forvet', w: { bitiricilik: 3, sprintHizi: 2, pozisyonAlma: 2 } },
    ],
    WM: [
        { key: 'wm_ters', label: 'Ters Ayaklı Kanat', w: { bitiricilik: 2, topSurme: 2, uzaktanSut: 2, hizlanma: 2 } },
        { key: 'wm_klasik', label: 'Klasik Kanat', w: { ortaPas: 3, sprintHizi: 2, topSurme: 2 } },
        { key: 'wm_caliskan', label: 'Çalışkan Kanat', w: { dayaniklilik: 3, ayaktaMudahale: 2, sprintHizi: 1 } },
    ],
    ST: [
        { key: 'st_komple', label: 'Komple Forvet', w: { bitiricilik: 2, kafaVurusu: 2, guc: 2, topKontrol: 2, vizyon: 1 } },
        { key: 'st_yaratici', label: 'Yaratıcı Forvet', w: { vizyon: 3, kisaPas: 2, topKontrol: 2, bitiricilik: 1 } },
        { key: 'st_caliskan', label: 'Çalışkan Forvet', w: { dayaniklilik: 3, topKapma: 2, guc: 2 } },
        { key: 'st_pivot', label: 'Pivot Forvet', w: { guc: 3, kafaVurusu: 3, topKontrol: 1 } },
        { key: 'st_firsatci', label: 'Fırsatçı Golcü', w: { bitiricilik: 3, pozisyonAlma: 3, reaksiyon: 2 } },
    ],
};

// Mevki yetkinliği seviyeleri (FM): performans çarpanı (maç motoru efektif OVR'a uygular).
const FAMILIARITY_LEVELS = {
    NAT: { key: 'NAT', label: 'Doğal', factor: 1.00 },
    ACC: { key: 'ACC', label: 'Çok İyi', factor: 0.96 },
    COMP: { key: 'COMP', label: 'Yeterli', factor: 0.90 },
    AWK: { key: 'AWK', label: 'Zayıf', factor: 0.82 },
};

function rolesForFamily(fam) { return ROLE_CATALOG[fam] || []; }
function findRole(roleKey) {
    for (const fam in ROLE_CATALOG) { const r = ROLE_CATALOG[fam].find(x => x.key === roleKey); if (r) return r; }
    return null;
}
// Rol uygunluğu: oyuncunun alt-özelliklerinin rol ağırlıklı ortalaması (0-99 attr ölçeği).
function roleSuitability(player, roleKey) {
    const role = findRole(roleKey); const attrs = player && player.attrs;
    if (!role || !attrs) return 0;
    let sum = 0, wsum = 0;
    for (const k in role.w) { const w = role.w[k]; sum += (attrs[k] != null ? attrs[k] : 50) * w; wsum += w; }
    return wsum ? Math.round(sum / wsum) : 0;
}
// FM "yeşil daire": uygunluğu 0.5..5 yıldıza çevir.
function roleStars(player, roleKey) {
    const s = roleSuitability(player, roleKey);
    return Math.max(0.5, Math.min(5, Math.round((s / 99 * 5) * 2) / 2));
}
// Oyuncunun mevkisine (ailesine) göre EN UYGUN rolü bul.
function bestRoleForPlayer(player) {
    const fam = (typeof posFamily === 'function') ? posFamily(player.pos || player.position) : null;
    const roles = ROLE_CATALOG[fam] || [];
    let best = null, bestS = -1;
    for (const r of roles) { const s = roleSuitability(player, r.key); if (s > bestS) { bestS = s; best = r; } }
    return best ? { roleKey: best.key, label: best.label, suit: bestS, stars: roleStars(player, best.key) } : null;
}
// Mevki yetkinliği: hedef mevki (POSITIONS anahtarı) için Doğal/Çok İyi/Yeterli/Zayıf.
function positionFamiliarity(player, posKey) {
    const nat = player.pos || player.position;
    if (!nat || !posKey) return FAMILIARITY_LEVELS.AWK;
    if (nat === posKey) return FAMILIARITY_LEVELS.NAT;
    const alt = player.altPos || [];
    if (alt.indexOf(posKey) >= 0) return FAMILIARITY_LEVELS.ACC;
    const pf = (typeof posFamily === 'function') ? posFamily(nat) : null;
    const tf = (typeof posFamily === 'function') ? posFamily(posKey) : null;
    if (pf && tf && pf === tf) return FAMILIARITY_LEVELS.COMP;
    return FAMILIARITY_LEVELS.AWK;
}
// Bir oyuncunun OYNAYABİLDİĞİ tüm mevkiler + yetkinlik (profil grid için).
function playerPositionsFamiliarity(player) {
    const out = [];
    const seen = {};
    const add = (pos) => { if (!pos || seen[pos]) return; seen[pos] = 1; out.push({ pos: pos, fam: positionFamiliarity(player, pos) }); };
    add(player.pos || player.position);
    (player.altPos || []).forEach(add);
    return out;
}

// affinity (0..1) → mevki-yetkinliği çarpanı (maç motoru _buildXI kullanır; doğal=1.0).
function familiarityFactorFromAffinity(aff) {
    if (aff >= 1.0) return FAMILIARITY_LEVELS.NAT.factor;
    if (aff >= 0.8) return FAMILIARITY_LEVELS.ACC.factor;
    if (aff >= 0.5) return FAMILIARITY_LEVELS.COMP.factor;
    if (aff > 0) return FAMILIARITY_LEVELS.AWK.factor;
    return 0.78;   // affinitesi sıfır (acil/zoraki) → ciddi düşüş
}

if (typeof window !== 'undefined') {
    Object.assign(window, {
        ROLE_CATALOG, FAMILIARITY_LEVELS,
        rolesForFamily, findRole, roleSuitability, roleStars, bestRoleForPlayer,
        positionFamiliarity, playerPositionsFamiliarity, familiarityFactorFromAffinity,
    });
}
