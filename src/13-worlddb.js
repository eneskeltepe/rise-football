// ============================================================================
//  13-worlddb.js  —  FM-tarzı KALICI DÜNYA veritabanı (IndexedDB).
//  Kayıt aynası (12-store, `fc_saves_db`) ile KARIŞMAZ: tamamen ayrı bir DB
//  (`fc_world_db`). Amaç: tüm 45 ligin ~22k oyuncusunu, takım-sezon
//  istatistiklerini, maç olay dökümlerini ve transfer kayıtlarını GERÇEKTEN
//  saklamak (deterministik-sentetik dünyanın yerine). Her kayıt kullanıcı
//  kayıt slotuna (`slot`) göre namespacelenir → çok-kariyer izolasyonu.
//
//  FAZ 0 KAPSAMI: şema + kariyer başı tohumlama (players + teamSeasons + meta).
//  Okuyucular HENÜZ bu DB'ye geçmez (paralel doğrulama; oyun bozulmaz).
//  matches / playerSeasons / transfers store'ları kurulur ama sonraki fazlarda
//  (haftalık sim, sezon geçişi) doldurulur.
// ============================================================================
(function () {
    const DB_NAME = 'fc_world_db';
    const SCHEMA_VERSION = 1;        // IndexedDB sürümü (şema değişince artır)
    let _dbp = null;

    // ---- Şema: store + index tanımları (onupgradeneeded'de kurulur) ----
    function _createSchema(db) {
        if (!db.objectStoreNames.contains('players')) {
            const s = db.createObjectStore('players', { keyPath: ['slot', 'id'] });
            s.createIndex('bySlot', 'slot', { unique: false });
            s.createIndex('bySlotTeam', ['slot', 'teamId'], { unique: false });
            s.createIndex('bySlotRetired', ['slot', 'retired'], { unique: false });
        }
        if (!db.objectStoreNames.contains('playerSeasons')) {
            const s = db.createObjectStore('playerSeasons', { keyPath: ['slot', 'playerId', 'season'] });
            s.createIndex('bySlotPlayer', ['slot', 'playerId'], { unique: false });
            s.createIndex('bySlotSeasonLeague', ['slot', 'season', 'leagueId'], { unique: false });
        }
        if (!db.objectStoreNames.contains('matches')) {
            const s = db.createObjectStore('matches', { keyPath: ['slot', 'id'] });
            s.createIndex('bySlotSeasonLeagueWeek', ['slot', 'season', 'leagueId', 'week'], { unique: false });
            s.createIndex('bySlotSeason', ['slot', 'season'], { unique: false });
        }
        if (!db.objectStoreNames.contains('teamSeasons')) {
            const s = db.createObjectStore('teamSeasons', { keyPath: ['slot', 'teamId', 'season'] });
            s.createIndex('bySlotSeasonLeague', ['slot', 'season', 'leagueId'], { unique: false });
            s.createIndex('bySlotTeam', ['slot', 'teamId'], { unique: false });
        }
        if (!db.objectStoreNames.contains('transfers')) {
            const s = db.createObjectStore('transfers', { keyPath: 'autoId', autoIncrement: true });
            s.createIndex('bySlot', 'slot', { unique: false });
            s.createIndex('bySlotSeason', ['slot', 'season'], { unique: false });
            s.createIndex('bySlotPlayer', ['slot', 'playerId'], { unique: false });
        }
        if (!db.objectStoreNames.contains('meta')) {
            db.createObjectStore('meta', { keyPath: ['slot', 'key'] });
        }
    }

    function open() {
        if (_dbp) return _dbp;
        _dbp = new Promise((resolve, reject) => {
            if (!window.indexedDB) { reject(new Error('IndexedDB yok')); return; }
            const req = indexedDB.open(DB_NAME, SCHEMA_VERSION);
            req.onupgradeneeded = () => _createSchema(req.result);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return _dbp;
    }

    // ---- Düşük seviye yardımcılar ----
    function putAll(store, recs) {
        if (!recs || !recs.length) return Promise.resolve(0);
        return open().then(db => new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite');
            const os = tx.objectStore(store);
            for (const r of recs) os.put(r);
            tx.oncomplete = () => resolve(recs.length);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('tx abort'));
        }));
    }
    function get(store, key) {
        return open().then(db => new Promise((resolve) => {
            const req = db.transaction(store, 'readonly').objectStore(store).get(key);
            req.onsuccess = () => resolve(req.result != null ? req.result : null);
            req.onerror = () => resolve(null);
        }));
    }
    function getAllByIndex(store, indexName, query) {
        return open().then(db => new Promise((resolve) => {
            const os = db.transaction(store, 'readonly').objectStore(store);
            let src = os;
            try { if (indexName) src = os.index(indexName); } catch (_) { src = os; }
            const req = src.getAll(query);
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        }));
    }
    function count(store, slot) {
        return open().then(db => new Promise((resolve) => {
            const os = db.transaction(store, 'readonly').objectStore(store);
            if (slot == null) { const r = os.count(); r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(0); return; }
            let idx = null; try { idx = os.index('bySlot'); } catch (_) { idx = null; }
            if (idx) { const r = idx.count(IDBKeyRange.only(slot)); r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(0); return; }
            // bySlot indeksi yok → tam tarama say
            let n = 0; const rq = os.openCursor();
            rq.onsuccess = (e) => { const c = e.target.result; if (c) { if (c.value && c.value.slot === slot) n++; c.continue(); } else resolve(n); };
            rq.onerror = () => resolve(n);
        }));
    }
    // Bir slotun TÜM kayıtlarını sil (kariyer silinince / yeniden tohumlama öncesi).
    function _clearSlotStore(store, slot) {
        return open().then(db => new Promise((resolve) => {
            const tx = db.transaction(store, 'readwrite');
            const os = tx.objectStore(store);
            let n = 0; const req = os.openCursor();
            req.onsuccess = (e) => { const c = e.target.result; if (c) { if (c.value && c.value.slot === slot) { c.delete(); n++; } c.continue(); } };
            tx.oncomplete = () => resolve(n);
            tx.onerror = () => resolve(n);
            tx.onabort = () => resolve(n);
        }));
    }
    function clearSlot(slot) {
        const stores = ['players', 'playerSeasons', 'matches', 'teamSeasons', 'transfers', 'meta'];
        return Promise.all(stores.map(s => _clearSlotStore(s, slot).catch(() => 0)))
            .then(counts => counts.reduce((a, b) => a + b, 0))
            .catch(() => 0);
    }

    // ---- Meta (slot-bazlı küçük anahtar/değer) ----
    function setMeta(slot, key, value) { return putAll('meta', [{ slot: slot, key: key, value: value }]); }
    function getMeta(slot, key) { return get('meta', [slot, key]).then(r => (r ? r.value : undefined)); }
    function isSeeded(slot) { return getMeta(slot, 'seeded').then(v => !!v).catch(() => false); }

    // ---- Tohum kaydı üreticileri ----
    function _peakAge(pos) {
        if (pos === 'Kaleci') return 31;
        if (pos === 'Stoper' || pos === 'DOS') return 30;
        return 28;
    }
    function _derivePotential(ovr, age) {
        return Math.max(ovr, Math.min(99, Math.round(ovr + Math.max(0, 23 - age) * 1.1)));
    }
    function _playerSeedRecord(slot, p, fileLeagueId) {
        const age = p.age || 24;
        const ovr = p.ovr || 60;
        const t = (typeof DB !== 'undefined' && p.teamId) ? DB.getTeam(p.teamId) : null;
        const prestige = (t && t.prestige) || 2;
        const leagueId = (t && t.leagueId) || (p.teamId ? String(p.teamId).split('__')[0] : fileLeagueId);
        const value = (typeof calcMarketValue === 'function') ? calcMarketValue(ovr, age, prestige) : 0;
        const wage = (typeof calcWage === 'function') ? calcWage(ovr, prestige) : 0;
        return {
            slot: slot, id: p.id, name: p.name, nation: p.nation || '',
            pos: p.pos, eaPos: p.eaPos || '', altPos: p.altPos || [],
            attrs: p.attrs ? Object.assign({}, p.attrs) : {},
            stats: p.stats ? Object.assign({}, p.stats) : {},
            baseOvr: ovr, ovr: ovr, potential: _derivePotential(ovr, age), peakAge: _peakAge(p.pos), age: age,
            teamId: p.teamId, leagueId: leagueId,
            height: p.height || 180, weight: p.weight || 75, foot: p.foot || '', img: p.img || '',
            contractYears: 1 + Math.floor(Math.random() * 4),
            value: value, wage: wage,
            form: 50, fitness: 100, injury: null, suspension: null, yellowAccum: 0, retired: 0
        };
    }
    function _teamSeasonSeedRecord(slot, t, season) {
        return {
            slot: slot, teamId: t.id, season: season, leagueId: t.leagueId,
            P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, Pts: 0, rank: 0,
            budget: (typeof t.budget === 'number') ? t.budget : 0
        };
    }

    // ---- Kariyer başı tohumlama: tüm 'league' tipi ligler ----
    function seedCareer(slot, opts) {
        opts = opts || {};
        const onProg = (typeof opts.onProgress === 'function') ? opts.onProgress : function () {};
        if (slot == null) return Promise.reject(new Error('slot yok'));
        if (typeof DB === 'undefined') return Promise.reject(new Error('DB yok'));
        const season = (typeof START_SEASON !== 'undefined') ? START_SEASON
            : ((typeof gameState !== 'undefined' && gameState && gameState.currentSeason) || 2025);
        const leagues = DB.leagues().filter(l => l.type !== 'cup');
        const total = leagues.length;

        // Önce slotu temizle (yeniden tohumlama / slot tekrar kullanımı için idempotent)
        return clearSlot(slot).then(() => {
            let chain = Promise.resolve();
            let done = 0, pTotal = 0;
            leagues.forEach((lg) => {
                chain = chain.then(() => DB.loadPlayers(lg.id)).then((players) => {
                    const precs = (players || []).map(p => _playerSeedRecord(slot, p, lg.id));
                    const teams = DB.teamsInLeague(lg.id);
                    const tsrecs = teams.map(t => _teamSeasonSeedRecord(slot, t, season));
                    return putAll('players', precs)
                        .then(() => putAll('teamSeasons', tsrecs))
                        .then(() => { done++; pTotal += precs.length; onProg(done, total, lg.name, pTotal); });
                });
            });
            return chain;
        }).then(() => {
            return setMeta(slot, 'schemaVersion', SCHEMA_VERSION)
                .then(() => setMeta(slot, 'seeded', 1))
                .then(() => setMeta(slot, 'season', season))
                .then(() => setMeta(slot, 'lastSimWeek', 0));
        }).then(() => count('players', slot).then(n => ({ leagues: total, players: n, season: season })));
    }

    function seedCareerIfNeeded(slot, opts) {
        return isSeeded(slot).then(seeded => seeded ? Promise.resolve({ skipped: true }) : seedCareer(slot, opts));
    }

    // ---- Kolaylık okuyucu (sonraki fazlarda kullanılacak; şimdiden test edilebilir) ----
    function squadFromDB(slot, teamId) {
        return getAllByIndex('players', 'bySlotTeam', IDBKeyRange.only([slot, teamId]));
    }

    // ---- FAZ 1b: maç kaydı + puan durumu snapshot ----
    // recs: [{slot,id,season,week,leagueId,home,away,sh,sa,events}]
    function recordMatches(recs) { return putAll('matches', recs); }

    // gameState.standings'i teamSeasons'a kopyala (tek doğruluk kaynağı standings;
    // teamSeasons onun kalıcı snapshot'ı → tutarlılık garantili).
    function snapshotStandings(slot, season, standings) {
        if (!standings) return Promise.resolve(0);
        const recs = [];
        for (const lgId in standings) {
            const tbl = standings[lgId]; if (!tbl) continue;
            const sorted = Object.entries(tbl).sort((a, b) =>
                b[1].points - a[1].points || b[1].goalDiff - a[1].goalDiff || b[1].goalsFor - a[1].goalsFor);
            sorted.forEach(([tId, row], i) => recs.push({
                slot: slot, teamId: tId, season: season, leagueId: lgId,
                P: row.played, W: row.won, D: row.drawn, L: row.lost,
                GF: row.goalsFor, GA: row.goalsAgainst, Pts: row.points, rank: i + 1, budget: 0
            }));
        }
        return putAll('teamSeasons', recs);
    }
    // Maçları (season,leagueId,week) ile getir — Faz 5 geçmiş UI / test için.
    function matchesOfWeek(slot, season, leagueId, week) {
        return getAllByIndex('matches', 'bySlotSeasonLeagueWeek', IDBKeyRange.only([slot, season, leagueId, week]));
    }

    window.WorldDB = {
        open: open,
        SCHEMA_VERSION: SCHEMA_VERSION,
        // düşük seviye
        putAll: putAll, get: get, getAllByIndex: getAllByIndex, count: count, clearSlot: clearSlot,
        // meta
        setMeta: setMeta, getMeta: getMeta, isSeeded: isSeeded,
        // tohumlama
        seedCareer: seedCareer, seedCareerIfNeeded: seedCareerIfNeeded,
        // okuyucu
        squadFromDB: squadFromDB, matchesOfWeek: matchesOfWeek,
        // faz 1b: dünya maç kaydı
        recordMatches: recordMatches, snapshotStandings: snapshotStandings,
        // test/iç görü
        _playerSeedRecord: _playerSeedRecord, _teamSeasonSeedRecord: _teamSeasonSeedRecord,
        _derivePotential: _derivePotential, _peakAge: _peakAge,
    };
})();
