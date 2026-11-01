-- v16b: qo'shimcha fazilatlar (oyat, hadis, ulamo so'zlari). Takror ishga tushirilsa ikki marta qo'shilmaydi.
insert into virtues (circle_id, kind, body, source)
select null, v.kind, v.body, v.source from (values
  ('hadith', 'Alloh uchun odamlardan ahllar bor. — «Ey Allohning elchisi, ular kimlar?» — «Qur''on ahli: ular Allohning ahli va Unga xos bandalaridir», dedi.', 'Ibn Moja, 215 (Anas roziyallohu anhu); isnodi sahih deb baholangan'),
  ('hadith', 'Qaysi bir qavm Allohning uylaridan birida to''planib, Allohning Kitobini tilovat qilsa va uni o''zaro o''rgansa, ularga sakina tushadi, rahmat o''rab oladi, farishtalar qurshab oladi va Alloh ularni huzuridagilar orasida eslaydi.', 'Muslim, 2699'),
  ('hadith', 'Albatta, Alloh bu Kitob (Qur''on) sabab ba''zi qavmlarni ko''taradi, boshqalarini esa tushiradi.', 'Muslim, 817'),
  ('hadith', 'Faqat ikki kishiga havas qilinadi: Alloh unga Qur''on bergan, u kecha-kunduz uni (tilovat qilib, unga amal qilib) turgan kishi va (ikkinchisi) mol berilib, uni kecha-kunduz Alloh yo''lida sarflab turgan kishi.', 'Buxoriy, Muslim'),
  ('ayah', 'Qur''onni tartil bilan (shoshilmay, ravshan) o''qi.', 'Muzzammil surasi, 4-oyat'),
  ('ayah', 'Aslida u (Qur''on) ilm berilgan kishilarning ko''ksidagi ravshan oyatlardir.', 'Ankabut surasi, 49-oyat'),
  ('ayah', 'Albatta, uni (qalbingda) jam qilish va (tilingda) o''qitish Bizning zimmamizdadir.', 'Qiyoma surasi, 17-oyat'),
  ('ayah', 'Bilingki, qalblar faqat Allohning zikri bilan xotirjam bo''ladi.', 'Ra''d surasi, 28-oyat'),
  ('ayah', 'Albatta, bu Qur''on eng to''g''ri yo''lga yo''llaydi va yaxshi amallar qiladigan mo''minlarga katta ajr borligini xushxabar qiladi.', 'Isro surasi, 9-oyat'),
  ('scholar', 'Qur''on hamili odamlar uxlab yotganda kechasi bilan, odamlar yeb-ichib yurganda kunduzi bilan tanilishi kerak: odamlar xursand bo''lganda g''amgin, odamlar kulganda yig''loq, odamlar behuda gapirganda sukutli, odamlar kibrlanganda xokisor bo''lishi lozim.', 'Abdulloh ibn Mas''ud roziyallohu anhu; Ahmad, «az-Zuhd», 892 (ma''noviy tarjima)'),
  ('scholar', 'Sizdan oldingilar Qur''onni Robbilaridan kelgan maktub deb bilardilar: kechasi uni mulohaza qilardilar, kunduzi unga amal qilardilar.', 'Hasan Basriy rahimahulloh; Imom Navaviy, «at-Tibyon» (ma''noviy tarjima)'),
  ('scholar', 'Qur''on hamili Islom bayrog''ini ko''taruvchidir. Unga bekorchilar bilan birga bekor gap qilish yarashmaydi.', 'Fudayl ibn Iyoz rahimahulloh; Ajurriy, «Axloqu hamalatil Qur''on», 37 (ma''noviy tarjima)'),
  ('scholar', 'Qur''on hamilining na xalifaga, na undan pastdagi kimsaga hojati bo''lmasligi kerak.', 'Fudayl ibn Iyoz rahimahulloh; Abu Nuaym, «Hilyatul avliyo», 8/92 (ma''noviy tarjima)')
) as v(kind, body, source)
where not exists (select 1 from virtues x where x.body = v.body);
