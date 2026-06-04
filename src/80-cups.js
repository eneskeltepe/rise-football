// ============================================================================
//  80-cups.js  —  Uluslararasi kupalar (kitasal). Lig mantigina DOKUNMAZ;
//  sezon sonunda ayri simule edilir. Format: lig fazi (8 mac) + tek-elemeli
//  knockout (UEFA 2024/25 yeni formatina yakin).
// ============================================================================

const COMPETITIONS = [
    { id: 'ucl', name: 'Şampiyonlar Ligi', conf: 'UEFA', pick: [0, 36] },
    { id: 'uel', name: 'Avrupa Ligi', conf: 'UEFA', pick: [36, 72] },
    { id: 'uecl', name: 'Konferans Ligi', conf: 'UEFA', pick: [72, 108] },
    { id: 'acl', name: 'AFC Şampiyonlar Ligi', conf: 'AFC', pick: [0, 24] },
    { id: 'lib', name: 'Copa Libertadores', leagueId: 'conmebol-libertadores' },
    { id: 'sud', name: 'Copa Sudamericana', leagueId: 'conmebol-sudamericana' },
];
const _KO_NAMES = { 32: 'Son 32', 16: 'Son 16', 8: 'Çeyrek Final', 4: 'Yarı Final', 2: 'Final' };

function _confTeamsByPower(conf) {
    return DB.teams().filter(t => { const l = DB.getLeague(t.leagueId); return l && l.type === 'league' && l.confederation === conf; })
        .slice().sort((a, b) => b.power - a.power);
}
function qualifyCupTeams(comp) {
    if (comp.leagueId) return DB.teamsInLeague(comp.leagueId).map(t => t.id);
    const pool = _confTeamsByPower(comp.conf);
    return pool.slice(comp.pick[0], comp.pick[1]).map(t => t.id);
}

function _pw(id) { const t = DB.getTeam(id); return t ? t.power : 65; }
function _tieWinner(a, b, playerTeamId) {
    let pa = 0.5 + (_pw(a) - _pw(b)) / 40;
    const pl = gameState.player;
    if (pl && pl.teamId === a) pa += ((pl.form || 60) - 60) / 300 + (pl.ovr - 72) / 300;
    if (pl && pl.teamId === b) pa -= ((pl.form || 60) - 60) / 300 + (pl.ovr - 72) / 300;
    pa = Math.max(0.08, Math.min(0.92, pa));
    return Math.random() < pa ? a : b;
}

function simulateCup(comp) {
    const teams = qualifyCupTeams(comp);
    if (teams.length < 8) return null;
    const playerTeamId = gameState.player ? gameState.player.teamId : null;
    const playerIn = teams.includes(playerTeamId);

    // Lig fazi: her takim min(8, n-1) mac
    const games = Math.min(8, teams.length - 1);
    const pts = {}; teams.forEach(t => pts[t] = { id: t, p: 0, gf: 0, ga: 0 });
    teams.forEach(t => {
        const opp = teams.filter(x => x !== t);
        for (let g = 0; g < games; g++) {
            const o = opp[Math.floor(Math.random() * opp.length)];
            const [sh, sa] = simScore(t, o);
            pts[t].gf += sh; pts[t].ga += sa;
            if (sh > sa) pts[t].p += 3; else if (sh === sa) pts[t].p += 1;
        }
    });
    const table = Object.values(pts).sort((a, b) => b.p - a.p || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);

    // Knockout: ust siralar, 2'nin kuvvetine indirgenmis tek-elemeli
    let ko = table.map(r => r.id);
    let size = 1; while (size * 2 <= Math.min(ko.length, 32)) size *= 2;
    ko = ko.slice(0, size);
    let playerExit = null, round = ko.slice();
    while (round.length > 1) {
        const name = _KO_NAMES[round.length] || (round.length + ' Tur');
        const next = [];
        for (let i = 0; i < round.length / 2; i++) {
            const a = round[i], b = round[round.length - 1 - i];
            const w = _tieWinner(a, b, playerTeamId);
            if (playerTeamId && (a === playerTeamId || b === playerTeamId) && w !== playerTeamId) playerExit = name;
            next.push(w);
        }
        round = next;
    }
    const champion = round[0];
    if (playerTeamId && champion === playerTeamId) playerExit = 'Şampiyon';
    return { id: comp.id, name: comp.name, champion, table: table.slice(0, 8), playerIn,
             playerExit: playerIn ? (playerExit || 'Lig Fazı (elendi)') : null };
}

