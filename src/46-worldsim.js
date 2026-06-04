// ============================================================================
//  46-worldsim.js  —  FAZ 1: İstatistiksel DÜNYA maç simülasyonu (saf model).
//  Bir dünya maçını (kullanıcının kendi maçı HARİÇ) simüle eder: skor + tam
//  olay dökümü (golcü/asist, sarı/kırmızı kart, sakatlık). Skor, mevcut
//  deterministik `detScore` (30-league) ile BİREBİR PARİTE üretir (aynı tohum
//  + aynı rng tüketimi) → Faz 1 devreye girince puan durumu "hissi" değişmez.
//  Skor üretildikten SONRA aynı rng akışı olayları (oyuncu atfı) üretir.
//
//  SAF: DOM/IndexedDB yok. Girdi olarak takım güçleri + kadrolar alır; Faz 1b
//  bunu IDB'ye yazar ve advanceWeek'e bağlar. Node ile test edilebilir.
// ============================================================================
(function () {
    // --- Tohumlu RNG (detScore ile BİREBİR aynı; parite garantisi) ---
    function _hash32(str) {
        let h = 2166136261;
        for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
        return h >>> 0;
    }
    function _mulberry32(a) {
        return function () {
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    function _rngFor(key) { return _mulberry32(_hash32(key)); }

    // --- Mevki ailesi (12 Türkçe mevki → aile) ---
    const _POS_FAM = {
        'Kaleci': 'GK', 'Stoper': 'CB', 'Sağ Bek': 'FB', 'Sol Bek': 'FB',
        'DOS': 'DM', 'Merkez OS': 'CM', 'Ofansif OS': 'AM',
        'Sağ Açık': 'W', 'Sol Açık': 'W', 'Sağ Kanat': 'WM', 'Sol Kanat': 'WM', 'Santrfor': 'ST'
    };
    function _fam(p) { return _POS_FAM[p && (p.pos || p.position)] || (p && p.eaPos) || 'CM'; }

    // Atıf ağırlıkları (aile bazlı; oyuncu OVR'ı ile ölçeklenir)
    const _GOAL_W = { ST: 10, W: 6, AM: 5, WM: 4, CM: 2.5, DM: 1, FB: 1, CB: 0.8, GK: 0.01 };
    const _ASSIST_W = { AM: 8, W: 7, WM: 6, CM: 5, FB: 4, ST: 3, DM: 2, CB: 1, GK: 0.2 };
    const _CARD_W = { DM: 5, CB: 4, FB: 3.5, CM: 3, WM: 2, AM: 1.5, W: 1.5, ST: 1.2, GK: 0.5 };

    // Ağırlıklı rastgele seçim (rng akışından). weightFn(player)->sayı.
    function _pick(squad, weightFn, rng, excludeId) {
        let total = 0; const ws = [];
        for (const p of squad) {
            if (excludeId != null && p.id === excludeId) { ws.push(0); continue; }
            const w = Math.max(0, weightFn(p)); ws.push(w); total += w;
        }
        if (total <= 0) return null;
        let r = rng() * total;
        for (let i = 0; i < squad.length; i++) { r -= ws[i]; if (r <= 0) return squad[i]; }
        return squad[squad.length - 1];
    }
    function _goalWeight(p) { return (_GOAL_W[_fam(p)] || 1) * Math.pow((p.ovr || 60) / 70, 1.4); }
    function _assistWeight(p) { return (_ASSIST_W[_fam(p)] || 1) * Math.pow((p.ovr || 60) / 70, 1.1); }
    function _cardWeight(p) { return (_CARD_W[_fam(p)] || 2) * (1 + ((p.attrs && p.attrs.agresiflik || 50) - 50) / 100); }

    // En çok oynayan 11 + birkaç yedek (atıf havuzu). Düşük OVR'lılar daha az atıf alır.
    function _coreSquad(squad) {
        if (!squad || !squad.length) return [];
        // OVR'a göre sırala, ilk 14'ü al (11 + ~3 sonradan giren) — atıf gerçekçi kalsın
        return squad.slice().sort((a, b) => (b.ovr || 0) - (a.ovr || 0)).slice(0, 14);
    }

    // ---- Tek dünya maçı simülasyonu ----
    // opt: {homeId, awayId, leagueId, weekIdx, season, salt, homePower, awayPower, homeSquad, awaySquad}
    // dönüş: {sh, sa, events:[{min,type,teamId,playerId,assistId?,weeks?}]}
    function simulateMatch(opt) {
        const salt = (opt.salt != null) ? opt.salt : 12345;
        const hp = (opt.homePower != null ? opt.homePower : 65) + 3;   // ev sahibi avantajı (detScore ile aynı)
        const ap = (opt.awayPower != null ? opt.awayPower : 65);
        const diff = hp - ap;
        const rng = _rngFor(salt + '|' + opt.leagueId + '|' + opt.season + '|' + opt.weekIdx + '|' + opt.homeId + '|' + opt.awayId);

        // --- SKOR: detScore ile BİREBİR aynı rng tüketimi ---
        let hg = 0, ag = 0;
        const chances = 2 + Math.floor(rng() * 3);
        for (let c = 0; c < chances; c++) {
            if (rng() < 0.5 + diff / 120) { if (rng() < hp / 180) hg++; }
            else { if (rng() < ap / 180) ag++; }
        }

        // --- OLAYLAR: skordan SONRA aynı rng akışı ---
        const events = [];
        const homeCore = _coreSquad(opt.homeSquad);
        const awayCore = _coreSquad(opt.awaySquad);

        function _emitGoals(n, teamId, core, oppCore) {
            for (let i = 0; i < n; i++) {
                const min = 1 + Math.floor(rng() * 90);
                const ev = { min: min, type: 'goal', teamId: teamId, playerId: null, assistId: null };
                // kendi kalesine? çok nadir (~%2) — rakipten savunmacı
                if (rng() < 0.02 && oppCore.length) {
                    const og = _pick(oppCore, p => (_fam(p) === 'CB' || _fam(p) === 'FB') ? 2 : 1, rng);
                    if (og) { ev.playerId = og.id; ev.ownGoal = true; ev.teamId = teamId; events.push(ev); continue; }
                }
                const scorer = _pick(core, _goalWeight, rng);
                ev.playerId = scorer ? scorer.id : null;
                // asist: gollerin ~%72'sinde (penaltı/solo değilse)
                if (scorer && rng() < 0.72) {
                    const assister = _pick(core, _assistWeight, rng, scorer.id);
                    if (assister) ev.assistId = assister.id;
                }
                events.push(ev);
            }
        }
        _emitGoals(hg, opt.homeId, homeCore, awayCore);
        _emitGoals(ag, opt.awayId, awayCore, homeCore);

        // --- Kartlar: maç başına ~3.4 sarı (Poisson benzeri), ~%7 kırmızı ---
        function _emitCards(teamId, core) {
            // takım başına ortalama ~1.7 sarı
            let yc = 0; const yMax = 5;
            while (yc < yMax && rng() < (yc === 0 ? 0.78 : 0.42)) yc++;
            for (let i = 0; i < yc; i++) {
                const p = _pick(core, _cardWeight, rng);
                if (p) events.push({ min: 1 + Math.floor(rng() * 90), type: 'yellow', teamId: teamId, playerId: p.id });
            }
            // kırmızı (direkt): takım başına ~%3.5
            if (rng() < 0.035) {
                const p = _pick(core, _cardWeight, rng);
                if (p) events.push({ min: 1 + Math.floor(rng() * 90), type: 'red', teamId: teamId, playerId: p.id });
            }
        }
        _emitCards(opt.homeId, homeCore);
        _emitCards(opt.awayId, awayCore);

        // --- Sakatlık: maç başına ~%9 (bir oyuncu), süre 1-8 hafta ---
        function _emitInjury(teamId, core) {
            if (rng() < 0.045 && core.length) {
                const p = _pick(core, () => 1, rng);
                if (p) events.push({ min: 1 + Math.floor(rng() * 90), type: 'injury', teamId: teamId, playerId: p.id, weeks: 1 + Math.floor(rng() * 8) });
            }
        }
        _emitInjury(opt.homeId, homeCore);
        _emitInjury(opt.awayId, awayCore);

        events.sort((a, b) => a.min - b.min);
        return { sh: hg, sa: ag, events: events };
    }

    const _api = {
        simulateMatch: simulateMatch,
        _fam: _fam, _POS_FAM: _POS_FAM,
        _rngFor: _rngFor,   // test: parite doğrulaması için
    };
    if (typeof window !== 'undefined') window.WorldSim = _api;
    if (typeof module !== 'undefined' && module.exports) module.exports = _api;   // Node testi
})();
