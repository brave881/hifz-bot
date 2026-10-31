import { afterBlock, ayahId, dayBlocks, endAfter, eta, fromId, nextBlock, pageOf, pagesIn, posEnd, startBefore, label } from "./plan.ts";
let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log("FAIL", m); } };
ok(ayahId(1, 1) === 1 && ayahId(114, 6) === 6236, "ids");
ok(fromId(6236).join() === "114,6" && fromId(7).join() === "1,7" && fromId(8).join() === "2,1", "fromId");
for (const id of [1, 77, 500, 3000, 6236]) { const [s, a] = fromId(id); ok(ayahId(s, a) === id, "roundtrip " + id); }
ok(pageOf(1) === 1 && pageOf(8) === 2 && pageOf(6236) === 604 && pageOf(6222) === 604, "pageOf");
ok(Math.abs(posEnd(6236) - 604) < 1e-9 && Math.abs(posEnd(7) - 1) < 1e-9, "posEnd");
// Naba (78:1) 582-bet; 30-juz 78:1 .. 114:6 ~ 23 bet (582..604)
const naba = ayahId(78, 1); ok(pageOf(naba) === 582, "naba page " + pageOf(naba));
ok(Math.abs(pagesIn(ayahId(2, 1), ayahId(2, 141)) - 20) < 1.0, "juz1 ~20 bet: " + pagesIn(ayahId(2, 1), ayahId(2, 141)));
const b = nextBlock(naba, 4, 1)!; ok(Math.abs(b.pages - 4) < 0.6, "4 bet: " + b.pages);
const bb = nextBlock(6236, 2, -1)!; ok(bb.to === 6236 && Math.abs(bb.pages - 2) < 0.6 && bb.from < 6236, "orqaga");
ok(endAfter(100, 0.001) >= 100, "min 1 oyat");
ok(afterBlock({ from: 1, to: 6236, pages: 0 }, 1) === null, "oxiri");
const days = dayBlocks(naba, 8, 1);
let tot = 0, prev = naba - 1;
days.forEach((d, i) => { if (d) { ok(d.from === prev + 1, "uzluksiz " + i); prev = d.to; tot += d.pages; } });
ok(Math.abs(tot - 8) < 0.8, "hafta jami " + tot);
ok(eta(10, 5, "2026-01-01") === "2026-01-15" && eta(0, 0, "2026-01-01") === "2026-01-01" && eta(5, 0, "2026-01-01") === null, "eta");
ok(startBefore(100, 1) < 100, "startBefore");
console.log(days.map((d) => d ? `${label(d.from)}→${label(d.to)} (${d.pages.toFixed(2)})` : "-").join("\n"));
console.log(fail ? "FAILED " + fail : "ALL OK");
