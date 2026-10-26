<div dir="rtl" style="text-align: right;">

# تحويل الشحنة إلى بوسطة — Re-Assign Package Zone BOSTA (`Re-Assign-Package-Zone-BOSTA`)

![version](https://img.shields.io/badge/worker-v1.1.0-blue)

**بتعمل إيه:** Worker بيدور على أوردر (برقمه أو بـ Order ID من الباركود)، **بيحكم هو** إذا كان مؤهل
يتحوّل لبوسطة، وبيكتب التحويل على شوبيفاي بنداء واحد ذرّي.
**مين بيستخدمها:** الشحن والتحصيل — من جوّه هب `Delivery-COD-Operations-Center` (قسم «أدوات أخرى»).
**الإصدار:** `v1.1.0` (`WORKER_VERSION` في `index.js`)

> 🔴 **الريبو ده Worker وبس.** الواجهة `Re-Assign-Package-Zone-BOSTA.html` عايشة في ريبو
> `Delivery-COD-Operations-Center` وهي **النسخة الوحيدة** (نفس نمط `Partial-Delivery` و`Courier-Names`).
> أي تعديل على الشاشة هناك، وأي تعديل على الأهلية أو الكتابة **هنا**.
> ⛔ **ومفيش GitHub Pages ولا `index.html` هنا.**

## الروابط

```
الـ Worker : https://re-assign-package-zone-bosta-worker.ecommoda-dev.workers.dev
tool في D1 : re_assign_package_zone_bosta   ← reassign_to_bosta · rejected   (+ صف في metafields_change/update)
مجموعة السر : delivery_cod_ops              ← نفس قيمة Worker الهب وباقي أدواته
```

## الـ endpoints

| `?action=` | الطريقة | بيعمل إيه |
|---|---|---|
| `get_config` | GET | النسخة (حارس نسخة الهب) |
| `diag` | GET | فحص ذاتي بلا كتابة: السر وبصمته · المتغيرات · D1 · OAuth · **صلاحية `write_orders`** · **تعريفات الميتافيلدز الأربعة والقيم المطلوبة في الـ choice list** · `throttleStatus` و`actualQueryCost` |
| `get_order&q=` | GET | بحث (اسم أو Order ID) → `{ found, order, eligibility }` — **قراءة بحتة** |
| `reassign_to_bosta` | POST `{ orderId, employee }` | التحويل (الجسم **مفيهوش** أي قيم ميتافيلد — الـ Worker هو اللي بيحدد الأهداف) |
| `get_logs` · `get_logs_count` · `get_logs_export` | GET | سجل الأداة (`export` بيرجّع `cap`/`total`/`truncated`). 🔴 **فلاتر v1.1.0 (server-side، نفسها في التلاتة):** `employees` · `types` · **`results`** (من `extra.result`) · **`orderName`** · **`notes`** · `search` · `dateFrom`/`dateTo` (`YYYY-MM-DD` — ⚠️ بيقارن بيوم **UTC** المخزّن) · `sortBy` ∈ `date · time · employee · orderName · type · machine · result` + `sortDir` |
| `get_log_options` | GET | 🔴 v1.1.0 — الموظفين اللي ليهم صفوف تحت الأداة (`{ employees: [{ value, count }] }`) لفلتر الموظف في تاب السجل. من D1 مش قايمة ثابتة |

> 🔴 **الواجهة بتسكن أكتر من أوردر (v1.1.0 · 26-10-2026) والـ Worker لسه «أوردر واحد في النداء»** — `get_order` و`reassign_to_bosta` ما اتغيّروش، والصفحة هي اللي بتتابع الدفعة (فحص ٢ في نفس الوقت · تحويل متتابع). **ما اتضافش endpoint دفعة عن قصد:** كل أوردر بيتحوّل بـ `compareDigest` بتاعه وقراءة تحقق لوحده، فنتيجة كل أوردر مستقلة ومفيش «دفعة ناجحة نص نص». ميزانية شوبيفاي مشتركة بين Workers الستاك — ٣ نداءات GraphQL للأوردر.

> ⛔ **مفيش `verify_employee`/`log_logout`** — الدخول والخروج في Worker الهب. دالة بلا endpoint = كود ميت.

## 🔴 الأهلية — مصدر واحد: `evaluateEligibility` في `index.js`

الواجهة بترسم رده بس، و`reassign_to_bosta` **بيعيد الفحص على قراءة جديدة** (worker-builder ⑩ ④) — لقطة قديمة في المتصفح مابتكتبش.

| الشرط (طلب أحمد 24-10-2026) | لو اتخرق |
|---|---|
| `S1 = Ready` **أو** `S2 = Ready` | `not_ready` — بيقول S1 وS2 بقيمتهم الحرفية |
| `zone ∈ {Show_Room, Cairo+Giza}` | `zone_other` (Other_Regions) · `zone_blank` (BLANK/غايب) · `zone_unknown` (القيمة بالحرف) |
| مش ملغي (`cancelledAt` أو S1 `Cancelled`) | `cancelled` — **شرط زيادة** عن الطلب (كتابة على ملغي مالهاش معنى) |
| مش S1 وS2 الاتنين Ready | `both_ready` — غموض: أنهي ماكينة تتكتب؟ |

- كل الأسباب بتتعرض **مع بعض** (مش أول واحد بس).
- 🔴 **`already` حالة مستقلة:** الحالة بعد التحويل + `zone = Other_Regions` + `courier = Bosta` = «اتحوّل قبل كده» — **مش فشل**، سبب واحد، لون محايد، صف `rejected`/`already`.
- ⚠️ **الصف المؤهل S1 بيتحسب S1 لو S1 Ready** حتى لو S2 قديمة (`Returned`…)؛ S2 بيتحسب لو S1 مش Ready وS2 Ready.

## 🔴 الكتابة — أربع ميتافيلدز في `metafieldsSet` واحد

| الحقل | القيمة |
|---|---|
| S1: `custom.manual_status` | `Ready` ← **`Confirmed`** |
| **أو** S2: `custom.status_2_r_e` | `Ready` ← **`Confirmed + EXCHANGE`** (⚠️ دايمًا EXCHANGE — ثابت `S2_TARGET`، قرار أحمد 24-10-2026) |
| `custom.zone` | ← **`Other_Regions`** |
| `custom.courier` | ← **`Bosta`** |
| `custom.package_shipping_re_assign` | ← **`Bosta`** (علامة التحويل — قرار أحمد 24-10-2026) |

- 🔴 **ذرّي** — كلهم أو ولا واحد. وكل ميتافيلد موجودة بـ **`compareDigest`** بتاعها (من القراءة الجديدة) → لو حد غيّرها بين القراءة والكتابة: `STALE_OBJECT` وما اتكتبش حاجة. ميتافيلد غايبة بتتكتب من غير digest.
- 🔴 **الفحوصات التلاتة (Step 5A ②):** `shopifyGQL` بترمي على خطأ علوي · `userErrors` · كل ميتافيلد رجعت بقيمتها في الـ payload.
- 🔴 **قراءة تحقق بعد الكتابة** (`classifyAfter`): `applied` / `unchanged` / `partial`. استثناء بعد الإرسال = **مش عارفين** → القراءة هي اللي بتحسم (نفّذ ← `warning` مع شرح · ما اتنفّذش ← `error` يعيد المحاولة · جزئي ← `warning` أحمر بالتفصيل). فشل قراءة التحقق مع تأكيد الـ payload = `success` (`verified: 'payload'`)، وبدون تأكيد = `warning`.
- 🔴 **انتقال S1 `Ready → Confirmed` مش في جدول الانتقالات المسموحة** (`ecommoda-order-lifecycle` §1.4: `Ready` ← `Shipped` · `Confirmed + Edit` · `Pending Edit` · `Cancelled`). **قرار أحمد صريح لأداة واحدة بنطاق مقفول** — مش قاعدة عامة، وأي أداة تانية تحتاجه تتسأل. ⚠️ الجدول في المهارة **لسه محتاج تحديث** (خارج الريبو ده).
- ⛔ **مفيش «تراجع» في الأداة** — التعديل العكسي يدوي من شوبيفاي.

## النتيجة والسجل

- **HTTP 200 دايمًا** لأي نتيجة عمل — الفشل جوّه `status` ∈ `success` · `warning` · `error` · `already` · `rejected`. (غير 2xx بيخلّي `ecoApi` يفقد الرسالة.) `400` للطلب الباظ · `405` لـ GET. (أوردر مش موجود وقت الكتابة = 200 + `status:'error'`.)
- عقد `results[]`: الرد أوردر واحد — مفيش ترتيب يتطابق.
- **صفوف D1** (`log-values.json` · `node check-log-values.mjs` لازم يعدّي):
  | `tool` / `type` | امتى | `extra.result` |
  |---|---|---|
  | `re_assign_package_zone_bosta` / `reassign_to_bosta` | النداء وصل لشوبيفاي | `success` · `warning` · `error` |
  | `re_assign_package_zone_bosta` / `rejected` | اتوقف **قبل** أي كتابة | `rejected` · `already` |
  | `metafields_change` / `update` | الحالة اتغيّرت فعلاً (`extra.source = re_assign_package_zone_bosta` · `field` · `machine`) | `success` · `warning` |
- ⛔ **صفر اسم عميل/تليفون/عنوان في أي صف.** العميل بيتعرض في الشاشة بس.
- ⚠️ الاستعلامات اللي بتعدّ التحويلات لازم تفلتر على `extra.result` مش `type` لوحده.

## 🔴 قبل ما الأداة تشتغل (خطوات يدوية — خارج الكود)

1. إنشاء Worker `re-assign-package-zone-bosta-worker` من الريبو ده (Workers Builds · `main`) + `Build watch paths` = `index.js` و`wrangler.toml` (**chip لكل واحد**).
2. الأسرار: `WORKER_SECRET` = **قيمة مجموعة `delivery_cod_ops`** · `CLIENT_ID` · `CLIENT_SECRET` → **Promote**. وصلاحية **`write_orders`** على تطبيق شوبيفاي.
3. شغّل `?action=diag` — لازم كله ✅ (أهمه تعريفات الميتافيلدز والقيم المطلوبة في الـ choice list: الكتابة بقيمة مش فيها بترفض **الأربعة كلهم**).
4. **تسجيل في `ecommoda-constants`:** `tool = re_assign_package_zone_bosta` + `type` (`reassign_to_bosta` · `rejected`) في §7 **قبل أول `writeLog`** (Rule 7) · الأداة **كاتب سابع** تحت `metafields_change` · العضوية في `secret-groups.md` (مجموعة `delivery_cod_ops` بقت **أحد عشر Worker**) · ميتافيلد `custom.package_shipping_re_assign` (مين بيكتبه ومين بيقراه).
5. **تحديث `ecommoda-order-lifecycle`:** جدول الانتقالات (`Ready → Confirmed` لهذه الأداة بنطاقها).

قبل 1–2 الصفحة بتقول «تعذّر» والرسالة بتسمّي «تحويل الشحنة إلى بوسطة».

## الفحص

```bash
node docs/worker-check.mjs      # ٨٦ بند — شوبيفاي ووهمي + D1 وهمي (الأهلية · الكتابة الذرّية · compareDigest · الحالات · السجل وفلاتره · diag)
node check-log-values.mjs       # قيم اللوج — exit 0
```

⚠️ **ما اتجرّبش على شوبيفاي حقيقية (كتابة).** الاستعلام نفسه (الحقول + `compareDigest`) اتجرّب **قراءة** على المتجر، و`MetafieldsSetInput.compareDigest` اتأكد من الـ schema. أول تحويل حقيقي = الاختبار الفعلي.

## ثوابت وسقوف (مصدر كل رقم)

- مفيش `MAX_BATCH`/`CHUNK`/`ITEMS_PER_QUERY` — الأداة أوردر واحد في المرة (قراءة + كتابة + قراءة تحقق = ٣ نداءات GraphQL).
- `lineItems(first: 25)` — للعرض بس (مصدر: أوردر عادي ≤ ٢٥ صنف؛ الأوردر الأكبر بيتعرض ناقص ومفيش أثر على الأهلية).
- 🔴 البحث بالاسم: `orders(first: 5, query: "name:…")` **ومطابقة حرفية** بعدها — البحث بيرجّع أوردرات قريبة. والنص بيتحط في الـ query فالقايمة البيضاء (حروف/أرقام/شرطات) هي حارس الحقن.
- رقم ≥ ١٠ أرقام = Order ID أولاً، ولو مالقاش بنجرّب الاسم (أوردر اسمه رقم طويل ممكن).

## بصمة المهارات

| المهارة | الإصدار وقت آخر تعديل |
|---|---|
| ecommoda-worker-builder | **v3.10.0** |
| ecommoda-constants | **v3.1.0** |
| ecommoda-order-lifecycle | **v1.8.0** — ⚠️ الانتقال `Ready → Confirmed` مش في جدولها (قرار أحمد) |
| shopify-graphql-helper | **v1.1.0** |

> ⚠️ **بصمة v1.1.0 (26-10-2026):** تعديل الـ Worker في النسخة دي كان **توسيع `buildLogFilterSQL`** (`results` · `orderName` · `notes`) و`getLogOptions` + مفتاح ترتيب `type` — **ما اتراجعش على نسخ أحدث من المهارات** (الجدول فوق ما اتحدّثش عن قصد: ادعاء مراجعة ما حصلتش أسوأ من بصمة قديمة). الواجهة (في ريبو الهب) اتراجعت على `ecommoda-html-builder` v8.5.0. 🔴 `buildLogFilterSQL` هنا **انحرفت** عن النسخة في `ecommoda-worker-builder` → `references/shared-functions.md` بالباراميترات التلاتة — لو اتقرر تتعمم، تتنقل للمهارة (قرار أحمد).

آخر تحديث: 26-10-2026 — 10:40

</div>
