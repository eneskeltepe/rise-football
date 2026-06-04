// ============================================================================
//  10-db.js  —  Veri erisim katmani (DB)
//  data/leagues.js, data/teams.js, data/nations.js eager yuklenir.
//  data/players/<ligId>.json talep uzerine (lazy) fetch + cache edilir.
// ============================================================================
const DB = (function () {
    let _leagueIdx = null, _teamIdx = null, _teamsByLeague = null;
    const _playerCache = {};        // ligId -> [player]
    const _loadPromises = {};       // ligId -> Promise
    const _playerById = {};         // id -> player (yuklenen liglerden)

    function _buildIndexes() {
        if (_leagueIdx) return;
        _leagueIdx = {}; _teamIdx = {}; _teamsByLeague = {};
        for (const l of (window.DB_LEAGUES || [])) _leagueIdx[l.id] = l;
        for (const t of (window.DB_TEAMS || [])) {
            // srcLeague = oyuncu JSON dosyasinin bulundugu (orijinal) lig; kume
            // dusme/cikma ile leagueId degisse de oyuncular bu dosyada kalir.
            if (!t.srcLeague) t.srcLeague = t.leagueId;
            _teamIdx[t.id] = t;
            (_teamsByLeague[t.leagueId] = _teamsByLeague[t.leagueId] || []).push(t);
        }
    }
    // Takim leagueId'leri degisince (terfi/kume dusme) indeksleri yeniden kur
    function invalidate() { _leagueIdx = null; _teamIdx = null; _teamsByLeague = null; }

    function leagues() { _buildIndexes(); return window.DB_LEAGUES || []; }
    function teams() { _buildIndexes(); return window.DB_TEAMS || []; }
    function getLeague(id) { _buildIndexes(); return _leagueIdx[id] || null; }
    function getTeam(id) { _buildIndexes(); return _teamIdx[id] || null; }
    function teamsInLeague(id) { _buildIndexes(); return _teamsByLeague[id] || []; }
    function nationFlag(name) { return (window.DB_NATIONS || {})[name] || '🏳️'; }

    // Bir takimin ligini bul
    function leagueOfTeam(teamId) {
        const t = getTeam(teamId);
        return t ? getLeague(t.leagueId) : null;
    }

    // ---- Lazy oyuncu yukleme ----
    function loadPlayers(leagueId) {
        if (_playerCache[leagueId]) return Promise.resolve(_playerCache[leagueId]);
        if (_loadPromises[leagueId]) return _loadPromises[leagueId];
        const p = fetch(`data/players/${leagueId}.json`)
            .then(r => r.ok ? r.json() : [])
            .then(list => {
                _playerCache[leagueId] = list;
                for (const pl of list) _playerById[pl.id] = pl;
                return list;
            })
            .catch(() => { _playerCache[leagueId] = []; return []; });
        _loadPromises[leagueId] = p;
        return p;
    }
    function ensureLeagues(ids) { return Promise.all([...new Set(ids)].map(loadPlayers)); }
    function isLoaded(leagueId) { return !!_playerCache[leagueId]; }

    // Senkron erisim (lig onceden yuklenmis olmali)
    function playersInLeagueSync(leagueId) { return _playerCache[leagueId] || []; }
    function loadedPlayersSync() { return Object.values(_playerById); }   // yuklenmis TUM oyuncular (isim havuzu vb.)
    function squadSync(teamId) {
        const t = getTeam(teamId); if (!t) return [];
        const fileLg = t.srcLeague || t.leagueId;
        let arr = (_playerCache[fileLg] || []).filter(p => p.teamId === teamId);
        if (!arr.length) {
            // yedek: yuklenmis tum cache'lerde teamId ile ara (terfi/kume dusme sonrasi)
            for (const lg in _playerCache) {
                const f = _playerCache[lg].filter(p => p.teamId === teamId);
                if (f.length) { arr = f; break; }
            }
        }
        // Yetersiz kadrolu kuluplere oyunun urettigi seviye-uygun dolgu oyunculari
        try {
            if (typeof gameState !== 'undefined' && gameState && gameState.genFillers && gameState.genFillers[teamId])
                arr = arr.concat(gameState.genFillers[teamId]);
            // Altyapi oyunculari da GERCEK kadro uyesi (gelisir, OVR yetince ilk-11/yedek olur)
            if (typeof gameState !== 'undefined' && gameState && gameState.clubYouth && gameState.clubYouth[teamId])
                arr = arr.concat(gameState.clubYouth[teamId]);
        } catch (e) { /* gameState henuz yok */ }
        // FAZ 4: yaşayan dünya overlay'i — emekli oyuncuları çıkar, transfer/regen ekle.
        // Hazır değilse (taze kariyer / hidrasyon yok) arr aynen döner → v2.0 davranışı (reversible).
        try { if (typeof WorldState !== 'undefined' && WorldState.ready && WorldState.ready()) arr = WorldState.applyToSquad(teamId, arr); } catch (e) { /* overlay hatası kadroyu bozmasın */ }
        return arr;
    }
    function playerByIdSync(id) { return _playerById[id] || null; }
    // FAZ 4: WorldDB regen/transfer oyuncularını isim çözümü için kayda al (playerByIdSync bulsun).
    function registerWorldPlayers(arr) {
        if (!Array.isArray(arr)) return;
        for (const p of arr) { if (p && p.id != null && !_playerById[p.id]) _playerById[p.id] = p; }
    }

    return {
        leagues, teams, getLeague, getTeam, teamsInLeague, nationFlag, leagueOfTeam,
        loadPlayers, ensureLeagues, isLoaded, playersInLeagueSync, loadedPlayersSync, squadSync, playerByIdSync,
        registerWorldPlayers,
        invalidate,
    };
})();

if (typeof window !== 'undefined') window.DB = DB;
