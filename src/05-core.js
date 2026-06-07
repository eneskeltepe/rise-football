// ============================================================================
//  05-core.js  —  Cekirdek: gameState + temel yardimcilar (takim logosu, para,
//  tarih, toast, boy/kilo modifiye) + ozel dropdown altyapisi. UI / mac motoru /
//  pazarlik / olay-baglama modulleri bu cekirdegin uzerine kurulur.
//  (2026-05-31 modulerlestirme dalgasinda cekirdek modul olarak ayristirildi.)
// ============================================================================
const NATIONALITIES = [
    { name: 'Türkiye', flag: '🇹🇷' },
    { name: 'Almanya', flag: '🇩🇪' },
    { name: 'Hollanda', flag: '🇳🇱' },
    { name: 'Fransa', flag: '🇫🇷' },
    { name: 'İngiltere', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
    { name: 'İspanya', flag: '🇪🇸' },
    { name: 'İtalya', flag: '🇮🇹' },
    { name: 'Portekiz', flag: '🇵🇹' },
    { name: 'Brezilya', flag: '🇧🇷' },
    { name: 'Arjantin', flag: '🇦🇷' },
    { name: 'Belçika', flag: '🇧🇪' },
    { name: 'Hırvatistan', flag: '🇭🇷' },
    { name: 'Danimarka', flag: '🇩🇰' },
    { name: 'İsveç', flag: '🇸🇪' },
    { name: 'Norveç', flag: '🇳🇴' },
    { name: 'İsviçre', flag: '🇨🇭' },
    { name: 'Avusturya', flag: '🇦🇹' },
    { name: 'Polonya', flag: '🇵🇱' },
    { name: 'Ukrayna', flag: '🇺🇦' },
    { name: 'İskoçya', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿' },
    { name: 'Galler', flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿' },
    { name: 'Yunanistan', flag: '🇬🇷' },
    { name: 'Romanya', flag: '🇷🇴' },
    { name: 'Sırbistan', flag: '🇷🇸' },
    { name: 'Çekya', flag: '🇨🇿' },
    { name: 'Uruguay', flag: '🇺🇾' },
    { name: 'Kolombiya', flag: '🇨🇴' },
    { name: 'Şili', flag: '🇨🇱' },
    { name: 'Meksika', flag: '🇲🇽' },
    { name: 'ABD', flag: '🇺🇸' },
    { name: 'Fas', flag: '🇲🇦' },
    { name: 'Cezayir', flag: '🇩🇿' },
    { name: 'Mısır', flag: '🇪🇬' },
    { name: 'Nijerya', flag: '🇳🇬' },
    { name: 'Senegal', flag: '🇸🇳' },
    { name: 'Kamerun', flag: '🇨🇲' },
    { name: 'Fildişi Sahili', flag: '🇨🇮' },
    { name: 'Japonya', flag: '🇯🇵' },
    { name: 'Güney Kore', flag: '🇰🇷' },
    { name: 'Avustralya', flag: '🇦🇺' }
];

// ================= BAYRAK GÖRSELLERİ =================
// Windows'ta tarayıcılar regional-indicator emoji bayraklarını render etmez (🇹🇷 → "TR").
// Emojiyi ISO ülke koduna çözüp flagcdn.com SVG görseline çeviririz. Çözülemezse emojiye düşer.
function _emojiToISO(emoji) {
    if (!emoji || typeof emoji !== 'string') return null;
    const cps = Array.from(emoji).map(c => c.codePointAt(0));
    // Alt-bölge bayrakları (İngiltere/İskoçya/Galler): siyah bayrak + tag harfleri
    if (cps[0] === 0x1F3F4) {
        const tags = cps.slice(1).filter(cp => cp >= 0xE0061 && cp <= 0xE007A)
            .map(cp => String.fromCharCode(cp - 0xE0061 + 97)).join('');
        if (tags.startsWith('gb') && tags.length === 5) return 'gb-' + tags.slice(2);   // gbeng → gb-eng
        return null;
    }
    // Regional indicator çifti → 2 harfli ISO kodu
    const ri = cps.filter(cp => cp >= 0x1F1E6 && cp <= 0x1F1FF);
    if (ri.length >= 2) return String.fromCharCode(ri[0] - 0x1F1E6 + 97) + String.fromCharCode(ri[1] - 0x1F1E6 + 97);
    return null;
}
function flagImg(emoji, cls) {
    const iso = _emojiToISO(emoji);
    if (!iso) return emoji || '';   // çözülemezse zarar vermeden emojiye düş
    return `<img class="flag-img ${cls || ''}" src="https://flagcdn.com/${iso}.svg" alt="" loading="lazy">`;
}
// Bir milliyeti (Türkçe ad ör. "Türkiye" VEYA İngilizce DB adı ör. "Turkey") bayrak emojisine çöz
function natFlagEmoji(name) {
    if (!name) return '';
    const tr = NATIONALITIES.find(n => n.name === name);
    if (tr) return tr.flag;
    if (window.DB_NATIONS && window.DB_NATIONS[name]) return window.DB_NATIONS[name];
    return '';
}
function natFlagImg(name, cls) { return flagImg(natFlagEmoji(name), cls); }

// Genel custom-dropdown kabuğu (arama opsiyonel). leagueDropdownHtml + sezon seçici bunu kullanır.
function customDropdownShell(id, extraClass, withSearch, searchPlaceholder) {
    return `<div class="custom-dropdown ${extraClass || ''}" id="${id}">
        <div class="dropdown-trigger"><span class="dropdown-selected-value"></span><i class="fa-solid fa-chevron-down"></i></div>
        <div class="dropdown-options-container">
            ${withSearch ? `<div class="dropdown-search-wrapper"><input type="text" class="dropdown-search-input" placeholder="${searchPlaceholder || 'Ara...'}" autocomplete="off"></div>` : ''}
            <div class="dropdown-options-list"></div>
        </div>
        <input type="hidden">
    </div>`;
}
// Bayraklı lig/turnuva açılır menüsü (native <select> bayrak/grup gösteremez → custom-dropdown).
function leagueDropdownHtml(id, extraClass) {
    return customDropdownShell(id, `game-league-dd ${extraClass || ''}`, true, 'Lig / turnuva ara...');
}

// KITA → ülke(kademe sıralı) → lig, + (includeCups) kıtasal turnuvalar. Grup başlıklı seçenek listesi.
const _CONTINENTS = [
    { conf: 'UEFA', name: 'AVRUPA' },
    { conf: 'CONMEBOL', name: 'GÜNEY AMERİKA' },
    { conf: 'AFC', name: 'ASYA' },
    { conf: 'CONCACAF', name: 'KUZEY AMERİKA' },
    { conf: 'CAF', name: 'AFRİKA' },
];
function buildCompetitionOptions(includeCups, startableOnly) {
    if (typeof DB === 'undefined') return [];
    const allLg = DB.leagues().filter(l => l.type === 'league' && (!startableOnly || l.startable));
    const compInfo = (typeof COMP_INFO !== 'undefined') ? COMP_INFO : (window.COMP_INFO || {});
    const userCompId = (typeof gameState !== 'undefined' && gameState && gameState.euro) ? gameState.euro.compId : null;
    const opts = [];
    const seenConf = {};
    _CONTINENTS.forEach(cont => {
        seenConf[cont.conf] = true;
        const lgs = allLg.filter(l => l.confederation === cont.conf);
        const cupsHere = includeCups ? Object.keys(compInfo).filter(k => compInfo[k].conf === cont.conf) : [];
        if (!lgs.length && !cupsHere.length) return;
        // ülkelere göre grupla; güçlü ülke (en yüksek avgPower) önce; ülke içi tier ARTAN (üst lig → alt lig)
        const byCountry = {};
        lgs.forEach(l => (byCountry[l.country] = byCountry[l.country] || []).push(l));
        const countries = Object.keys(byCountry).sort((a, b) =>
            Math.max(...byCountry[b].map(x => x.avgPower || 0)) - Math.max(...byCountry[a].map(x => x.avgPower || 0)) || a.localeCompare(b));
        opts.push({ group: true, label: cont.name });
        countries.forEach(c => {
            byCountry[c].sort((a, b) => a.tier - b.tier);
            byCountry[c].forEach(l => opts.push({ id: l.id, label: `${flagImg(l.flag)} ${l.name} <span class="ldd-country">(${l.country})</span>` }));
        });
        cupsHere.forEach(k => opts.push({ id: '__cup__' + k, label: `🏆 ${(k === userCompId) ? '⭐ ' : ''}${compInfo[k].name}` }));
    });
    // kapsanmayan konfederasyon (gelecekte eklenirse) → "DİĞER" altında
    const rest = allLg.filter(l => !seenConf[l.confederation]);
    if (rest.length) {
        opts.push({ group: true, label: 'DİĞER' });
        rest.sort((a, b) => (b.avgPower || 0) - (a.avgPower || 0)).forEach(l => opts.push({ id: l.id, label: `${flagImg(l.flag)} ${l.name} <span class="ldd-country">(${l.country})</span>` }));
    }
    return opts;
}
function wireLeagueDropdown(id, currentId, onChange, includeCups) {
    const el = document.getElementById(id);
    if (!el || typeof setupDropdown !== 'function' || typeof DB === 'undefined') return;
    setupDropdown(el, buildCompetitionOptions(includeCups), currentId);
    const hidden = el.querySelector('input[type="hidden"]');
    if (hidden && onChange) hidden.addEventListener('change', () => onChange(hidden.value));
}
// Bir lig-dropdown'un gösterilen değerini güncelle (transfer sonrası aktif lige eşitleme)
function setLeagueDropdownValue(id, lid) {
    const el = document.getElementById(id); if (!el) return;
    const hidden = el.querySelector('input[type="hidden"]'); const lbl = el.querySelector('.dropdown-selected-value');
    const lg = (typeof DB !== 'undefined') ? DB.getLeague(lid) : null;
    if (hidden) hidden.value = lid || '';
    if (lbl && lg) lbl.innerHTML = `${flagImg(lg.flag)} ${lg.name} <span class="ldd-country">(${lg.country})</span>`;
}

// Takım adından kısa rozet (logo yüklenemezse): "Galatasaray"→GAL, "Real Madrid"→RM
function _teamInitials(team) {
    const name = (team && team.name) ? String(team.name).trim() : '';
    if (!name) return ((team && team.id) || 'UNK').substring(0, 3).toUpperCase();
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0] + (words[2] ? words[2][0] : '')).toUpperCase();
    return name.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, '').substring(0, 3).toUpperCase();
}

