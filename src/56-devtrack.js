// ============================================================================
//  56-devtrack.js  —  Gelisim takibi: antrenman/sezon anlik goruntuleri (snapshot)
//  + filtrelenebilir gelisim ekrani (ana stat zaman serisi + olay listesi).
// ============================================================================

// Bir gelisim anlik goruntusu kaydet (kaynak: 'antrenman' | 'sezon' | 'başlangıç')
function recordDevSnapshot(p, src, note) {
    if (!p) return;
    if (!p.trainingHistory) p.trainingHistory = [];
    const s = p.stats || {};
    const prev = p.trainingHistory[p.trainingHistory.length - 1];
    const main = {};
    MAIN_STAT_KEYS.forEach(k => { main[k] = Math.round(s[k] || 0); });
    p.trainingHistory.push({
        season: gameState.currentSeason, week: gameState.currentWeek,
        src: src || 'antrenman', note: note || '',
        ovr: p.ovr, main, ovrDelta: prev ? (p.ovr - prev.ovr) : 0,
    });
    if (p.trainingHistory.length > 250) p.trainingHistory.shift();
}

window._devFilter = 'ovr';     // 'ovr' veya ana stat anahtari
window._devRange = 'all';      // '1m'|'3m'|'6m'|'1y'|'5y'|'all'|<yıl>

// Zaman aralığı seçenekleri (hafta-bazlı; 1 sezon ≈ 38 hafta). Ek olarak dinamik YIL çipleri.
const _DEV_RANGES = [
    { k: '1m', l: 'Son 1 Ay', weeks: 4 }, { k: '3m', l: 'Son 3 Ay', weeks: 13 }, { k: '6m', l: 'Son 6 Ay', weeks: 26 },
    { k: '1y', l: 'Son 1 Yıl', weeks: 38 }, { k: '5y', l: 'Son 5 Yıl', weeks: 190 }, { k: 'all', l: 'Tümü', weeks: 0 },
];
function _devInRange(hist) {
    const r = window._devRange || 'all';
    if (!hist.length || r === 'all') return hist;
    if (/^\d{4}$/.test(String(r))) return hist.filter(h => h.season === +r);   // belirli yıl/sezon
    if (r === 'season') return hist.filter(h => h.season === gameState.currentSeason);   // geriye uyum
    const def = _DEV_RANGES.find(x => x.k === r);
    if (!def || !def.weeks) return hist;
    const SW = 38, START = (typeof START_SEASON !== 'undefined') ? START_SEASON : 2026;
    const abs = h => (h.season - START) * SW + (h.week || 0);
    const maxAbs = abs(hist[hist.length - 1]);
    return hist.filter(h => abs(h) >= maxAbs - def.weeks);
}

const _DEV_COLORS = { ovr: '#00e676', hiz: '#00b0ff', sut: '#ef5350', pas: '#ffca28', teknik: '#ab47bc', defans: '#26a69a', fizik: '#ff7043' };
function _devLabel(key) { if (key === 'ovr') return 'GENEL (OVR)'; const m = MAIN_STATS.find(s => s.key === key); return m ? m.label : key; }
function _devVal(h, key) { return key === 'ovr' ? h.ovr : (h.main ? (h.main[key] || 0) : 0); }

// Basit SVG sparkline (zaman serisi)
function _devChart(vals, color) {
    if (!vals.length) return '<div class="dev-chart-empty">Bu aralıkta gösterilecek veri yok.</div>';
    const W = 520, H = 120, pad = 10;
    const min = Math.min(...vals), max = Math.max(...vals);
    const span = Math.max(1, max - min);
    const n = vals.length;
    const x = i => pad + (n === 1 ? (W - 2 * pad) / 2 : i * (W - 2 * pad) / (n - 1));
    const y = v => H - pad - ((v - min) / span) * (H - 2 * pad);
    const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = `${pad},${H - pad} ${pts} ${x(n - 1).toFixed(1)},${H - pad}`;
    const dots = vals.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.6" fill="${color}"/>`).join('');
    return `<svg class="dev-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <polygon points="${area}" fill="${color}" opacity="0.13"/>
        <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.2"/>
        ${dots}
        <text x="${pad}" y="15" class="dev-chart-lbl">${max}</text>
        <text x="${pad}" y="${H - pad - 1}" class="dev-chart-lbl">${min}</text>
    </svg>`;
}

