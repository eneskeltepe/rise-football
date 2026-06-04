// Faz 1a doğrulama — istatistiksel maç modeli (saf, Node). http-server gerekmez.
//   node tools/test_worldsim.js
const WS = require('../src/46-worldsim.js');

// --- detScore (30-league.js) BİREBİR replikası — açık güçlerle (DB.getTeam yok) ---
function detScoreReplica(homeId, awayId, leagueId, weekIdx, season, salt, hPow, aPow) {
    const hp = hPow + 3, ap = aPow, diff = hp - ap;
    const rng = WS._rngFor(salt + '|' + leagueId + '|' + season + '|' + weekIdx + '|' + homeId + '|' + awayId);
    let hg = 0, ag = 0; const chances = 2 + Math.floor(rng() * 3);
    for (let c = 0; c < chances; c++) { if (rng() < 0.5 + diff / 120) { if (rng() < hp / 180) hg++; } else { if (rng() < ap / 180) ag++; } }
    return [hg, ag];
}

const POSSET = ['Kaleci', 'Stoper', 'Stoper', 'Sağ Bek', 'Sol Bek', 'DOS', 'Merkez OS', 'Ofansif OS',
    'Sağ Açık', 'Sol Açık', 'Santrfor', 'Merkez OS', 'Sağ Kanat', 'Santrfor', 'Stoper', 'Kaleci', 'Sol Kanat', 'Ofansif OS'];
let _sid = 1;
function mkSquad(basePow) {
    return POSSET.map((pos) => ({ id: _sid++, pos: pos, ovr: Math.max(45, Math.min(93, Math.round(basePow + (Math.random() * 16 - 8)))), attrs: { agresiflik: 40 + Math.floor(Math.random() * 40) } }));
}
const FAM = WS._POS_FAM;

const N = 6000;
let parityMismatch = 0, goalInvariantFail = 0;
let totGoals = 0, totAssists = 0, totGoalEvents = 0, totYellow = 0, totRed = 0, totInjury = 0, totOwn = 0;
const scorerFam = {}; let scorerKnown = 0;
let zero = 0, one = 0, two = 0, three = 0, fourPlus = 0;

for (let i = 0; i < N; i++) {
    const hPow = 55 + Math.floor(Math.random() * 35);
    const aPow = 55 + Math.floor(Math.random() * 35);
    const hSq = mkSquad(hPow), aSq = mkSquad(aPow);
    const idById = {}; for (const p of hSq.concat(aSq)) idById[p.id] = p;
    const homeId = 'H' + i, awayId = 'A' + i, leagueId = 'lg' + (i % 8), season = 2026, week = i % 38, salt = 777;

    const res = WS.simulateMatch({ homeId, awayId, leagueId, weekIdx: week, season, salt, homePower: hPow, awayPower: aPow, homeSquad: hSq, awaySquad: aSq });
    const [eh, ea] = detScoreReplica(homeId, awayId, leagueId, week, season, salt, hPow, aPow);

    if (res.sh !== eh || res.sa !== ea) parityMismatch++;

    // değişmez: gol olayı sayısı (takım bazlı) == skor
    let gh = 0, ga = 0;
    for (const ev of res.events) {
        if (ev.type === 'goal') {
            totGoalEvents++;
            if (ev.teamId === homeId) gh++; else if (ev.teamId === awayId) ga++;
            if (ev.assistId != null) totAssists++;
            if (ev.ownGoal) totOwn++;
            else { const sc = idById[ev.playerId]; if (sc) { const f = FAM[sc.pos]; scorerFam[f] = (scorerFam[f] || 0) + 1; scorerKnown++; } }
        } else if (ev.type === 'yellow') totYellow++;
        else if (ev.type === 'red') totRed++;
        else if (ev.type === 'injury') totInjury++;
    }
    if (gh !== res.sh || ga !== res.sa) goalInvariantFail++;

    const tg = res.sh + res.sa; totGoals += tg;
    if (tg === 0) zero++; else if (tg === 1) one++; else if (tg === 2) two++; else if (tg === 3) three++; else fourPlus++;
}

function pct(x) { return (100 * x / N).toFixed(1) + '%'; }
const checks = [];
checks.push(['Skor paritesi (detScore ile birebir)', parityMismatch === 0, `${parityMismatch} uyuşmazlık / ${N}`]);
checks.push(['Değişmez: gol olayı sayısı = skor', goalInvariantFail === 0, `${goalInvariantFail} ihlal / ${N}`]);
checks.push(['Asist oranı makul (%55–%80)', (totAssists / totGoalEvents) >= 0.55 && (totAssists / totGoalEvents) <= 0.80, (100 * totAssists / totGoalEvents).toFixed(1) + '% gol asistli']);
const stW = (scorerFam.ST || 0) / scorerKnown, defW = ((scorerFam.CB || 0) + (scorerFam.GK || 0)) / scorerKnown;
checks.push(['Golcü dağılımı: ST baskın, savunma nadir', stW > 0.30 && defW < 0.12, `ST=${(100 * stW).toFixed(0)}% CB+GK=${(100 * defW).toFixed(1)}%`]);
const ypm = (totYellow) / N, rpm = totRed / N, ipm = totInjury / N;
checks.push(['Sarı kart/maç gerçekçi (2–5)', ypm >= 2 && ypm <= 5, ypm.toFixed(2) + ' sarı/maç']);
checks.push(['Kırmızı kart/maç gerçekçi (0.02–0.12)', rpm >= 0.02 && rpm <= 0.12, rpm.toFixed(3) + ' kırmızı/maç']);
checks.push(['Sakatlık/maç gerçekçi (0.03–0.18)', ipm >= 0.03 && ipm <= 0.18, ipm.toFixed(3) + ' sakatlık/maç']);

console.log(`\n=== FAZ 1a — istatistiksel maç modeli (${N} maç) ===`);
console.log(`Gol/maç: ${(totGoals / N).toFixed(2)} | Skor dağılımı: 0=${pct(zero)} 1=${pct(one)} 2=${pct(two)} 3=${pct(three)} 4+=${pct(fourPlus)}`);
console.log(`Golcü mevki dağılımı:`, Object.fromEntries(Object.entries(scorerFam).map(([k, v]) => [k, (100 * v / scorerKnown).toFixed(1) + '%'])));
console.log(`Kendi kalesine: ${totOwn} (${(100 * totOwn / totGoalEvents).toFixed(1)}% gollerin)\n`);
let pass = 0;
for (const [name, ok, info] of checks) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${name}${info ? '  — ' + info : ''}`); if (ok) pass++; }
console.log(`\nSONUÇ: ${pass}/${checks.length} geçti.`);
process.exit(pass === checks.length ? 0 : 1);