// ================= GAME STATE =================
let gameState = {
    player: null,
    currentSeason: 2026,
    currentWeek: 1,
    fixtures: [], // Week-by-week fixtures
    standings: {}, // Team stats in the league
    matchesPlayedThisWeek: false,
    hasDoneActionThisWeek: false, // geriye dönük uyumluluk için
    actionsDoneThisWeek: 0, // Haftalık eylem hakkı sayacı (0, 1, 2)
    careerHistory: [],
    trophies: [],
    transferOffers: []
};

// ================= HELPER FUNCTIONS =================

function getTeamLogoHtml(teamId, size = 18) {
    // Serbest oyuncu kontrolü
    if (teamId === null || teamId === undefined) {
        return `<div class="team-shield-fallback" style="width: ${size}px; height: ${size}px; border-radius: 50%; background: linear-gradient(135deg, #555, #333); color: #fff; display: inline-flex; font-size: ${size * 0.38}px; font-weight: 800; align-items: center; justify-content: center; font-family: var(--font-heading); line-height: 1; vertical-align: middle;"><i class="fa-solid fa-user" style="font-size: ${size * 0.45}px;"></i></div>`;
    }
    
    const team = getTeamById(teamId);
    const shortName = _teamInitials(team);   // lig öneki yerine takım adı baş harfleri
    const color = team.color || '#333';
    
    if (team.logoUrl) {
        return `<div class="team-logo-container" style="width: ${size}px; height: ${size}px; display: inline-flex; align-items: center; justify-content: center; position: relative; vertical-align: middle;">
            <img src="${team.logoUrl}" class="team-logo-img" style="width: 100%; height: 100%; object-fit: contain;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
            <div class="team-shield-fallback" style="display: none; width: 100%; height: 100%; border-radius: 50%; background: ${color}; color: #fff; font-size: ${size * 0.38}px; font-weight: 800; align-items: center; justify-content: center; font-family: var(--font-heading); line-height: 1; text-transform: uppercase;">${shortName}</div>
        </div>`;
    } else {
        return `<div class="team-shield-fallback" style="width: ${size}px; height: ${size}px; border-radius: 50%; background: ${color}; color: #fff; display: inline-flex; font-size: ${size * 0.38}px; font-weight: 800; align-items: center; justify-content: center; font-family: var(--font-heading); line-height: 1; text-transform: uppercase; vertical-align: middle;">${shortName}</div>`;
    }
}

