import { align, norm, words } from "./analyze.ts";
import fs from "node:fs";
let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log("FAIL", m); } };
const q = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const build = (s: number, a1: number, a2: number) => {
  const ref: any[] = [];
  for (let a = a1; a <= a2; a++) words(q[s - 1].verses[a - 1].text).forEach((w, i) => ref.push({ w, ayah: a, no: i + 1 }));
  return ref;
};
ok(norm("ٱلرَّحۡمَٰنِ") === "الرحمن", "norm " + norm("ٱلرَّحۡمَٰنِ"));
const ref = build(78, 1, 10); // An-Naba 1-10
const clean = ref.map((r) => r.w);
// 1) ideal
let r = align(ref, clean); ok(r.issues.length === 0 && r.matched === ref.length, "ideal " + JSON.stringify(r.issues));
// 2) boshida a'uzu+basmala, oxirida ortiqcha: e'tiborga olinmaydi
r = align(ref, [...words("أعوذ بالله من الشيطان الرجيم بسم الله الرحمن الرحيم"), ...clean, ...words("صدق الله العظيم")]);
ok(r.issues.length === 0, "boshi/oxiri ortiqcha " + JSON.stringify(r.issues));
// 3) bitta so'z tushib qoldi (oyat 3, 2-so'z)
const miss = ref.filter((x) => !(x.ayah === 3 && x.no === 2)).map((x) => x.w);
r = align(ref, miss); ok(r.issues.length === 1 && r.issues[0].kind === "missing" && (r.issues[0] as any).ayah === ref.find((x) => x.ayah === 3)!.ayah, "missing " + JSON.stringify(r.issues));
// 4) so'z almashdi
const sub = [...clean]; const idx = ref.findIndex((x) => x.ayah === 5 && x.no === 1); sub[idx] = "كتاب";
r = align(ref, sub); ok(r.issues.length === 1 && r.issues[0].kind === "wrong" && (r.issues[0] as any).ayah === 5, "wrong " + JSON.stringify(r.issues));
// 5) o'rtada ortiqcha so'z
const ex = [...clean.slice(0, 8), "وهو", "يقول", ...clean.slice(8)];
r = align(ref, ex); ok(r.issues.length === 1 && r.issues[0].kind === "extra", "extra " + JSON.stringify(r.issues));
// 6) oxirigacha o'qilmadi (oyat 9-10 yo'q)
const cut = ref.filter((x) => x.ayah <= 8).map((x) => x.w);
r = align(ref, cut); ok(r.issues.filter((i) => i.kind === "missing").length === 2, "cut " + JSON.stringify(r.issues));
// 7) Whisper imlosi (Uthmani vs oddiy): Baqara 2:3 "الصلاة" => "الصلوة"
ok(align(build(2, 3, 3), words("الذين يؤمنون بالغيب ويقيمون الصلاة ومما رزقناهم ينفقون")).issues.length === 0, "imlo");
console.log(fail ? "FAILED " + fail : "ALL OK");