function renderDevTrack() {
    const host = document.getElementById('dev-track-content');
    if (!host || !gameState.player) return;
    const p = gameState.player;
    const hist = p.trainingHistory || [];

    if (hist.length < 2) {
        host.innerHTML = `<p class="dev-empty"><i class="fa-solid fa-seedling"></i>
            Henüz yeterli gelişim verisi yok. Antrenman yaptıkça ve sezonlar geçtikçe yeteneklerinin
            zaman içindeki değişimini burada filtreleyerek takip edebileceksin.</p>`;
        return;
    }

    const first = hist[0], last = hist[hist.length - 1];

    // ---- Özet kartları: başlangıç -> güncel (OVR + 6 ana stat) ----
    const summary = ['ovr', ...MAIN_STAT_KEYS].map(k => {
        const a = _devVal(first, k), b = _devVal(last, k), d = b - a;
        const cls = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
        const sign = d > 0 ? '+' : '';
        return `<div class="dev-sum-box ${k === _devFilter ? 'active' : ''}" data-stat="${k}">
            <span class="dev-sum-lbl">${k === 'ovr' ? 'OVR' : _devLabel(k)}</span>
            <span class="dev-sum-val">${b}</span>
            <span class="dev-sum-delta ${cls}">${sign}${d}</span>
        </div>`;
    }).join('');

    // ---- Filtre: zaman aralığı (son 1ay/3ay/6ay/1yıl/5yıl/tümü + dinamik yıl çipleri) ----
    const _years = [...new Set(hist.map(h => h.season))].sort((a, b) => b - a);
    const yearChips = _years.map(y => `<button class="dev-range-chip ${String(window._devRange) === String(y) ? 'active' : ''}" data-range="${y}">${y}/${String((y + 1) % 100).padStart(2, '0')}</button>`).join('');
    const rangeChips = _DEV_RANGES.map(rg => `<button class="dev-range-chip ${window._devRange === rg.k ? 'active' : ''}" data-range="${rg.k}">${rg.l}</button>`).join('') + yearChips;

    // ---- Seçili stat + aralığa göre veri ----
    const ranged = _devInRange(hist);
    const series = ranged.map(h => _devVal(h, _devFilter));
    const color = _DEV_COLORS[_devFilter] || '#00e676';
    const chart = _devChart(series, color);

    // ---- Olay listesi (en yeni üstte) ----
    const rows = ranged.slice().reverse().map(h => {
        const v = _devVal(h, _devFilter);
        const srcIcon = h.src === 'sezon' ? 'fa-calendar-check' : h.src === 'başlangıç' ? 'fa-flag-checkered' : 'fa-dumbbell';
        const dCls = h.ovrDelta > 0 ? 'up' : h.ovrDelta < 0 ? 'down' : 'flat';
        const dTxt = h.ovrDelta > 0 ? `+${h.ovrDelta}` : `${h.ovrDelta}`;
        return `<div class="dev-row">
            <span class="dev-row-when">S${h.season} • H${h.week}</span>
            <span class="dev-row-note"><i class="fa-solid ${srcIcon}"></i> ${h.note || h.src}</span>
            <span class="dev-row-stat">${_devLabel(_devFilter)}: <strong>${v}</strong></span>
            <span class="dev-row-ovr">OVR ${h.ovr} <span class="dev-row-delta ${dCls}">${dTxt}</span></span>
        </div>`;
    }).join('');

    host.innerHTML = `
        <div class="dev-summary-grid">${summary}</div>
        <div class="dev-controls">
            <span class="dev-controls-lbl"><i class="fa-solid fa-chart-line"></i> ${_devLabel(_devFilter)} gelişimi</span>
            <div class="dev-range-chips">${rangeChips}</div>
        </div>
        <div class="dev-chart-wrap">${chart}</div>
        <div class="dev-rows">${rows}</div>`;

    // ---- Etkileşim ----
    host.querySelectorAll('.dev-sum-box').forEach(el => el.addEventListener('click', () => {
        window._devFilter = el.getAttribute('data-stat'); renderDevTrack();
    }));
    host.querySelectorAll('.dev-range-chip').forEach(el => el.addEventListener('click', () => {
        window._devRange = el.getAttribute('data-range'); renderDevTrack();
    }));
}

if (typeof window !== 'undefined') {
    Object.assign(window, { recordDevSnapshot, renderDevTrack, _devChart });
}