function formatMoney(amount) {
    if (amount >= 1000000) {
        return (amount / 1000000).toFixed(1) + 'M €';
    }
    return (amount / 1000).toFixed(0) + 'K €';
}

function getWeekDateString(weekNum) {
    // Takvim yüklüyse gerçek tarihi ver (yıl ilerler); değilse eski sabit davranış
    if (typeof calFormat === 'function' && typeof weekToDay === 'function' && gameState.seasonStartDate)
        return calFormat(weekToDay(weekNum));
    const startDate = new Date(2026, 7, 15); // 15 Ağustos 2026
    const msPerDay = 24 * 60 * 60 * 1000;
    const targetDate = new Date(startDate.getTime() + (weekNum - 1) * 7 * msPerDay);
    
    const months = [
        "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", 
        "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"
    ];
    
    const day = targetDate.getDate();
    const month = months[targetDate.getMonth()];
    const year = targetDate.getFullYear();
    
    return `${day} ${month} ${year}`;
}

// Generate double round robin schedule

// Toast Notifications
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let iconClass = 'fa-circle-info';
    if (type === 'success') iconClass = 'fa-circle-check';
    if (type === 'error') iconClass = 'fa-circle-exclamation';
    if (type === 'warning') iconClass = 'fa-triangle-exclamation';
    
    toast.innerHTML = `<i class="fa-solid ${iconClass}"></i> <span>${message}</span>`;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 3800);
}