function runSeasonCups(season) {
    if (!gameState.cups) gameState.cups = {};
    const results = {};
    for (const comp of COMPETITIONS) { const r = simulateCup(comp); if (r) results[comp.id] = r; }
    // Oyuncunun GERÇEK kampanyasi (85-euro) o sezon aktifse, dunya simulasyonu
    // oyuncu sonucunu sahiplenmesin (cifte kupa/celiskiyi onle).
    const euroActive = gameState.euro && gameState.euro.season === season;
    if (euroActive) for (const id in results) { results[id].playerIn = false; results[id].playerExit = null; }

    gameState.cups[season] = results;
    gameState.cupsLatestSeason = season;
    // sadece son 3 sezon sakla (kayit sismesin)
    Object.keys(gameState.cups).map(Number).sort((a, b) => a - b).slice(0, -3).forEach(s => delete gameState.cups[s]);
    if (euroActive) return results;
    for (const id in results) {
        const r = results[id];
        if (r.playerExit === 'Şampiyon') {
            gameState.trophies.push({ season, title: r.name + ' Şampiyonluğu' });
            setTimeout(() => { try { showToast(`🏆 Kulübünle ${r.name} ŞAMPİYONU oldun!`, 'success'); } catch (e) {} }, 1300);
        } else if (r.playerIn) {
            setTimeout(() => { try { showToast(`${r.name}: Kulübün "${r.playerExit}" aşamasında veda etti.`, 'info'); } catch (e) {} }, 1500);
        }
    }
    return results;
}

function renderCupsTab() {
    const host = document.getElementById('cups-content'); if (!host) return;
    const season = gameState.cupsLatestSeason;
    const badge = document.getElementById('cups-season-badge');
    if (!season || !gameState.cups || !gameState.cups[season]) return;
    if (badge) badge.textContent = season + ' Sezonu';
    const res = gameState.cups[season];
    let html = '';
    for (const comp of COMPETITIONS) {
        const r = res[comp.id]; if (!r) continue;
        const champ = DB.getTeam(r.champion) || { name: r.champion };
        const me = r.playerIn
            ? `<div style="margin-top:6px;font-size:.82rem;color:${r.playerExit === 'Şampiyon' ? 'var(--accent,#0f8)' : '#ffca28'};"><i class="fa-solid fa-user"></i> Kulübün: <strong>${r.playerExit}</strong></div>` : '';
        html += `<div style="background:rgba(255,255,255,.04);border:1px solid var(--card-border);border-radius:12px;padding:12px;margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;"><strong>${r.name}</strong>${r.playerIn ? '<span style="font-size:.72rem;color:var(--accent,#0f8);">KATILDIN</span>' : ''}</div>
            <div style="margin-top:6px;display:flex;align-items:center;gap:8px;"><i class="fa-solid fa-trophy" style="color:#ffca28;"></i> Şampiyon: ${getTeamLogoHtml(r.champion, 18)} <strong>${champ.name}</strong></div>
            ${me}</div>`;
    }
    host.innerHTML = html || '<p style="color:var(--text-muted)">Bu sezon kupa verisi yok.</p>';
}

if (typeof window !== 'undefined') {
    Object.assign(window, { COMPETITIONS, qualifyCupTeams, simulateCup, runSeasonCups, renderCupsTab });
}
