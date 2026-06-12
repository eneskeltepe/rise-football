// ============================================================================
//  57-search.js — FM-tarzı arama sistemi + yeniden-kullanılabilir takım kadrosu önizleme
//  - openTeamSquad(teamId): bir takımın kadrosunu modalda gösterir
//        (yeni-kariyer "kadroyu önizle" butonu + arama sonucu takım tıklaması ortak kullanır).
//  - openGlobalSearch(): kariyer içi global arama — TAKIM (ad/ülke/stadyum) + OYUNCU (ad/millet).
//  Veri: takımlar/stadyumlar bellekte (DB.teams); oyuncular lazy (DB.ensureLeagues → tek seferlik).
//  Eşleşme Türkçe-duyarsız + Türkçe→İngilizce ülke alias'ı ("Türkiye" → Turkey takımları).
// ============================================================================

// ---- Metin normalizasyonu (Türkçe + aksan duyarsız) ----
function _srchNorm(s) {
    return (s == null ? '' : String(s)).toLocaleLowerCase('tr')
        .replace(/ı/g, 'i').replace(/i̇/g, 'i')
        .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .trim();
}
function _srchEsc(s) {
    return (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Veride ülke/millet adları İNGİLİZCE (Turkey, Spain…). Kullanıcı Türkçe yazabilir → alias.
const _TR_COUNTRY = {
    'turkiye': 'turkey', 'ispanya': 'spain', 'almanya': 'germany', 'ingiltere': 'england',
    'fransa': 'france', 'italya': 'italy', 'hollanda': 'holland', 'portekiz': 'portugal',
    'yunanistan': 'greece', 'belcika': 'belgium', 'isvicre': 'switzerland', 'isvec': 'sweden',
    'norvec': 'norway', 'danimarka': 'denmark', 'avusturya': 'austria', 'cin': 'china pr',
    'amerika': 'united states', 'abd': 'united states', 'arjantin': 'argentina', 'brezilya': 'brazil',
    'suudi arabistan': 'saudi arabia', 'suudi': 'saudi arabia', 'cek cumhuriyeti': 'czech republic',
    'cekya': 'czech republic', 'ukrayna': 'ukraine', 'hirvatistan': 'croatia',
    'guney kore': 'korea republic', 'kore': 'korea republic', 'iskocya': 'scotland',
    'polonya': 'poland', 'romanya': 'romania', 'macaristan': 'hungary',
    'birlesik arap emirlikleri': 'united arab emirates', 'bae': 'united arab emirates',
    'kibris': 'cyprus', 'azerbaycan': 'azerbaijan', 'sili': 'chile', 'finlandiya': 'finland',
    'avustralya': 'australia', 'irlanda': 'republic of ireland', 'hindistan': 'india',
    'guney amerika': 'south america'
};
function _trCountryAlias(q) {
    if (q.length < 2) return null;
    if (_TR_COUNTRY[q]) return _TR_COUNTRY[q];
    for (const k in _TR_COUNTRY) { if (k === q || k.startsWith(q)) return _TR_COUNTRY[k]; }
    return null;
}

// ---- İndeksler ----
let _gsTeamIdx = null;      // [{t, lg, n, country, stadium, stadiumRaw}]
let _gsPlayerIdx = null;    // [{p, n, nat}]  (lazy)
let _gsPlayerPromise = null;
let _gsPlayerLoading = false;

function _buildTeamIdx() {
    // Her açılışta tazele (terfi/kümeyle lig değişebilir; 644 takım ucuz)
    _gsTeamIdx = (DB.teams() || []).map(t => {
        const lg = DB.getLeague(t.leagueId) || {};
        const st = (t.stadium && t.stadium.name) || '';
        return { t, lg, n: _srchNorm(t.name), country: _srchNorm(lg.country), stadium: _srchNorm(st), stadiumRaw: st };
    });
    return _gsTeamIdx;
}
function _ensurePlayerIdx() {
    if (_gsPlayerIdx) return Promise.resolve(_gsPlayerIdx);
    if (_gsPlayerPromise) return _gsPlayerPromise;
    _gsPlayerLoading = true;
    const ids = (DB.leagues() || []).filter(l => l.type === 'league').map(l => l.id);
    _gsPlayerPromise = DB.ensureLeagues(ids).then(() => {
        const all = DB.loadedPlayersSync() || [];
        _gsPlayerIdx = all.map(p => ({ p, n: _srchNorm(p.name), nat: _srchNorm(p.nation) }));
        _gsPlayerLoading = false;
        return _gsPlayerIdx;
    }).catch(() => { _gsPlayerLoading = false; _gsPlayerIdx = []; return _gsPlayerIdx; });
    return _gsPlayerPromise;
}

// ---- Pozisyon sıralama (kadro görünümü: kaleci → defans → orta → forvet) ----
function _posRank(pos) {
    if (pos === 'Kaleci') return 0;
    if (pos === 'Stoper' || pos === 'Sağ Bek' || pos === 'Sol Bek') return 1;
    if (pos === 'DOS' || pos === 'Merkez OS' || pos === 'Ofansif OS') return 2;
    return 3;   // kanatlar + santrfor
}
function _ovrBadgeHtml(ovr) {
    ovr = ovr || 0;
    let c = '#8a8f98';
    if (ovr >= 85) c = '#16a34a'; else if (ovr >= 78) c = '#22c55e';
    else if (ovr >= 70) c = '#eab308'; else if (ovr >= 60) c = '#f97316';
    return `<span class="gs-ovr" style="background:${c};">${ovr}</span>`;
}

// ============================================================================
//  TAKIM KADROSU ÖNİZLEME MODALI
// ============================================================================
async function openTeamSquad(teamId) {
    const modal = document.getElementById('team-squad-modal');
    const body = document.getElementById('team-squad-body');
    if (!modal || !body) return;
    const team = DB.getTeam(teamId);
    if (!team) { if (typeof showToast === 'function') showToast('Takım bulunamadı.', 'error'); return; }

    body.innerHTML = `<div class="tsquad-loading"><i class="fa-solid fa-spinner fa-spin"></i> Kadro yükleniyor…</div>`;
    modal.style.display = 'flex';
    if (typeof bringModalToFront === 'function') bringModalToFront(modal);
    _bindTeamSquadOnce();

    await DB.loadPlayers(team.srcLeague || team.leagueId);
    // Kullanıcı bu sırada başka takım açtıysa / kapattıysa eski sonucu basma
    if (modal.style.display === 'none' || modal.getAttribute('data-team') && modal.getAttribute('data-team') !== String(teamId)) { /* yine de basacağız, son istek kazanır */ }
    modal.setAttribute('data-team', String(teamId));

    const lg = DB.getLeague(team.leagueId) || {};
    const inCareer = !!(typeof gameState !== 'undefined' && gameState && gameState.player);
    // Sezonlar geçtikçe yaş/OVR yaş-düzeltilmiş gösterilir (kadro modalı/profil ile tutarlı;
    // eskiden ham 2026 değerleri gösteriliyordu). Youth/regen kendi sisteminde yaşlanır → ham.
    const _seasonsEl = inCareer ? ((gameState.currentSeason || START_SEASON) - START_SEASON) : 0;
    const _dispAge = (p) => (p.isYouth || p.isRegen) ? (p.age || 17) : (p.age || 0) + _seasonsEl;
    const _dispOvr = (p) => (typeof ageAdjustedOvr === 'function' && _seasonsEl) ? ageAdjustedOvr(p, _seasonsEl) : (p.ovr || 0);
    const squad = (DB.squadSync(teamId) || []).slice().map(p => Object.assign({}, p, { ovr: _dispOvr(p), age: p.age ? _dispAge(p) : p.age }));
    // Kullanıcı KENDİ kulübünün kadrosunu açtıysa kendini de ekle (squadSync user'ı içermez → "kendimi göremiyorum").
    if (inCareer && String(gameState.player.teamId) === String(teamId)) {
        const u = gameState.player;
        squad.unshift({ id: 'USER', name: `${u.firstname || ''} ${u.lastname || ''}`.trim() || 'Sen', pos: u.position, ovr: u.ovr, age: u.age, nation: u.nationality, img: u.img, teamId: teamId, _isUser: true });
    }
    squad.sort((a, b) => (_posRank(a.pos) - _posRank(b.pos)) || ((b.ovr || 0) - (a.ovr || 0)));

    const cnt = squad.length;
    const avg = cnt ? Math.round(squad.reduce((s, p) => s + (p.ovr || 0), 0) / cnt) : 0;
    const best = cnt ? squad.reduce((m, p) => (p.ovr || 0) > (m.ovr || 0) ? p : m, squad[0]) : null;
    const flagLg = (lg.flag && typeof flagImg === 'function') ? flagImg(lg.flag) : '';
    const stad = (team.stadium && team.stadium.name) ? team.stadium.name : '—';
    const stadCap = (team.stadium && team.stadium.capacity) ? ` (${Number(team.stadium.capacity).toLocaleString('tr-TR')})` : '';

    const head = `
        <div class="ts-head">
            <div class="ts-logo">${(typeof getTeamLogoHtml === 'function') ? getTeamLogoHtml(team.id, 46) : ''}</div>
            <div class="ts-head-info">
                <h2>${_srchEsc(team.name)}</h2>
                <div class="ts-sub">${flagLg} ${_srchEsc(lg.name || '')} <span class="ts-country">${_srchEsc(lg.country || '')}</span></div>
                <div class="ts-sub ts-stad"><i class="fa-solid fa-location-dot"></i> ${_srchEsc(stad)}${stadCap}</div>
            </div>
            <button class="btn-close" id="btn-close-team-squad" title="Kapat"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="ts-metrics">
            <div class="ts-metric"><span>Kadro</span><b>${cnt}</b></div>
            <div class="ts-metric"><span>Ortalama OVR</span><b>${avg}</b></div>
            <div class="ts-metric"><span>En İyi</span><b>${best ? (best.ovr || 0) : '—'}</b></div>
            <div class="ts-metric"><span>Güç</span><b>${team.power || '—'}</b></div>
        </div>`;

    let rows;
    if (!cnt) {
        rows = `<div class="tsquad-loading">Bu takım için oyuncu verisi bulunamadı.</div>`;
    } else {
        rows = `<div class="ts-list scroll-thin">` + squad.map(p => {
            const flag = (typeof natFlagImg === 'function') ? natFlagImg(p.nation) : '';
            const pid = p._isUser ? 'USER' : p.id;
            return `<div class="ts-row${p._isUser ? ' ts-row-me' : ''}" ${inCareer ? `data-pid="${_srchEsc(pid)}" data-pteam="${_srchEsc(p.teamId || team.id)}"` : ''}>
                ${_faceHtml(p.img, p.name, 28)}
                <span class="ts-pos">${_srchEsc(p.pos || '')}</span>
                <span class="ts-name">${_srchEsc(p.name)}${p._isUser ? ' <span class="ts-me-tag">SEN</span>' : ''}</span>
                <span class="ts-nat">${flag} ${_srchEsc(p.nation || '')}</span>
                <span class="ts-age">${p.age || '—'}</span>
                ${_ovrBadgeHtml(p.ovr)}
            </div>`;
        }).join('') + `</div>`;
    }
    body.innerHTML = head + ((typeof _finBlockHtml === 'function') ? _finBlockHtml(team) : '') + `<div id="tsquad-honors"></div>` + rows;
    // Kulüp başarıları (lig şampiyonlukları + kıta kupaları) — async doldurulur (48-awards)
    if (inCareer && typeof fillHonorsBlock === 'function' && typeof computeClubHonors === 'function')
        fillHonorsBlock('tsquad-honors', computeClubHonors(gameState._slot, team.id), 'Kulüp Başarıları');
}
// Kulüp finans bloğu (kasa + sezon gelir/gider kırılımı + net) — 53-finance'tan. Henüz hesaplaşmadıysa tahmini.
function _finBlockHtml(team) {
    if (typeof _finOf !== 'function' || !team) return '';
    const f = _finOf(team.id);
    const settled = !!(f.rev && f.rev.gate > 0);
    let rev, exp;
    if (settled) { rev = f.rev; exp = f.exp; }
    else {
        const mid = Math.ceil((((DB.getLeague(team.leagueId) || {}).teamCount) || 18) / 2);
        const er = (typeof _estRevenue === 'function') ? _estRevenue(team, mid) : { gate: 0, tv: 0, prize: 0, sponsor: 0 };
        rev = { gate: er.gate, tv: er.tv, prize: er.prize, sponsor: er.sponsor, sales: 0 };
        exp = { wages: (typeof _estWages === 'function') ? _estWages(team) : 0, ops: (typeof _estOps === 'function') ? _estOps(team) : 0, transfers: 0 };
    }
    const totRev = rev.gate + rev.tv + rev.prize + rev.sponsor + (rev.sales || 0);
    const totExp = exp.wages + exp.ops + (exp.transfers || 0);
    const net = totRev - totExp;
    const M = v => (typeof formatMoney === 'function') ? formatMoney(v) : String(v);
    const line = (lbl, v) => `<div class="fin-line"><span>${lbl}</span><b>${M(v)}</b></div>`;
    return `<div class="ts-finance">
        <div class="fin-head"><span><i class="fa-solid fa-sack-dollar"></i> Finans</span>
            <span class="fin-bal ${f.balance < 0 ? 'neg' : ''}">Kasa: ${M(f.balance)}</span>${settled ? '' : ' <span class="fin-est">(tahmini)</span>'}</div>
        <div class="fin-grid">
            <div class="fin-col"><div class="fin-col-h">Gelir</div>${line('Bilet/Maç', rev.gate)}${line('Yayın', rev.tv)}${line('Ödül', rev.prize)}${line('Sponsor', rev.sponsor)}${rev.sales ? line('Satış', rev.sales) : ''}</div>
            <div class="fin-col"><div class="fin-col-h">Gider</div>${line('Maaşlar', exp.wages)}${line('İşletme', exp.ops)}${exp.transfers ? line('Bonservis', exp.transfers) : ''}</div>
        </div>
        <div class="fin-net">Sezon Net: <b class="${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : ''}${M(net)}</b></div>
    </div>`;
}
// Oyuncu yüz görseli (foto + yoksa baş harf rozeti) — arama sonucu + kadro satırı ortak.
function _faceHtml(img, name, size) {
    size = size || 30;
    const init = (name || '?').trim().charAt(0).toUpperCase();
    if (img) return `<span class="gs-face" style="width:${size}px;height:${size}px;"><img src="${_srchEsc(img)}" onerror="this.style.display='none';this.parentNode.classList.add('noimg');" alt=""><span class="gs-face-i">${init}</span></span>`;
    return `<span class="gs-face noimg" style="width:${size}px;height:${size}px;"><span class="gs-face-i">${init}</span></span>`;
}
function _closeTeamSquad() {
    const m = document.getElementById('team-squad-modal');
    if (m) { m.style.display = 'none'; m.removeAttribute('data-team'); }
}
let _tsBound = false;
function _bindTeamSquadOnce() {
    if (_tsBound) return; _tsBound = true;
    const modal = document.getElementById('team-squad-modal');
    const body = document.getElementById('team-squad-body');
    if (!modal || !body) { _tsBound = false; return; }
    modal.addEventListener('click', e => { if (e.target === modal) _closeTeamSquad(); });
    body.addEventListener('click', e => {
        if (e.target.closest('#btn-close-team-squad')) { _closeTeamSquad(); return; }
        const row = e.target.closest('.ts-row[data-pid]');
        if (row && typeof openPlayerProfile === 'function') {
            openPlayerProfile(row.getAttribute('data-pid'), row.getAttribute('data-pteam'));
        }
    });
}

// ============================================================================
//  GLOBAL ARAMA MODALI
// ============================================================================
function openGlobalSearch() {
    const modal = document.getElementById('global-search-modal');
    const input = document.getElementById('global-search-input');
    if (!modal || !input) return;
    _buildTeamIdx();
    _bindGlobalSearchOnce();
    modal.style.display = 'flex';
    if (typeof bringModalToFront === 'function') bringModalToFront(modal);
    input.value = '';
    _renderSearchResults('');
    setTimeout(() => input.focus(), 50);
    // Oyuncuları arka planda yükle (ilk açılış); bittiğinde mevcut sorguyu tazele
    if (!_gsPlayerIdx) _ensurePlayerIdx().then(() => {
        if (modal.style.display !== 'none') _renderSearchResults(input.value);
    });
}
function closeGlobalSearch() {
    const m = document.getElementById('global-search-modal');
    if (m) m.style.display = 'none';
}
let _gsBound = false;
function _bindGlobalSearchOnce() {
    if (_gsBound) return; _gsBound = true;
    const modal = document.getElementById('global-search-modal');
    const input = document.getElementById('global-search-input');
    const results = document.getElementById('global-search-results');
    const closeBtn = document.getElementById('btn-close-global-search');
    if (!modal || !input || !results) { _gsBound = false; return; }
    input.addEventListener('input', () => _renderSearchResults(input.value));
    input.addEventListener('keydown', e => { if (e.key === 'Escape') closeGlobalSearch(); });
    if (closeBtn) closeBtn.addEventListener('click', closeGlobalSearch);
    modal.addEventListener('click', e => { if (e.target === modal) closeGlobalSearch(); });
    results.addEventListener('click', e => {
        const tEl = e.target.closest('[data-team]');
        if (tEl) { openTeamSquad(tEl.getAttribute('data-team')); return; }
        const pEl = e.target.closest('[data-pid]');
        if (pEl && typeof openPlayerProfile === 'function') {
            openPlayerProfile(pEl.getAttribute('data-pid'), pEl.getAttribute('data-pteam'));
        }
    });
}

const _GS_TEAM_MAX = 24, _GS_PLAYER_MAX = 40;
function _renderSearchResults(raw) {
    const results = document.getElementById('global-search-results');
    const hint = document.getElementById('global-search-hint');
    if (!results) return;
    const q = _srchNorm(raw);
    if (q.length < 2) {
        results.innerHTML = '';
        if (hint) hint.style.display = '';
        return;
    }
    if (hint) hint.style.display = 'none';

    // --- TAKIMLAR ---
    const alias = _trCountryAlias(q);
    const teamHits = [];
    for (const r of (_gsTeamIdx || [])) {
        let why = null;
        if (r.n.includes(q)) why = 'name';
        else if (r.stadium && r.stadium.includes(q)) why = 'stadium';
        else if (r.country.includes(q) || (alias && r.country.includes(alias))) why = 'country';
        if (why) teamHits.push({ r, why });
    }
    teamHits.sort((a, b) => {
        const aw = a.why === 'name' ? 0 : 1, bw = b.why === 'name' ? 0 : 1;
        return (aw - bw) || ((b.r.t.prestige || b.r.t.power || 0) - (a.r.t.prestige || a.r.t.power || 0));
    });

    // --- OYUNCULAR ---
    // OVR rozeti yaş-düzeltilmiş gösterilir (profil/kadro ile tutarlı; ham 2026 değeri değil)
    const _se = (typeof gameState !== 'undefined' && gameState && gameState.player)
        ? ((gameState.currentSeason || START_SEASON) - START_SEASON) : 0;
    const _adjOvr = (p) => (_se && typeof ageAdjustedOvr === 'function') ? ageAdjustedOvr(p, _se) : (p.ovr || 0);
    const playerHits = [];
    if (_gsPlayerIdx) {
        for (const r of _gsPlayerIdx) {
            if (r.n.includes(q) || (q.length >= 3 && r.nat.includes(q)) || (alias && r.nat.includes(alias))) playerHits.push(r);
        }
        playerHits.sort((a, b) => (b.p.ovr || 0) - (a.p.ovr || 0));
    }

    let html = '';
    // Takımlar bloğu
    html += `<div class="gs-group-title"><i class="fa-solid fa-shield-halved"></i> Takımlar <span>${teamHits.length}</span></div>`;
    if (!teamHits.length) {
        html += `<div class="gs-empty">Eşleşen takım yok.</div>`;
    } else {
        html += teamHits.slice(0, _GS_TEAM_MAX).map(({ r, why }) => {
            const logo = (typeof getTeamLogoHtml === 'function') ? getTeamLogoHtml(r.t.id, 22) : '';
            const flag = (r.lg.flag && typeof flagImg === 'function') ? flagImg(r.lg.flag) : '';
            const extra = why === 'stadium' ? ` <span class="gs-why"><i class="fa-solid fa-location-dot"></i> ${_srchEsc(r.stadiumRaw)}</span>` : '';
            return `<div class="gs-row gs-team" data-team="${_srchEsc(r.t.id)}">
                <span class="gs-logo">${logo}</span>
                <span class="gs-main">${_srchEsc(r.t.name)}${extra}</span>
                <span class="gs-meta">${flag} ${_srchEsc(r.lg.name || r.lg.country || '')}</span>
            </div>`;
        }).join('');
        if (teamHits.length > _GS_TEAM_MAX) html += `<div class="gs-more">+${teamHits.length - _GS_TEAM_MAX} takım daha…</div>`;
    }

    // Oyuncular bloğu (KULLANICI dahil — kendini de aratabilsin)
    const _u = (typeof gameState !== 'undefined' && gameState && gameState.player) ? gameState.player : null;
    const _uName = _u ? `${_u.firstname || ''} ${_u.lastname || ''}`.trim() : '';
    const _userHit = (_u && _uName && _srchNorm(_uName).includes(q)) ? _u : null;
    const _userRow = _userHit ? `<div class="gs-row gs-player gs-row-me" data-pid="USER" data-pteam="${_srchEsc(_userHit.teamId)}">
            ${_faceHtml(_userHit.img, _uName, 30)}
            <span class="gs-main">${_srchEsc(_uName)} <span class="gs-pos">${_srchEsc(_userHit.position || '')}</span> <span class="ts-me-tag">SEN</span></span>
            <span class="gs-meta">${(typeof natFlagImg === 'function') ? natFlagImg(_userHit.nationality) : ''} ${_srchEsc(_userHit.teamName || '')}</span>
            ${_ovrBadgeHtml(_userHit.ovr)}
        </div>` : '';
    if (!_gsPlayerIdx) {
        html += `<div class="gs-group-title"><i class="fa-solid fa-user"></i> Oyuncular</div>`;
        html += _userRow + `<div class="gs-empty"><i class="fa-solid fa-spinner fa-spin"></i> Oyuncular yükleniyor…</div>`;
    } else {
        const _totalP = playerHits.length + (_userHit ? 1 : 0);
        html += `<div class="gs-group-title"><i class="fa-solid fa-user"></i> Oyuncular <span>${_totalP}</span></div>`;
        if (!_totalP) {
            html += `<div class="gs-empty">Eşleşen oyuncu yok.</div>`;
        } else {
            html += _userRow + playerHits.slice(0, _GS_PLAYER_MAX).map(({ p }) => {
                const team = DB.getTeam(p.teamId) || {};
                const flag = (typeof natFlagImg === 'function') ? natFlagImg(p.nation) : '';
                return `<div class="gs-row gs-player" data-pid="${_srchEsc(p.id)}" data-pteam="${_srchEsc(p.teamId)}">
                    ${_faceHtml(p.img, p.name, 30)}
                    <span class="gs-main">${_srchEsc(p.name)} <span class="gs-pos">${_srchEsc(p.pos || '')}</span></span>
                    <span class="gs-meta">${flag} ${_srchEsc(team.name || '')}</span>
                    ${_ovrBadgeHtml(_adjOvr(p))}
                </div>`;
            }).join('');
            if (playerHits.length > _GS_PLAYER_MAX) html += `<div class="gs-more">+${playerHits.length - _GS_PLAYER_MAX} oyuncu daha… (aramayı daralt)</div>`;
        }
    }

    results.innerHTML = html;
}

if (typeof window !== 'undefined') {
    window.openTeamSquad = openTeamSquad;
    window.openGlobalSearch = openGlobalSearch;
    window.closeGlobalSearch = closeGlobalSearch;
}