// ================= INITIALIZE LEAGUE STANDINGS =================

// ================= LOAD / SAVE SYSTEM =================

// ================= BOY/KİLO YETENEK ETKİ HESAPLAMA =================
function getStatModifierFromHeightWeight(height, weight, pos) {
    let modifiers = { hiz: 0, fizik: 0, teknik: 0 };
    
    // Boy etkisi
    if (height > 185) {
        const diff = height - 185;
        modifiers.fizik += Math.min(8, Math.floor(diff / 2)); // boy uzadıkça fizik artar (maks +8)
        modifiers.hiz -= Math.min(8, Math.floor(diff / 2));  // boy uzadıkça hız düşer (maks -8)
        if (pos === 'Kaleci') {
            modifiers.teknik += Math.min(6, Math.floor(diff / 2.5)); // kalecilerde uzun boy kaleciliği artırır
        }
    } else if (height < 172) {
        const diff = 172 - height;
        modifiers.hiz += Math.min(8, Math.floor(diff / 1.5));  // boy kısaldıkça hız artar (maks +8)
        modifiers.fizik -= Math.min(6, Math.floor(diff / 2));  // boy kısaldıkça fizik düşer (maks -6)
    }
    
    // Kilo etkisi
    // Ideal Kilo = Boy - 100 civarıdır.
    const idealWeightDiff = weight - (height - 100);
    
    if (idealWeightDiff > 8) {
        // Fazla kilo
        modifiers.fizik += Math.min(6, Math.floor(idealWeightDiff / 3)); // kilo arttıkça fizik/güç artar
        modifiers.hiz -= Math.min(8, Math.floor(idealWeightDiff / 2.5)); // ama hız ve çeviklik düşer
    } else if (idealWeightDiff < -8) {
        // Zayıflık
        modifiers.hiz += Math.min(5, Math.floor(Math.abs(idealWeightDiff) / 3)); // hafiflik hız kazandırır
        modifiers.fizik -= Math.min(6, Math.floor(Math.abs(idealWeightDiff) / 2.5)); // ama güç düşer
    }
    
    return modifiers;
}

