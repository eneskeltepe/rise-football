// ============================================================================
//  14-worldstate.js  —  FAZ 4: Yaşayan dünya OVERLAY'i (emeklilik + regen + transfer).
//  WorldDB.players KALICI durumdur (evolveWorldPlayersSeason emekli eder/regen ekler,
//  AI transfer teamId değiştirir). Ama maç motoru kadroyu SENKRON `DB.squadSync`'ten
//  çeker (in-memory JSON). Bu modül WorldDB DELTA'larını (emekli pid'leri, regen
//  oyuncular, transfer hedefleri) belleğe yükler ve `squadSync` bunları uygular:
//    - emekli oyuncular kadrodan ÇIKARILIR,
//    - başka kulübe geçenler ESKİ kulüpten çıkar / YENİ kulübe eklenir,
//    - regen gençler kadroya EKLENİR (sayısal id → maç/istatistik gerçek).
//  Overlay boşsa (taze kariyer / hidrasyon yok) squadSync v2.0 gibi davranır → REVERSIBLE.
//  ensure(slot) async (WorldDB'den tek cursor taramasıyla kurar), ready/applyToSquad SYNC.
// ============================================================================
(function () {
    let _slot = null;
    let _ready = false;
    let _building = null;
    const _retired = new Set();          // emekli pid'leri (çıkar)
    let _regensByTeam = {};              // teamId -> [squad objesi] (ekle)
    let _movedAway = new Map();          // pid -> yeni teamId (eski kulüpten çıkar)
    let _movedInByTeam = {};             // teamId -> [pid] (yeni kulübe ekle; obje DB'den)

    function _toSquadObj(rec) {
        // WorldDB kaydını squadSync tüketicilerinin beklediği şekle indir (id/pos/ovr/attrs/name…)
        return {
            id: rec.id, name: rec.name, teamId: rec.teamId, nation: rec.nation || '',
            pos: rec.pos, eaPos: rec.eaPos || '', altPos: rec.altPos || [],
            ovr: rec.ovr, age: rec.age, height: rec.height || 180, weight: rec.weight || 75,
            foot: rec.foot || '', img: rec.img || '',
            attrs: rec.attrs || {}, stats: rec.stats || {},
            isRegen: 1, potential: rec.potential
        };
    }

    function _rebuild(slot) {
        _retired.clear(); _regensByTeam = {}; _movedAway = new Map(); _movedInByTeam = {};
        if (typeof WorldDB === 'undefined' || typeof WorldDB.iterateByIndex !== 'function')
            return Promise.resolve();
        const regenObjs = [];
        // Tek cursor taraması: emekli + regen topla (bellek dostu; ~15k kayıt, yalnız delta tutulur).
        const scan = WorldDB.iterateByIndex('players', 'bySlot', IDBKeyRange.only(slot), (rec) => {
            if (rec.retired) { _retired.add(rec.id); return; }
            if (rec.isRegen && rec.teamId) {
                const o = _toSquadObj(rec);
                (_regensByTeam[rec.teamId] || (_regensByTeam[rec.teamId] = [])).push(o);
                regenObjs.push(o);
            }
        });
        // Transferler (FAZ 4b): transfers store'undan en güncel hedef (pid -> toTeam).
        const moves = (typeof WorldDB.getAllByIndex === 'function')
            ? WorldDB.getAllByIndex('transfers', 'bySlot', IDBKeyRange.only(slot)).catch(() => [])
            : Promise.resolve([]);
        return Promise.all([scan, moves]).then(([_, transfers]) => {
            // regenleri isim çözümü için DB'ye kaydet (maç detayı/profil playerByIdSync)
            if (regenObjs.length && typeof DB !== 'undefined' && typeof DB.registerWorldPlayers === 'function')
                DB.registerWorldPlayers(regenObjs);
            for (const tr of (transfers || [])) {
                if (!tr || tr.playerId == null || !tr.toTeam) continue;
                _movedAway.set(tr.playerId, tr.toTeam);                  // son kazanan (sıra: autoId artan)
            }
            // ters indeks: hedef kulübe gelenler
            _movedInByTeam = {};
            _movedAway.forEach((toTeam, pid) => {
                (_movedInByTeam[toTeam] || (_movedInByTeam[toTeam] = [])).push(pid);
            });
            // C-guard: transfer edilen oyuncunun KAYNAK lig JSON'u yüklü değilse applyToSquad'da
            // DB.playerByIdSync null döner → cross-lig transferde oyuncu YENİ kulüpte görünmez.
            // Transfer varsa tüm lig kadrolarını yükle (zaten cache'liyse ucuz; recordWorldWeekDetails
            // de yüklüyor) → playerByIdSync her transferi çözer, kaybolma olmaz.
            if (_movedAway.size && typeof DB !== 'undefined' && typeof DB.ensureLeagues === 'function') {
                return DB.ensureLeagues(DB.leagues().filter(l => l.type === 'league').map(l => l.id)).catch(() => {});
            }
        });
    }

    function ensure(slot, force) {
        if (slot == null) return Promise.resolve();
        if (_ready && _slot === slot && !force) return Promise.resolve();
        if (_building && _building._slot === slot && !force) return _building;
        const p = _rebuild(slot).then(() => { _slot = slot; _ready = true; _building = null; })
            .catch(() => { _building = null; });
        p._slot = slot;
        _building = p;
        return p;
    }

    function ready() { return _ready; }
    function isRetired(pid) { return _retired.has(pid) || _retired.has(Number(pid)) || _retired.has(String(pid)); }
    // Transferle kulüp değiştirdiyse GÜNCEL kulüp id'si, yoksa null (arama/profil "hâlâ eski
    // kulüpte görünüyor" fix'i — kadrolar applyToSquad'dan geçer ama tekil gösterimler geçmez).
    function currentTeamOf(pid) {
        if (!_ready) return null;
        let v = _movedAway.get(pid); if (v != null) return v;
        v = _movedAway.get(Number(pid)); if (v != null) return v;
        v = _movedAway.get(String(pid));
        return v != null ? v : null;
    }

    // squadSync'in ürettiği kadroya overlay uygula (SYNC). teamId: kulüp. arr: ham kadro.
    function applyToSquad(teamId, arr) {
        if (!_ready) return arr;
        let out = arr;
        // 1) emekli + bu kulüpten AYRILMIŞ (başka kulübe transfer) oyuncuları çıkar
        if (_retired.size || _movedAway.size) {
            out = out.filter(p => {
                if (_retired.has(p.id)) return false;
                const to = _movedAway.get(p.id);
                if (to != null && to !== teamId) return false;   // başka kulübe geçti
                return true;
            });
        }
        // 2) bu kulübe GELEN transferleri ekle (obje DB'den; yoksa atla)
        const incoming = _movedInByTeam[teamId];
        if (incoming && incoming.length && typeof DB !== 'undefined' && typeof DB.playerByIdSync === 'function') {
            const have = new Set(out.map(p => p.id));
            for (const pid of incoming) {
                if (have.has(pid)) continue;
                const o = DB.playerByIdSync(pid);
                if (o && !_retired.has(pid)) out.push(Object.assign({}, o, { teamId: teamId }));
            }
        }
        // 3) regen gençleri ekle
        const regs = _regensByTeam[teamId];
        if (regs && regs.length) {
            const have = new Set(out.map(p => p.id));
            for (const r of regs) if (!have.has(r.id)) out.push(r);
        }
        return out;
    }

    function invalidate() { _ready = false; }

    window.WorldState = {
        ensure: ensure, ready: ready, applyToSquad: applyToSquad,
        isRetired: isRetired, currentTeamOf: currentTeamOf, invalidate: invalidate,
        // test/iç görü
        _stats: function () { return { slot: _slot, ready: _ready, retired: _retired.size, regenTeams: Object.keys(_regensByTeam).length, moved: _movedAway.size }; }
    };
})();
