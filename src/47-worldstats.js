// ============================================================================
//  47-worldstats.js  —  FAZ 3: İçinde bulunulan sezonun oyuncu istatistik CACHE'i.
//  Tek doğruluk = IDB `matches` (olay dökümü). Mevcut sezon henüz `playerSeasons`'a
//  yazılmadığı için (o sadece sezon SONU agregatı), bu modül mevcut sezonun
//  maçlarını cursor'la tarayıp BELLEK-İÇİ agregat tutar → krallık/profil SYNC
//  okur. Maç detayı (58-history) ile AYNI kaynaktan → çelişki imkânsız.
//  ensureSeason async (rebuild), ready/playerStat SYNC, invalidate (hafta sonrası).
// ============================================================================
(function () {
    let _cache = null;        // {slot, season, byPlayer:{pid:{g,a,m,starts,subApps,y,r,cs,og,motm,team,lg}}}
    let _building = null;     // uçuştaki rebuild promise (_key ile)
    let _stale = true;

    function _key(slot, season) { return slot + ':' + season; }

    function _rebuild(slot, season) {
        if (typeof WorldDB === 'undefined' || typeof WorldDB.iterateByIndex !== 'function')
            return Promise.resolve({ slot: slot, season: season, byPlayer: {} });
        const byPlayer = {};
        function A(pid) { return byPlayer[pid] || (byPlayer[pid] = { g: 0, a: 0, m: 0, starts: 0, subApps: 0, y: 0, r: 0, cs: 0, og: 0, motm: 0, team: '', lg: '' }); }
        // 'USER' = kullanıcının kendisi → istatistiği gameState'ten gelir (explicit satır); cache'te ATLA (çift sayma yok).
        function apps(ids, isStart, team, lg) { if (!ids) return; for (const pid of ids) { if (pid === 'USER') continue; const r = A(pid); r.m++; if (isStart) r.starts++; else r.subApps++; r.team = team; r.lg = lg; } }
        return WorldDB.iterateByIndex('matches', 'bySlotSeason', IDBKeyRange.only([slot, season]), (m) => {
            apps(m.homeXI, true, m.home, m.leagueId); apps(m.homeSubs, false, m.home, m.leagueId);
            apps(m.awayXI, true, m.away, m.leagueId); apps(m.awaySubs, false, m.away, m.leagueId);
            if (m.sa === 0 && m.homeXI && m.homeXI.length && m.homeXI[0] !== 'USER') A(m.homeXI[0]).cs++;
            if (m.sh === 0 && m.awayXI && m.awayXI.length && m.awayXI[0] !== 'USER') A(m.awayXI[0]).cs++;
            const mc = {};   // bu maçtaki katkı (gol×2 + asist) → maçın adamı
            for (const ev of (m.events || [])) {
                if (ev.playerId == null) continue;
                // 'USER' golü/kartı/asisti gameState'ten gelir → cache'te ATLA (çift sayma yok).
                if (ev.type === 'goal') {
                    if (ev.playerId !== 'USER') {
                        const r = A(ev.playerId);
                        if (ev.ownGoal) { r.og++; }
                        else { r.g++; mc[ev.playerId] = (mc[ev.playerId] || 0) + 2; }
                    }
                    if (ev.assistId != null && ev.assistId !== 'USER') { A(ev.assistId).a++; mc[ev.assistId] = (mc[ev.assistId] || 0) + 1; }
                } else if (ev.playerId !== 'USER') {
                    const r = A(ev.playerId);
                    if (ev.type === 'yellow') r.y++;
                    else if (ev.type === 'red') r.r++;
                }
            }
            let best = null, bestV = 0;
            for (const pid in mc) { if (mc[pid] > bestV) { bestV = mc[pid]; best = pid; } }
            if (best && bestV >= 2) A(best).motm++;
        }).then(() => ({ slot: slot, season: season, byPlayer: byPlayer }));
    }

    function ensureSeason(slot, season) {
        if (slot == null) return Promise.resolve(null);
        if (_cache && _cache.slot === slot && _cache.season === season && !_stale) return Promise.resolve(_cache);
        if (_building && _building._k === _key(slot, season)) return _building;
        const p = _rebuild(slot, season).then(c => { _cache = c; _stale = false; _building = null; return c; })
            .catch(() => { _building = null; return _cache; });
        p._k = _key(slot, season);
        _building = p;
        return p;
    }

    function ready(slot, season) { return !!(_cache && _cache.slot === slot && _cache.season === season && !_stale); }
    function playerStat(pid) { return (_cache && _cache.byPlayer[pid]) || null; }
    function invalidate() { _stale = true; }

    window.WorldStats = { ensureSeason: ensureSeason, ready: ready, playerStat: playerStat, invalidate: invalidate };
})();