// ================= INITIALIZE CHARACTER CREATION =================
// ================= CUSTOM DROPDOWN MANAGEMENT =================

function setupDropdown(dropdownEl, options, defaultValue) {
    // --- Idempotent: setupCreationScreen birden cok kez cagrilabildigi icin
    //     trigger + search input'u clone-replace ile temizle (cift listener bug fix) ---
    let trigger = dropdownEl.querySelector('.dropdown-trigger');
    if (trigger) { const ft = trigger.cloneNode(true); trigger.parentNode.replaceChild(ft, trigger); trigger = ft; }
    const selectedText = dropdownEl.querySelector('.dropdown-selected-value');
    const container = dropdownEl.querySelector('.dropdown-options-container');
    const list = dropdownEl.querySelector('.dropdown-options-list');
    const hiddenInput = dropdownEl.querySelector('input[type="hidden"]');
    let searchInput = dropdownEl.querySelector('.dropdown-search-input');
    if (searchInput) { const fs = searchInput.cloneNode(true); searchInput.parentNode.replaceChild(fs, searchInput); searchInput = fs; }
    
    // Set default value
    hiddenInput.value = defaultValue;
    const defaultOption = options.find(o => o.id === defaultValue);
    selectedText.innerHTML = defaultOption ? defaultOption.label : defaultValue;
    
    // Render options (GRUP BAŞLIKLARI desteklenir: {group:true, label} → tıklanamaz ayraç)
    function renderOptions(filterText = '') {
        list.innerHTML = '';
        const f = filterText.toLowerCase();
        // Arama varken grup başlıkları gizlenir; yokken hepsi (başlık + seçenek) gösterilir
        const filtered = options.filter(o => o.group ? !f : o.label.toLowerCase().includes(f));

        if (!filtered.some(o => !o.group)) {
            const empty = document.createElement('div');
            empty.className = 'dropdown-option-empty';
            empty.style.padding = '10px 16px';
            empty.style.color = 'var(--text-muted)';
            empty.style.fontSize = '0.85rem';
            empty.textContent = 'Sonuç bulunamadı';
            list.appendChild(empty);
            return;
        }

        filtered.forEach(opt => {
            if (opt.group) {
                const h = document.createElement('div');
                h.className = 'dropdown-group-header';
                h.innerHTML = opt.label;
                list.appendChild(h);
                return;
            }
            const item = document.createElement('div');
            item.className = `dropdown-option ${hiddenInput.value === opt.id ? 'selected' : ''}`;
            item.innerHTML = opt.label;

            item.addEventListener('click', (e) => {
                e.stopPropagation();
                hiddenInput.value = opt.id;
                selectedText.innerHTML = opt.label;
                dropdownEl.classList.remove('open');
                
                // Trigger change event on hidden input to notify preview update
                const event = new Event('change', { bubbles: true });
                hiddenInput.dispatchEvent(event);
            });
            
            list.appendChild(item);
        });
    }
    
    renderOptions();
    
    // Toggle on trigger click
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        
        // Close other dropdowns
        document.querySelectorAll('.custom-dropdown').forEach(d => {
            if (d !== dropdownEl) d.classList.remove('open');
        });
        
        dropdownEl.classList.toggle('open');
        
        if (dropdownEl.classList.contains('open') && searchInput) {
            searchInput.value = '';
            renderOptions();
            setTimeout(() => searchInput.focus(), 50);
        }
    });
    
    // Search input typing
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            renderOptions(e.target.value);
        });
        searchInput.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }
}

// Global click to close custom dropdowns
document.addEventListener('click', () => {
    document.querySelectorAll('.custom-dropdown').forEach(d => d.classList.remove('open'));
});

