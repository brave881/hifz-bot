// Ovoz tahlili: Whisper matnini Qur'on matni bilan so'zma-so'z solishtiradi (sof funksiyalar).
// Faqat harf/so'z darajasi: tajvid va talaffuzni baholamaydi.

const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ࣓-ࣿ‌‍]/g;
export function norm(w: string): string {
  return w.replace(MARKS, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/[^ء-ي]/g, "");
}
export const words = (t: string) => t.split(/\s+/).map(norm).filter(Boolean);

function sim(a: string, b: string): number {
  if (a === b) return 1;
  const n = a.length, m = b.length;
  if (!n || !m) return 0;
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur = [i];
    for (let j = 1; j <= m; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[m] / Math.max(n, m);
}
// shundan yuqori o'xshashlik = to'g'ri o'qilgan (Whisper imlo farqlari uchun); uzun so'zlarda biroz yumshoqroq
const matchOf = (a: string, b: string) => sim(a, b) >= (Math.max(a.length, b.length) >= 5 ? 0.6 : 0.7);

export type Ref = { w: string; ayah: number; no: number }; // ayah = global oyat raqami, no = oyatdagi so'z tartibi (1..)
export type Issue =
  | { kind: "missing"; ayah: number; from: number; to: number; text: string }
  | { kind: "wrong"; ayah: number; no: number; heard: string; expected: string }
  | { kind: "extra"; ayah: number; no: number; text: string };

// Etalon (ref) to'liq o'qilgan deb hisoblanadi; hyp ichida boshida/oxirida ortiqcha so'zlar (a'uzu, basmala, izoh) bepul.
export function align(ref: Ref[], hyp: string[]): { issues: Issue[]; matched: number; total: number } {
  const n = ref.length, m = hyp.length;
  const D: Float32Array[] = Array.from({ length: n + 1 }, () => new Float32Array(m + 1));
  const B: Uint8Array[] = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1)); // 1 diag, 2 up(missing), 3 left(extra)
  for (let i = 1; i <= n; i++) { D[i][0] = i; B[i][0] = 2; }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = matchOf(ref[i - 1].w, hyp[j - 1]);
      const diag = D[i - 1][j - 1] + (s ? 0 : 1);
      const up = D[i - 1][j] + 1;
      const left = D[i][j - 1] + 1;
      if (diag <= up && diag <= left) { D[i][j] = diag; B[i][j] = 1; }
      else if (up <= left) { D[i][j] = up; B[i][j] = 2; }
      else { D[i][j] = left; B[i][j] = 3; }
    }
  }
  // oxirgi ortiqcha so'zlar bepul: eng yaxshi j
  let j = 0, best = D[n][0];
  for (let k = 1; k <= m; k++) if (D[n][k] < best) { best = D[n][k]; j = k; }
  const ops: { t: "m" | "s" | "d" | "i"; r?: number; h?: number }[] = [];
  let i = n;
  while (i > 0 || j > 0) {
    const b = i === 0 ? 3 : j === 0 ? 2 : B[i][j];
    if (b === 1) { ops.push({ t: matchOf(ref[i - 1].w, hyp[j - 1]) ? "m" : "s", r: i - 1, h: j - 1 }); i--; j--; }
    else if (b === 2) { ops.push({ t: "d", r: i - 1 }); i--; }
    else { ops.push({ t: "i", h: j - 1 }); j--; }
  }
  ops.reverse();
  // boshidagi ortiqcha so'zlar (birinchi mos kelishdan oldin) e'tiborga olinmaydi
  let start = 0;
  while (start < ops.length && ops[start].t === "i") start++;
  const issues: Issue[] = [];
  let matched = 0, lastRef = -1;
  for (let k = start; k < ops.length; k++) {
    const o = ops[k];
    if (o.t === "m") { matched++; lastRef = o.r!; continue; }
    if (o.t === "s") {
      const r = ref[o.r!];
      issues.push({ kind: "wrong", ayah: r.ayah, no: r.no, heard: hyp[o.h!], expected: r.w });
      lastRef = o.r!; continue;
    }
    if (o.t === "d") {
      const r = ref[o.r!];
      const prev = issues[issues.length - 1];
      if (prev && prev.kind === "missing" && prev.ayah === r.ayah && prev.to === r.no - 1) { prev.to = r.no; prev.text += " " + r.w; }
      else issues.push({ kind: "missing", ayah: r.ayah, from: r.no, to: r.no, text: r.w });
      lastRef = o.r!; continue;
    }
    // ortiqcha so'z: faqat o'qishning o'rtasida bo'lsa (oxiridagilar e'tiborga olinmaydi)
    if (lastRef >= 0 && k < ops.length && ops.slice(k + 1).some((x) => x.t !== "i")) {
      const r = ref[lastRef];
      const prev = issues[issues.length - 1];
      if (prev && prev.kind === "extra" && prev.ayah === r.ayah && prev.no === r.no) prev.text += " " + hyp[o.h!];
      else issues.push({ kind: "extra", ayah: r.ayah, no: r.no, text: hyp[o.h!] });
    }
  }
  return { issues, matched, total: n };
}
