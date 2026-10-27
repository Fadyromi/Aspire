# Aspire CRM — خطوات التشغيل والنشر (مجاناً)

نظام لمتابعة الـ Leads لشركة Aspire Securities & Bonds. الواجهة إنجليزي، وبيشتغل على:

- **Supabase** (مجاني): تسجيل الدخول + قاعدة البيانات + الصلاحيات.
- **GitHub Pages** (مجاني): استضافة الواجهة.

الوقت المتوقع: حوالي 30 دقيقة لأول مرة.

---

## الأدوار والصلاحيات

| | Super Admin | Supervisor | Employee |
|---|:-:|:-:|:-:|
| يشوف كل الـ Leads | ✅ | ✅ | ❌ (المسندة له فقط) |
| يوزّع / يعيد توزيع Leads | ✅ | ✅ | ❌ |
| يضيف Lead / يستورد CSV | ✅ | ✅ | ✅ (بتتسجل عليه) |
| يغيّر Status ويكتب Notes | ✅ | ✅ | ✅ (على Leads بتاعته) |
| يمسح Lead | ✅ | ❌ | ❌ |
| ينشئ / يمسح / يوقف حسابات الموظفين | ✅ | ❌ | ❌ |
| يغيّر Role أو يعمل Reset لباسورد | ✅ | ❌ | ❌ |

الصلاحيات متطبقة **داخل قاعدة البيانات نفسها** (Row Level Security)، مش بس مخفية في الواجهة.

**الـ Pipeline:** New ← Not Reached / Contacted ← Interested / Not Interested ← Negotiating ← Signed

---

## الخطوة 1: إنشاء مشروع Supabase

1. ادخل على https://supabase.com وسجّل حساب مجاني.
2. **New project** ← اكتب اسم (مثلاً `aspire-crm`) ← اختار باسورد لقاعدة البيانات واحفظه ← اختار أقرب Region (مثلاً Frankfurt).
3. استنى دقيقتين لحد ما المشروع يجهز.

## الخطوة 2: إنشاء الجداول والصلاحيات

1. من القائمة الجانبية: **SQL Editor** ← **New query**.
2. افتح ملف `schema.sql` وانسخ كل محتواه والصقه ← **Run**.

## الخطوة 3: إنشاء أول Super Admin

1. **Authentication** ← **Users** ← **Add user** ← اكتب إيميلك وباسورد ← فعّل **Auto Confirm User**.
2. ارجع **SQL Editor** وشغّل (غيّر الإيميل والاسم):

```sql
update public.profiles
   set role = 'super_admin', full_name = 'Your Name'
 where email = 'you@aspire.com';
```

3. **مهم للأمان:** من **Authentication** ← إعدادات Sign In / Providers ← اقفل **Allow new users to sign up** (عشان محدش من بره يقدر يسجل بنفسه). الحسابات هتتعمل من صفحة Team بس.

## الخطوة 4: نشر الـ Edge Function (اللي بتخلي الـ Super Admin ينشئ ويمسح الموظفين)

دي لازم تتنشر لأن إنشاء المستخدمين محتاج مفتاح سري ما ينفعش يكون في المتصفح.

**من الموقع (الأسهل):**
1. **Edge Functions** ← **Deploy a new function** ← **Via Editor**.
2. الاسم: `admin-users` (بالظبط).
3. امسح الكود الموجود وانسخ محتوى `supabase/functions/admin-users/index.ts` والصقه ← **Deploy**.
4. سيب **Verify JWT** شغّال (الوضع الافتراضي).

**أو من الـ CLI:**
```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy admin-users
```

## الخطوة 5: ربط الواجهة بـ Supabase

1. في Supabase: **Project Settings** ← **API**.
2. انسخ **Project URL** و **anon public key**.
3. افتح `config.js` وحطهم:

```js
window.APP_CONFIG = {
  SUPABASE_URL: 'https://xxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJ...',
};
```

الـ anon key آمن إنه يتنشر؛ اللي بيحمي البيانات هو ملف `schema.sql`. **ما تنشرش** الـ `service_role` key أبداً (ومش محتاجه في أي ملف هنا).

## الخطوة 6: النشر على GitHub Pages

1. اعمل حساب على https://github.com ← **New repository** (اسم مثلاً `aspire-crm`).
2. ارفع الملفات: `index.html` و `app.js` و `styles.css` و `config.js` و `logo.png` (Add file ← Upload files).
3. **Settings** ← **Pages** ← Source: **Deploy from a branch** ← Branch: `main` / `(root)` ← **Save**.
4. بعد دقيقة هيظهر لينك زي: `https://USERNAME.github.io/aspire-crm/`

ملاحظات:
- GitHub Pages المجاني بيحتاج الـ repository يكون **Public**. ده آمن لأن مفيش بيانات عملاء في الملفات، بس الكود نفسه هيبقى ظاهر. لو عايزه Private ومجاني، استخدم **Cloudflare Pages** (بيقبل repo خاص) بنفس الملفات.
- الصفحة فيها `noindex` فمش هتظهر في جوجل، بس اللينك نفسه مش سري، والدخول بحسابات بس.

## الخطوة 7: الاستخدام

1. ادخل بحساب الـ Super Admin.
2. **Team** ← **+ New user** ← اكتب الاسم والإيميل وباسورد مؤقت والـ Role، وادّي البيانات للموظف.
3. **Leads** ← استورد ملف CSV (الأعمدة: name, phone, email, source, capital) أو أضف Lead يدوي.
4. حدد أكتر من Lead بالـ checkbox ← اختار موظف ← **Assign selected**.

---

## ملاحظات مهمة

- **الباك أب:** الخطة المجانية في Supabase مفيهاش نسخ احتياطي تلقائي، فاعمل **Export CSV** من صفحة Leads بشكل دوري.
- **الإيقاف المؤقت:** مشاريع Supabase المجانية بتتوقف لو مفيش استخدام لمدة أسبوع تقريباً. لو حصل، بتدخل لوحة Supabase وتضغط Restore. الاستخدام اليومي للفريق بيمنع ده.
- **الحجم:** الخطة المجانية كفاية لآلاف الـ Leads وعدد موظفين صغير. لو كبرتوا، الترقية بتتم من نفس المشروع من غير تغيير في الكود.
- **بيانات العملاء:** هتتخزن على سيرفرات Supabase خارج مصر. راجعوا مع الإدارة أو مسؤول الامتثال لو في سياسات داخلية بخصوص ده.

## افتراضات اتحطت (وسهل تتعدل)

- الـ Supervisor بيشوف كل الـ Leads (مش فريق معين). الـ Employee بيشوف المسندة له بس.
- مسح الـ Lead للـ Super Admin بس.
- مسح موظف بيسيب الـ Leads بتاعته **Unassigned** (مش بتتمسح).
- المبلغ المتوقع بالجنيه (EGP).
- أي تغيير في الـ Status أو التوزيع بيتسجل تلقائياً في Notes الخاصة بالـ Lead.
- لو رقم التليفون متكرر عند الإضافة اليدوي أو الاستيراد، النظام بيمنعه (بالنسبة للـ Leads اللي المستخدم يقدر يشوفها).

## الملفات

| ملف | وظيفته |
|---|---|
| `index.html`, `app.js`, `styles.css`, `logo.png` | الواجهة |
| `config.js` | بيانات الاتصال بـ Supabase |
| `schema.sql` | الجداول والصلاحيات (بتتشغل مرة واحدة) |
| `supabase/functions/admin-users/index.ts` | إنشاء/مسح/تعديل الحسابات (Super Admin فقط) |
