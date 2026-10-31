// Reja hisoblagichi: oyat <-> bet o'tkazmalari (sof funksiyalar, bazaga bog'liq emas)
import { AYAH_LEN, PAGE_FIRST, SURAH_AYAHS, SURAH_NAMES } from "./quran-data.ts";

export const TOTAL = 6236;
const START: number[] = [0]; // START[s] = s-surani birinchi oyatining global raqami - 1
for (let s = 0; s < 114; s++) START.push(START[s] + SURAH_AYAHS[s]);

export const ayahId = (s: number, a: number) => START[s - 1] + a;
export function fromId(id: number): [number, number] {
  let lo = 1, hi = 114;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (START[mid] >= id) hi = mid; else lo = mid + 1; }
  return [lo, id - START[lo - 1]];
}
export const label = (id: number) => { const [s, a] = fromId(id); return `${SURAH_NAMES[s - 1]} ${a}`; };
export const validSA = (s: number, a: number) => s >= 1 && s <= 114 && a >= 1 && a <= SURAH_AYAHS[s - 1];

export function pageOf(id: number): number {
  let lo = 0, hi = 603; // PAGE_FIRST[i] = 1-bet i+1
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (PAGE_FIRST[mid] <= id) lo = mid; else hi = mid - 1; }
  return lo + 1;
}
export const juzOf = (id: number) => { const p = pageOf(id); return p < 2 ? 1 : Math.min(30, Math.floor((p - 2) / 20) + 1); };

// kumulyativ harf soni
const CUM: number[] = [0];
for (let i = 0; i < TOTAL; i++) CUM.push(CUM[i] + AYAH_LEN[i]);

// "ohirigacha" bet koordinatasi: 0 .. 604 (kasr betdagi ulush). id=0 -> 0
export function posEnd(id: number): number {
  if (id <= 0) return 0;
  if (id >= TOTAL) return 604;
  const p = pageOf(id);
  const first = PAGE_FIRST[p - 1];
  const next = p < 604 ? PAGE_FIRST[p] : TOTAL + 1;
  const total = CUM[next - 1] - CUM[first - 1];
  const part = CUM[id] - CUM[first - 1];
  return p - 1 + part / total;
}
export const posStart = (id: number) => posEnd(id - 1);
export const pagesIn = (from: number, to: number) => Math.max(0, posEnd(to) - posStart(from));

// from dan boshlab ~pages bet o'qiladigan blokning oxirgi oyati (eng yaqin oyat chegarasi, kamida 1 oyat)
export function endAfter(from: number, pages: number): number {
  const target = posStart(from) + pages;
  let lo = from, hi = TOTAL;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (posEnd(mid) >= target) hi = mid; else lo = mid + 1; }
  // lo = target dan oshgan birinchi oyat; oldingisi yaqinroq bo'lishi mumkin
  if (lo > from && target - posEnd(lo - 1) < posEnd(lo) - target) lo -= 1;
  return Math.min(TOTAL, Math.max(from, lo));
}
// to da tugaydigan ~pages betlik blokning birinchi oyati
export function startBefore(to: number, pages: number): number {
  const target = posEnd(to) - pages;
  let lo = 1, hi = to;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (posStart(mid) >= target - 1e-9) hi = mid; else lo = mid + 1; }
  if (lo < to && posStart(lo) - target > target - posStart(lo - 1 < 1 ? 1 : lo - 1) && lo > 1) lo -= 1;
  return Math.max(1, Math.min(to, lo));
}

export type Dir = 1 | -1;
export interface Block { from: number; to: number; pages: number }
const mk = (from: number, to: number): Block => ({ from, to, pages: pagesIn(from, to) });

// ptr dan boshlab keyingi blok. dir=1: oldinga (ptr = blokning birinchi oyati), dir=-1: orqaga (ptr = blokning oxirgi oyati)
export function nextBlock(ptr: number, pages: number, dir: Dir): Block | null {
  if (ptr < 1 || ptr > TOTAL) return null;
  return dir === 1 ? mk(ptr, endAfter(ptr, pages)) : mk(startBefore(ptr, pages), ptr);
}
// blok tugagach yangi ptr (chegaradan chiqsa null = Qur'on tugadi)
export function afterBlock(b: Block, dir: Dir): number | null {
  const p = dir === 1 ? b.to + 1 : b.from - 1;
  return p < 1 || p > TOTAL ? null : p;
}

// haftalik yo'lak: hafta boshidagi ptr va maqsad G bet. Kun i (0..5) oxirigacha kumulyativ G*(i+1)/6 bet
export function dayBlocks(weekPtr: number, goal: number, dir: Dir): (Block | null)[] {
  const out: (Block | null)[] = [];
  let ptr: number | null = weekPtr;
  let done = 0;
  for (let i = 0; i < 6; i++) {
    const want = goal * (i + 1) / 6 - done;
    if (ptr === null || want <= 0.01) { out.push(null); continue; }
    const b = nextBlock(ptr, want, dir);
    if (!b) { out.push(null); continue; }
    out.push(b);
    done += b.pages;
    ptr = afterBlock(b, dir);
  }
  return out;
}
export function weekBlock(weekPtr: number, goal: number, dir: Dir): Block | null {
  return nextBlock(weekPtr, goal, dir);
}

// o'rtacha tezlik va tugash sanasi
export function eta(remainingPages: number, pagesPerWeek: number, today: string): string | null {
  if (remainingPages <= 0) return today;
  if (pagesPerWeek <= 0.01) return null;
  const days = Math.ceil(remainingPages / pagesPerWeek * 7);
  return new Date(Date.parse(today + "T00:00:00Z") + days * 864e5).toISOString().slice(0, 10);
}

export const fmtRange = (b: Block) => b.from === b.to ? label(b.from) : `${label(b.from)} → ${label(b.to)}`;
