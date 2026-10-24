// ══════════════════════════════════════════════════════════════
// §HEADER
// Re-Assign-Package-Zone-BOSTA — EcomModa
// Worker: re-assign-package-zone-bosta-worker
// Tool:   تحويل شحنة من (مناديب / شو روم) إلى بوسطة — `Ready` → `Confirmed`
//
// skills: worker-builder v3.10.0 · constants v3.1.0 · order-lifecycle v1.8.0 · shopify-graphql-helper v1.1.0
//
// 🔴 **الريبو ده Worker وبس.** الواجهة هي `Re-Assign-Package-Zone-BOSTA.html`
//    جوّه هب مركز عمليات الشحن والتحصيل (قسم «أدوات أخرى») — نسخة وحيدة.
//
// 🔴 **بتكتب على شوبيفاي — أربع ميتافيلدز في نداء واحد ذرّي (`metafieldsSet`):**
//      الحالة (S1 `manual_status` → `Confirmed` · أو S2 `status_2_r_e` →
//      `Confirmed + EXCHANGE`) · `custom.zone` → `Other_Regions` ·
//      `custom.courier` → `Bosta` · `custom.package_shipping_re_assign` → `Bosta`.
//    ذرّي = كلهم أو ولا واحد، فمفيش أوردر بيفضل نصه اتحوّل.
//
// 🔴 **الأهلية بتتحسب هنا في الـ Worker — مش في الواجهة.** الواجهة بترسم السبب
//    والزرار المعطّل من نفس رد `get_order`، و`reassign_to_bosta` **بيعيد الفحص
//    على قراءة جديدة** قبل الكتابة (worker-builder ⑩ ④): لقطة قديمة في المتصفح
//    ماتقدرش تكتب على أوردر حالته اتغيّرت. وفوق كده كل ميتافيلد بتتكتب بـ
//    `compareDigest` — لو حد غيّرها بين القراءة والكتابة الكتابة بترجع
//    `STALE_OBJECT` ومفيش حاجة بتتغيّر.
//
// 🔴 **انتقال `Ready → Confirmed` (S1) مش في جدول الانتقالات المسموحة في
//    `ecommoda-order-lifecycle` §1.4** (`Ready` → `Shipped` · `Confirmed + Edit`
//    · `Pending Edit` · `Cancelled`). ده **قرار أحمد صريح لأداة واحدة بنطاق
//    مقفول** (Ready + زون Show_Room/Cairo+Giza بس) — مش قاعدة عامة. أي أداة
//    تانية تحتاجه تتسأل. ⚠️ الجدول في المهارة محتاج تحديث (مكتوب في CLAUDE.md).
//
// ⚠️ **S2 بيتكتب دايمًا `Confirmed + EXCHANGE`** (قرار أحمد 24-10-2026) حتى لو
//    الدورة الأصلية كانت `Confirmed + RETURN` — أداة رفع بوسطة هتعملها شحنة
//    استبدال. القيمة في ثابت واحد (`S2_TARGET`).
//
// ⛔ **ممنوع يتضاف هنا أي فعل تاني.** تحويل لبوسطة وبس.
// ⛔ الدخول والخروج في Worker الهب (`delivery-cod-operations-center-worker`) —
//    الـ Worker ده مالوش `verify_employee`/`log_logout` عن قصد.
// ══════════════════════════════════════════════════════════════
const TOOL_NAME      = 're_assign_package_zone_bosta';
const WORKER_VERSION = '1.0.0';
const SECRET_GROUP   = 'delivery_cod_ops';

// ─── §CONSTANTS::status — القيم الحرفية (casing وعلامات الترقيم load-bearing) ───
const S1_READY     = 'Ready';
const S1_TARGET    = 'Confirmed';
const S2_READY     = 'Ready';
const S2_TARGET    = 'Confirmed + EXCHANGE';     // ⚠️ دايمًا EXCHANGE — قرار أحمد 24-10-2026
const ZONE_OTHER   = 'Other_Regions';            // بوسطة
const ZONES_ELIGIBLE = ['Show_Room', 'Cairo+Giza'];
const COURIER_BOSTA = 'Bosta';
const MARKER_VALUE  = 'Bosta';                   // custom.package_shipping_re_assign (choice list: Bosta)

// الميتافيلدز اللي الأداة بتقراها (alias → key). كلها namespace `custom`.
const MF_READ = {
  s1: 'manual_status', s2: 'status_2_r_e', zone: 'zone', courier: 'courier',
  whereS1: 'package_whereabouts_s1', whereS2: 'package_whereabouts_s2',
  trackS1: 'bosta_tracking_number_s1', trackS2: 'bosta_tracking_number_s2',
  marker: 'package_shipping_re_assign',
};
const MF_NS = 'custom';
const MF_TYPE = 'single_line_text_field';        // الأربعة اللي بنكتبهم كلهم من النوع ده (مؤكَّد من التعريف الحيّ 24-10-2026)

// ══════════════════════════════════════════════════════════════
// §CORS — Option B (قايمة صارمة) — أداة كتابة على شوبيفاي
// ══════════════════════════════════════════════════════════════
const ALLOWED_ORIGINS = ['https://ecommoda-dev.github.io'];
function getCORS(request) {
  const origin  = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

// ══════════════════════════════════════════════════════════════
// §HELPERS
// ══════════════════════════════════════════════════════════════
function json(data, status = 200, request = null) {
  const headers = { 'Content-Type': 'application/json' };
  Object.assign(headers, request ? getCORS(request) : { 'Access-Control-Allow-Origin': ALLOWED_ORIGINS[0] });
  return new Response(JSON.stringify(data), { status, headers });
}

// ─── §HELPERS::assertEnv ───
const ENV_REQUIRED = ['SHOP_DOMAIN', 'CLIENT_ID', 'CLIENT_SECRET'];
function assertEnv(env) {
  const missing = ENV_REQUIRED.filter(k => env[k] === undefined || env[k] === null || String(env[k]).trim() === '');
  if (!env.DB) missing.push('DB (D1 binding)');
  if (missing.length) {
    throw new Error(
      `متغيرات ناقصة في الـ Worker: ${missing.join('، ')} — ضِفها من ` +
      `Dashboard → Settings → Variables ثم Promote النسخة. (شغّل ?action=diag)`
    );
  }
}

// ─── §HELPERS::secretFingerprint — بصمة قصيرة لسر المجموعة (قيمة السر مش بتتسرّب) ───
async function secretFingerprint(secret) {
  if (!secret) return null;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return [...new Uint8Array(buf)].slice(0, 4).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ══════════════════════════════════════════════════════════════
// §SHARED — دوال السجل من `references/shared-functions.md` (بلا تعديل)
// ══════════════════════════════════════════════════════════════
// ⚠️ دوال الدخول (`verifyEmployee`/`checkEmployee`/`registerPin`) **مش هنا عن قصد**:
//    الدخول في Worker الهب، ودالة بلا endpoint = كود ميت.
// ⚠️ الاستثناء الوحيد: `writeLog` فيها الحارس الديناميكي (Step 7-ج) — بيكتب الصف
//    دايمًا ويعلّم `_unregistered` لو القيمة مش في `LOG_REGISTRY`.
/**
 * Write a log entry to D1.
 * Only tool and type are required. All other fields optional (null if not provided).
 */
async function writeLog(db, entry) {
  const unregistered = !isRegisteredLogValue(entry.tool, entry.type);
  const extra = unregistered
    ? { ...(entry.extra || {}), _unregistered: true }
    : entry.extra;

  await db.prepare(`
    INSERT INTO logs
      (timestamp, tool, type, employee, order_id, order_name,
       sku, product_title, delta, value_before, value_after, notes, extra)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    entry.timestamp    ?? new Date().toISOString(),
    entry.tool,
    entry.type,
    entry.employee     ?? null,
    entry.orderId      ?? null,
    entry.orderName    ?? null,
    entry.sku          ?? null,
    entry.productTitle ?? null,
    entry.delta        ?? null,
    entry.valueBefore  ?? null,
    entry.valueAfter   ?? null,
    entry.notes        ?? null,
    extra ? JSON.stringify(extra) : null
  ).run();

  if (unregistered) await noteUnregisteredLogValues(db, [entry]);   // بعد الكتابة، مش قبلها
}

const LOG_EXPORT_MAX = 2000;   // سقف التصدير — بيرجع للواجهة كـ `cap`

/**
 * بنّاء شرط الفلترة الموحّد للسجل — التلات دوال تحته بتستخدمه، فمفيش SQL
 * مكرر يتعتّق في واحدة منهم ويسيب التانية.
 *
 * كل الباراميترات **اختيارية**، والسلوك من غيرها **مطابق للنسخة القديمة
 * بالحرف** — الإضافة متوافقة رجوعيًا ١٠٠٪:
 *   employees[] / types[]  → قوايم. multi-select إلزامي في أي شاشة فيها جدول
 *                            (`ecommoda-html-builder` → data-table-standard.md
 *                            بند ٢١)، والسجل بقى جدول (بند ٢٦).
 *   employee / type        → قيمة واحدة — متسابة للتوافق مع واجهات قديمة.
 *   dateFrom / dateTo      → بيتقارنوا بـ substr(timestamp,1,10) — يعني **UTC**،
 *                            والعرض بتوقيت القاهرة (UTC+3). فرق التلات ساعات
 *                            ممكن يحط عملية بعد ٩ مساءً بتوقيت القاهرة في يوم
 *                            UTC اللي بعده. مقبول لفلتر بالأيام — **بس مكتوب**،
 *                            عشان مايتكتشفش كباج بعدين.
 * login/logout مستثنيين في SQL دايمًا — مش client-side.
 */
function buildLogFilterSQL(select, {
  tool      = null,
  employee  = null, employees = null,
  type      = null, types     = null,
  search    = null,
  dateFrom  = null, dateTo    = null,
} = {}) {
  let sql = `${select} FROM logs WHERE type NOT IN ('login','logout')`;
  const b = [];

  const emps = Array.isArray(employees) && employees.length ? employees : (employee ? [employee] : []);
  const typs = Array.isArray(types)     && types.length     ? types     : (type     ? [type]     : []);

  if (tool) { sql += ' AND tool = ?'; b.push(tool); }
  if (emps.length) {
    sql += ` AND employee IN (${emps.map(() => '?').join(',')})`; b.push(...emps);
  }
  if (typs.length) {
    sql += ` AND type IN (${typs.map(() => '?').join(',')})`; b.push(...typs);
  }
  if (search) {
    sql += ' AND (order_name LIKE ? OR notes LIKE ?)';
    b.push(`%${search}%`, `%${search}%`);
  }
  if (dateFrom) { sql += ' AND substr(timestamp, 1, 10) >= ?'; b.push(dateFrom); }
  if (dateTo)   { sql += ' AND substr(timestamp, 1, 10) <= ?'; b.push(dateTo); }

  return { sql, b };
}

/**
 * Fetch logs from D1 with server-side filtering + pagination.
 * Used for paginated display in the log tab (100 rows per page).
 * Max limit per page: 100 (enforced server-side).
 *
 * ⚠️ Do NOT use this for XLSX export — use getLogsExport() instead.
 */
async function getLogs(db, { limit = 100, offset = 0, sortBy, sortDir, ...filters } = {}) {
  const { sql, b } = buildLogFilterSQL('SELECT *', filters);
  const q = sql + orderByClause(sortBy, sortDir) + ' LIMIT ? OFFSET ?';
  return (await db.prepare(q)
    .bind(...b, Math.min(limit, 100), Math.max(offset, 0)).all()).results;
}

// ⚠️ قائمة **مقفولة** — القيمة جاية من العميل وبتتلزق في نص SQL مباشرةً
//    (ORDER BY مابيقبلش bind). أي قيمة بره القايمة بترجع للافتراضي بدون خطأ.
// ⚠️ المفاتيح لازم تطابق `data-sort-key` في الواجهة **حرفيًا** — مفتاح مش في
//    القايمة بيرجع للافتراضي في صمت، فالعمود يبان إنه اترتّب وهو مااترتّبش.
const LOG_SORT_COLUMNS = {
  date: 'timestamp', time: 'timestamp', employee: 'employee', orderName: 'order_name',
  machine: `json_extract(extra, '$.machine')`, result: `json_extract(extra, '$.result')`,
};

function orderByClause(sortBy, sortDir) {
  const col = LOG_SORT_COLUMNS[String(sortBy || '')] || 'timestamp';
  const dir = String(sortDir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  // 🔴 كاسر تعادل إلزامي: من غيره صفوف نفس القيمة بترتيب عشوائي بين الصفحات،
  //    والصف الواحد ممكن يظهر في صفحتين **أو مايظهرش خالص**.
  return col === 'timestamp' ? ` ORDER BY timestamp ${dir}`
                             : ` ORDER BY ${col} ${dir}, timestamp DESC`;
}

/**
 * Count total matching log rows.
 * Call in parallel with getLogs() (pagination UI) — and with getLogsExport()
 * (عشان الواجهة تعرف إن التصدير اتقص).
 */
async function getLogsCount(db, filters = {}) {
  const { sql, b } = buildLogFilterSQL('SELECT COUNT(*) as total', filters);
  const row = await db.prepare(sql).bind(...b).first();
  return row?.total ?? 0;
}

/**
 * Fetch all matching logs for XLSX export — up to LOG_EXPORT_MAX rows.
 * Never use getLogs() for export — it's limited to 100 rows per page.
 *
 * ⚠️ الدالة دي **بتقص في السكوت** بطبيعتها. المسؤولية اللي جنبها إلزامية:
 * الـ endpoint لازم يرجّع `cap` و`total` و`truncated` كمان — شوف تحت.
 */
async function getLogsExport(db, filters = {}) {
  const { sql, b } = buildLogFilterSQL('SELECT *', filters);
  // ⚠️ التصدير والعدّ **بيتجاهلوا الترتيب عن قصد** — العدّ مالوش ترتيب،
  //    والتصدير بياخد ترتيب السيرفر الافتراضي. تمرير sortBy/sortDir ليهم بيفتح
  //    باب اختلاف مصدر الباراميترات بين النداءات = تصدير مش مطابق للشاشة.
  const q = sql + ' ORDER BY timestamp DESC LIMIT ?';
  return (await db.prepare(q).bind(...b, LOG_EXPORT_MAX).all()).results;
}

/**
 * بيقرا فلاتر السجل من الـ query string — CSV للقوايم
 * (employees=ahmed,sara · types=cancel,cancel_failed).
 * الاسم المفرد لسه مقبول للتوافق الرجعي.
 */
function logParamsFrom(url, tool) {
  const csv = (k) => (url.searchParams.get(k) || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const employees = csv('employees'), types = csv('types');
  return {
    tool,
    employees: employees.length ? employees : null,
    employee:  url.searchParams.get('employee') || null,
    types:     types.length ? types : null,
    type:      url.searchParams.get('type')     || null,
    search:    url.searchParams.get('search')   || null,
    dateFrom:  url.searchParams.get('dateFrom') || null,
    dateTo:    url.searchParams.get('dateTo')   || null,
  };
}

// ════════════════════════════════════════════════════════════
// §LOG-REG — الحارس الديناميكي لقيم اللوج (الطبقة ٥)
// ════════════════════════════════════════════════════════════
// قطعة الأداة دي بس من log-values.json — بتتحدّث معاه في نفس الـ commit.
const LOG_REGISTRY = {
  [TOOL_NAME]:       new Set(['reassign_to_bosta', 'rejected']),
  metafields_change: new Set(['update']),
};
const isRegisteredLogValue = (tool, type) => !!LOG_REGISTRY[tool]?.has(type);

const LOG_ALERT_SQL = `
  INSERT INTO log_value_alerts
    (source_tool, tool, type, first_seen, last_seen, hits,
     worker_version, sample_order_name, sample_employee, sample_notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(source_tool, tool, type) DO UPDATE SET
    last_seen         = excluded.last_seen,
    hits              = log_value_alerts.hits + excluded.hits,
    worker_version    = excluded.worker_version,
    sample_order_name = excluded.sample_order_name,
    sample_employee   = excluded.sample_employee,
    sample_notes      = excluded.sample_notes,
    status            = CASE WHEN log_value_alerts.status = 'ignored'
                             THEN 'ignored' ELSE 'open' END
`;

async function noteUnregisteredLogValues(db, entries) {
  const byPair = new Map();
  for (const e of entries) {
    const key = `${e.tool}\u0000${e.type}`;
    const acc = byPair.get(key);
    if (acc) { acc.hits++; continue; }
    byPair.set(key, { entry: e, hits: 1 });
  }
  const now = new Date().toISOString();
  for (const { entry, hits } of byPair.values()) {
    try {
      await db.prepare(LOG_ALERT_SQL).bind(
        TOOL_NAME, entry.tool ?? '(بدون tool)', entry.type ?? '(بدون type)',
        now, now, hits, WORKER_VERSION ?? null,
        entry.orderName ?? null, entry.employee ?? null,
        entry.notes ? String(entry.notes).slice(0, 200) : null,
      ).run();
    } catch (e) { /* متعمّد: التنبيه فهرس، وفشله أهون من تعطيل الأداة */ }
  }
}

// ══════════════════════════════════════════════════════════════
// §SHOPIFY
// ══════════════════════════════════════════════════════════════
// ⚠️ التوكن ومعاه ميزانية GraphQL مشتركين بين كل Workers الستاك — worker-builder Step 5A ⑯
const OAUTH_MAX_ATTEMPTS = 3;

async function getAccessToken(env) {
  let lastErr = null;
  for (let attempt = 1; attempt <= OAUTH_MAX_ATTEMPTS; attempt++) {
    try {
      const resp = await fetch(`https://${env.SHOP_DOMAIN}/admin/oauth/access_token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: env.CLIENT_ID, client_secret: env.CLIENT_SECRET, grant_type: 'client_credentials' }),
      });
      if (!resp.ok) {
        const retriable = resp.status === 429 || resp.status >= 500;
        lastErr = new Error(`OAuth failed: ${resp.status}`);
        if (retriable && attempt < OAUTH_MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 700 * attempt)); continue; }
        throw lastErr;
      }
      const data = await resp.json();
      if (!data.access_token) throw new Error('No access_token in response');
      return data.access_token;
    } catch (e) {
      lastErr = e;
      if (attempt < OAUTH_MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 400 * attempt)); continue; }
      throw lastErr;
    }
  }
  throw lastErr || new Error('OAuth: فشل غير معروف');
}

// ─── §SHOPIFY::shopifyGQL — العقد الإلزامي (Step 5A ①): أي فشل بيترمي ───
let _lastThrottle = null, _lastQueryCost = null;

async function shopifyGQL(env, token, query, variables = {}, opName = 'shopify', costLog = null) {
  const MAX_ATTEMPTS = 3;
  let lastErr = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let resp, text;
    try {
      resp = await fetch(`https://${env.SHOP_DOMAIN}/admin/api/2026-01/graphql.json`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
        body:    JSON.stringify({ query, variables }),
      });
      text = await resp.text();
    } catch (e) {
      lastErr = new Error(`${opName}: فشل الاتصال بشوبيفاي — ${e.message}`);
      if (attempt < MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 400 * attempt)); continue; }
      throw lastErr;
    }

    if (!resp.ok) {
      const retriable = resp.status === 429 || resp.status >= 500;
      lastErr = new Error(`${opName}: شوبيفاي ردّت HTTP ${resp.status} — ${text.slice(0, 180)}`);
      if (retriable && attempt < MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 700 * attempt)); continue; }
      throw lastErr;
    }

    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error(`${opName}: رد شوبيفاي مش JSON صالح — ${text.slice(0, 180)}`); }

    if (Array.isArray(data.errors) && data.errors.length) {
      const codes = data.errors.map(e => e?.extensions?.code).filter(Boolean);
      lastErr = new Error(
        `${opName}: ${data.errors.map(e => e.message).join(' | ')}` +
        (codes.length ? ` [${codes.join(',')}]` : '')
      );
      if (codes.includes('THROTTLED') && attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, 1200 * attempt)); continue;
      }
      throw lastErr;
    }

    if (!data.data) throw new Error(`${opName}: رد شوبيفاي بدون data — ${text.slice(0, 180)}`);

    if (data.extensions?.cost) {
      const c = data.extensions.cost;
      if (c.throttleStatus) _lastThrottle = c.throttleStatus;
      _lastQueryCost = { op: opName, requested: c.requestedQueryCost ?? null, actual: c.actualQueryCost ?? null };
      if (costLog) costLog.push({ op: opName, requested: c.requestedQueryCost ?? null, actual: c.actualQueryCost ?? null });
    }
    return data;
  }
  throw lastErr || new Error(`${opName}: فشل غير معروف`);
}

// ══════════════════════════════════════════════════════════════
// §LOOKUP — قراءة الأوردر وحساب الأهلية
// ══════════════════════════════════════════════════════════════
// 🔴 `currentTotalPriceSet` مش `totalPriceSet` (order-lifecycle قاعدة ٣) · `legacyResourceId`
//    جنب الاسم دايمًا (الواجهة بتبني منه هايبرلينك الأوردر).
// ⚠️ بنقرا الأربع ميتافيلدز اللي بنكتبهم + `compareDigest` بتاعهم (للكتابة الآمنة).
const ORDER_FIELDS = `
  id legacyResourceId name createdAt cancelledAt
  displayFinancialStatus displayFulfillmentStatus
  currentTotalPriceSet { shopMoney { amount currencyCode } }
  shippingAddress { name city province }
  lineItems(first: 25) { nodes { title variantTitle sku currentQuantity } }
  ${Object.entries(MF_READ).map(([alias, key]) =>
    `${alias}: metafield(namespace: "${MF_NS}", key: "${key}") { value compareDigest }`).join('\n  ')}
`;
const Q_ORDER_BY_ID   = `query ReassignOrderById($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }`;
const Q_ORDER_BY_NAME = `query ReassignOrderByName($q: String!) { orders(first: 5, query: $q) { nodes { ${ORDER_FIELDS} } } }`;

// بيحوّل اللي الموظف كتبه/سكنه لـ { text, maybeId } أو null لو الصيغة مش مقبولة.
// ⚠️ النص بيتحط في query بحث — فالقايمة البيضاء (حروف/أرقام/شرطات) هي حارس الحقن.
function parseLookup(raw) {
  let t = String(raw ?? '').trim().replace(/^gid:\/\/shopify\/Order\//i, '').replace(/^#/, '');
  if (!/^[0-9A-Za-z_-]{1,40}$/.test(t)) return null;
  return { text: t, maybeId: /^\d{10,}$/.test(t) };
}

// 🔴 رقم طويل (≥١٠ أرقام) = Order ID من باركود، **بس** أوردر اسمه رقم طويل ممكن
//    يتواجد — فالـ ID الأول ولو مالقاش بنجرّب الاسم (نفس نمط `dcoScanParse` في الهب).
async function fetchOrder(env, token, lookup, costLog) {
  if (lookup.maybeId) {
    const d = await shopifyGQL(env, token, Q_ORDER_BY_ID, { id: `gid://shopify/Order/${lookup.text}` }, 'order_by_id', costLog);
    if (d.data.order) return { raw: d.data.order, matchedBy: 'id' };
  }
  const d = await shopifyGQL(env, token, Q_ORDER_BY_NAME, { q: `name:${lookup.text}` }, 'order_by_name', costLog);
  // مطابقة حرفية — بحث شوبيفاي ممكن يرجّع أوردرات قريبة في الاسم
  const hit = (d.data.orders?.nodes || []).find(o => String(o.name).replace(/^#/, '') === lookup.text);
  return hit ? { raw: hit, matchedBy: 'name' } : { raw: null, matchedBy: null };
}

// بيحوّل رد شوبيفاي للشكل اللي الواجهة بتقراه. `digests` ما بتروحش للعميل.
function shapeOrder(o) {
  const val = (a) => { const v = o[a]?.value; return (v === undefined || v === null || String(v).trim() === '') ? null : String(v).trim(); };
  const digests = {};
  for (const alias of Object.keys(MF_READ)) digests[alias] = o[alias]?.compareDigest ?? null;
  const m = o.currentTotalPriceSet?.shopMoney;
  const shaped = {
    orderId:     String(o.legacyResourceId ?? String(o.id).split('/').pop()),
    orderNumber: o.name,
    createdAt:   o.createdAt || null,
    cancelledAt: o.cancelledAt || null,
    financial:   o.displayFinancialStatus || null,
    fulfillment: o.displayFulfillmentStatus || null,
    total:       m ? Number(m.amount) : null,
    currency:    m?.currencyCode || null,
    customer:    o.shippingAddress?.name || null,
    city:        o.shippingAddress?.city || null,
    province:    o.shippingAddress?.province || null,
    items:       (o.lineItems?.nodes || []).filter(i => (i.currentQuantity ?? 1) > 0)
                   .map(i => ({ title: i.title, variant: i.variantTitle || null, sku: i.sku || null, qty: i.currentQuantity ?? null })),
    s1: val('s1'), s2: val('s2'), zone: val('zone'), courier: val('courier'),
    whereS1: val('whereS1'), whereS2: val('whereS2'),
    trackS1: val('trackS1'), trackS2: val('trackS2'),
    marker: val('marker'),
  };
  return { shaped, digests };
}

// ─── §LOOKUP::evaluateEligibility — المصدر الوحيد للأهلية ───
// الأهلية (طلب أحمد): S1 = Ready **أو** S2 = Ready — **و** zone ∈ {Show_Room, Cairo+Giza}.
// + شرط واحد زيادة: الأوردر مش ملغي (كتابة على أوردر ملغي مالهاش معنى).
// كل سبب بيتقال بقيمته الحرفية (order-lifecycle قاعدة ١٣-١٤: «فيه حاجة» وبس = فحص يدوي).
// 🔴 `already` حالة مستقلة (Step 5A ④): الأوردر اتحوّل قبل كده — مش فشل ومش خطأ.
function evaluateEligibility(o) {
  const q = (v) => v === null || v === undefined ? '—' : `«${v}»`;
  const reasons = [];
  const s1Ready = o.s1 === S1_READY;
  const s2Ready = o.s2 === S2_READY;

  // اتحوّل قبل كده؟ زون بوسطة + مندوب Bosta + الحالة بعد التحويل
  const convertedS1 = o.s1 === S1_TARGET && !s2Ready;
  const convertedS2 = o.s2 === S2_TARGET && !s1Ready;
  if (o.zone === ZONE_OTHER && o.courier === COURIER_BOSTA && (convertedS1 || convertedS2)) {
    return {
      eligible: false, already: true, machine: convertedS1 ? 's1' : 's2', plan: null,
      reasons: [{ code: 'already', text: 'الأوردر اتحوّل لبوسطة قبل كده — الحالة بعد التحويل والزون Other_Regions والمندوب Bosta' }],
    };
  }

  if (o.cancelledAt || o.s1 === 'Cancelled') {
    reasons.push({ code: 'cancelled', text: 'الأوردر ملغي' });
  }

  let machine = null;
  if (s1Ready && s2Ready) {
    reasons.push({ code: 'both_ready', text: 'S1 و S2 الاتنين Ready — حالة غير متوقعة، راجع الأوردر على شوبيفاي قبل أي تحويل' });
  } else if (s1Ready) machine = 's1';
  else if (s2Ready)   machine = 's2';
  else reasons.push({ code: 'not_ready', text: `حالة الأوردر مش Ready — S1 = ${q(o.s1)} · S2 = ${q(o.s2)}` });

  if (!ZONES_ELIGIBLE.includes(o.zone)) {
    if (o.zone === ZONE_OTHER)  reasons.push({ code: 'zone_other', text: 'الزون Other_Regions (بوسطة) بالفعل — مفيش تحويل مطلوب' });
    else if (!o.zone || o.zone === 'BLANK') reasons.push({ code: 'zone_blank', text: `الزون لسه ما اتحددش (${q(o.zone)}) — لازم يكون Show_Room أو Cairo+Giza` });
    else reasons.push({ code: 'zone_unknown', text: `الزون ${q(o.zone)} مش من القيم المسموحة — لازم يكون Show_Room أو Cairo+Giza` });
  }

  if (reasons.length) return { eligible: false, already: false, machine, plan: null, reasons };

  const status = machine === 's1'
    ? { key: 'manual_status', alias: 's1', label: 'الحالة (S1)', from: o.s1, to: S1_TARGET }
    : { key: 'status_2_r_e',  alias: 's2', label: 'الحالة (S2)', from: o.s2, to: S2_TARGET };
  return {
    eligible: true, already: false, machine, reasons: [],
    plan: { changes: [
      status,
      { key: 'zone',    alias: 'zone',    label: 'الزون',   from: o.zone,    to: ZONE_OTHER },
      { key: 'courier', alias: 'courier', label: 'المندوب', from: o.courier, to: COURIER_BOSTA },
      { key: 'package_shipping_re_assign', alias: 'marker', label: 'علامة التحويل', from: o.marker, to: MARKER_VALUE },
    ] },
  };
}

// ─── §LOOKUP::get_order ───
async function handleGetOrder(env, url, request) {
  const lookup = parseLookup(url.searchParams.get('q'));
  if (!lookup) return json({ ok: false, error: 'رقم الأوردر أو الباركود مش بصيغة صالحة' }, 400, request);
  assertEnv(env);
  const token = await getAccessToken(env);
  const costLog = [];
  const { raw, matchedBy } = await fetchOrder(env, token, lookup, costLog);
  if (!raw) return json({ ok: true, found: false, query: lookup.text, queryCost: costLog }, 200, request);
  const { shaped } = shapeOrder(raw);
  const ev = evaluateEligibility(shaped);
  return json({ ok: true, found: true, matchedBy, order: shaped, eligibility: ev, queryCost: costLog }, 200, request);
}

// ══════════════════════════════════════════════════════════════
// §REASSIGN — التحويل نفسه
// ══════════════════════════════════════════════════════════════
const M_SET = `mutation ReassignSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { namespace key value }
    userErrors { field message code }
  }
}`;

// بيقارن الأوردر المقروء بعد الكتابة بالخطة: applied (كلهم) · unchanged (ولا واحد) · partial
function classifyAfter(shaped, plan) {
  const hit = plan.changes.filter(c => shaped[c.alias] === c.to).length;
  return hit === plan.changes.length ? 'applied' : hit === 0 ? 'unchanged' : 'partial';
}

async function safeWrite(db, entry) {
  try { await writeLog(db, entry); return null; } catch (e) { return e.message; }
}

// 🔴 عقد: الرد HTTP 200 دايمًا لأي نتيجة «عمل» (success/warning/error/already/rejected) —
//    الفشل جوّه `status`. (HTTP غير 2xx بيخلّي الواجهة تفقد الرسالة.) 400 للطلب الباظ بس.
async function handleReassign(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
  const body = await request.json().catch(() => ({}));
  const employee = typeof body.employee === 'string' ? body.employee.trim().slice(0, 80) : '';
  const orderId  = String(body.orderId ?? '').trim();
  if (!employee) return json({ ok: false, error: 'employee مطلوب' }, 400, request);
  if (!/^\d{5,20}$/.test(orderId)) return json({ ok: false, error: 'orderId لازم يكون الرقم الداخلي للأوردر (أرقام بس)' }, 400, request);
  assertEnv(env);

  const costLog = [];
  const token = await getAccessToken(env);

  // ① قراءة جديدة — الفحص بيتعاد عليها هي، مش على اللي الواجهة شافته (worker-builder ⑩ ④)
  const d0 = await shopifyGQL(env, token, Q_ORDER_BY_ID, { id: `gid://shopify/Order/${orderId}` }, 'order_fresh', costLog);
  if (!d0.data.order) return json({ ok: false, status: 'error', error: 'الأوردر مش موجود على شوبيفاي', queryCost: costLog }, 200, request);
  const { shaped: before, digests } = shapeOrder(d0.data.order);
  const ev = evaluateEligibility(before);
  const ctx = { orderId: before.orderId, orderName: before.orderNumber, employee };

  // ② مش مؤهل → رفض (قبل أي محاولة = type `rejected`) · اتحوّل قبل كده = `already`
  if (!ev.eligible) {
    const status = ev.already ? 'already' : 'rejected';
    const logError = await safeWrite(env.DB, {
      tool: TOOL_NAME, type: 'rejected', ...ctx,
      notes: ev.reasons.map(r => r.text).join(' | ').slice(0, 300),
      extra: { result: status, stage: 'preflight', reasons: ev.reasons.map(r => r.code), s1: before.s1, s2: before.s2, zone: before.zone, courier: before.courier, workerVersion: WORKER_VERSION },
    });
    return json({
      ok: true, status, logged: logError === null, logError,
      message: ev.already ? ev.reasons[0].text : 'الأوردر مش مؤهل للتحويل — مفيش حاجة اتغيّرت',
      reasons: ev.reasons, order: before, queryCost: costLog,
    }, 200, request);
  }

  const plan = ev.plan;
  const statusChange = plan.changes[0];

  // ③ الكتابة — نداء واحد ذرّي، وكل ميتافيلد موجودة بـ compareDigest بتاعها
  const inputs = plan.changes.map(c => {
    const i = { ownerId: `gid://shopify/Order/${before.orderId}`, namespace: MF_NS, key: c.key, type: MF_TYPE, value: c.to };
    if (digests[c.alias]) i.compareDigest = digests[c.alias];
    return i;
  });

  const warnings = [];
  let status = 'success', errorMsg = null, writeThrew = null, confirmed = false;
  try {
    const d = await shopifyGQL(env, token, M_SET, { metafields: inputs }, 'metafieldsSet', costLog);
    const payload = d.data.metafieldsSet;                             // ① top-level اتفحص جوّه shopifyGQL
    const errs = payload?.userErrors || [];
    if (errs.length) {                                                // ② userErrors
      status = 'error';
      const stale = errs.some(e => e.code === 'STALE_OBJECT');
      errorMsg = stale
        ? 'الأوردر اتغيّر على شوبيفاي بعد ما قريناه (حد عدّل الحالة أو الزون أو المندوب) — ما اتكتبش حاجة. ابحث عنه تاني وراجع.'
        : 'شوبيفاي رفضت التعديل: ' + errs.map(e => e.message).join(' | ');
    } else {                                                          // ③ تأكيد الـ payload: كل ميتافيلد رجعت بقيمتها
      const returned = payload?.metafields || [];
      confirmed = inputs.every(i => returned.some(r => r.namespace === i.namespace && r.key === i.key && r.value === i.value));
    }
  } catch (e) {
    // ⚠️ استثناء بعد الإرسال = مش عارفين وصل ولا لأ. القراءة التالية هي اللي بتحسم.
    writeThrew = e.message;
  }

  // ④ قراءة تحقق — الحقيقة من شوبيفاي مش من النية. بتتعمل في كل مسار ما عدا رفض شوبيفاي الصريح.
  let after = before, verified = null;
  if (status !== 'error') {
    try {
      const d1 = await shopifyGQL(env, token, Q_ORDER_BY_ID, { id: `gid://shopify/Order/${before.orderId}` }, 'order_verify', costLog);
      after = shapeOrder(d1.data.order).shaped;
      verified = classifyAfter(after, plan);
    } catch (e) {
      warnings.push(`ما قدرناش نقرا الأوردر للتأكد بعد الكتابة (${e.message})`);
    }
    if (verified === 'applied') {
      if (writeThrew) { status = 'warning'; warnings.push(`التعديل اتنفّذ فعلاً لكن رد شوبيفاي فشل (${writeThrew})`); }
      warnings.length = writeThrew ? warnings.length : 0;
    } else if (verified === 'unchanged') {
      status = 'error'; errorMsg = `التعديل ما اتنفّذش${writeThrew ? ` (${writeThrew})` : ''} — الأوردر لسه زي ما كان، تقدر تعيد المحاولة`;
      warnings.length = 0;
    } else if (verified === 'partial') {
      status = 'warning';
      const left = plan.changes.filter(c => after[c.alias] !== c.to).map(c => `${c.label}: ${after[c.alias] ?? '—'} (المطلوب ${c.to})`);
      warnings.push(`🔴 الأوردر في حالة وسط — ده مش المتوقع (الكتابة ذرّية): ${left.join(' · ')} — راجعه على شوبيفاي يدويًا`);
    } else if (confirmed && !writeThrew) {
      // شوبيفاي أكدت كل ميتافيلد بقيمتها في رد الكتابة نفسه — قراءة التحقق اللي فشلت مش بتشكّك فيه.
      after = { ...before, ...Object.fromEntries(plan.changes.map(c => [c.alias, c.to])) };
      verified = 'payload';
    } else {
      status = 'warning';
      warnings.push(writeThrew
        ? `ما قدرناش نتأكد التعديل اتنفّذ ولا لأ (${writeThrew}) — افتح الأوردر على شوبيفاي وتأكد قبل ما تعيد المحاولة`
        : 'شوبيفاي ما أكدتش الميتافيلدز في رد الكتابة وقراءة التحقق فشلت — افتح الأوردر على شوبيفاي وتأكد');
    }
  }

  // ⑤ السجل — صف الأداة (type حسب الأثر الخارجي: اتبعت واترفض = reassign_to_bosta+error)
  const changed = status === 'success' || status === 'warning';
  const logError = await safeWrite(env.DB, {
    tool: TOOL_NAME, type: 'reassign_to_bosta', ...ctx,
    valueBefore: statusChange.from, valueAfter: errorMsg ? statusChange.from : statusChange.to,
    notes: `${before.orderNumber}: ${plan.changes.map(c => `${c.label} ${c.from ?? '—'} ← ${c.to}`).join(' · ')}`.slice(0, 300),
    extra: {
      result: status, stage: 'write', machine: ev.machine, verified,
      before: { s1: before.s1, s2: before.s2, zone: before.zone, courier: before.courier, marker: before.marker },
      after:  { s1: after.s1,  s2: after.s2,  zone: after.zone,  courier: after.courier,  marker: after.marker },
      error: errorMsg || writeThrew || null, workerVersion: WORKER_VERSION,
    },
  });

  // السجل المشترك لتغيّر حالة S1/S2 (worker-builder Step 5B قاعدة ٣) — بس لو الحالة اتغيّرت فعلاً
  let logError2 = null;
  if (changed && after[statusChange.alias] === statusChange.to) {
    logError2 = await safeWrite(env.DB, {
      tool: 'metafields_change', type: 'update', ...ctx,
      valueBefore: statusChange.from, valueAfter: statusChange.to,
      notes: 'تحويل الشحنة إلى بوسطة',
      extra: { source: TOOL_NAME, field: statusChange.key, machine: ev.machine.toUpperCase(), result: status, workerVersion: WORKER_VERSION },
    });
  }
  const logged = logError === null && logError2 === null;

  return json({
    ok: status !== 'error', status, logged, logError: logError || logError2,
    message: status === 'success' ? 'الأوردر اتحوّل لبوسطة' : undefined,
    error: errorMsg || undefined, warnings,
    changes: plan.changes.map(c => ({ label: c.label, from: c.from, to: c.to })),
    order: after, queryCost: costLog,
  }, 200, request);
}

// ══════════════════════════════════════════════════════════════
// §DIAG — فحص ذاتي بلا أي كتابة (مصفوفة `[{ ok, label, detail, hint }]`)
// ══════════════════════════════════════════════════════════════
async function handleDiag(env, request) {
  const checks = [];
  const push = (ok, label, detail, hint) => checks.push({ ok, label, detail, hint });

  const s = env.WORKER_SECRET;
  const hasSecret = typeof s === 'string' && s.trim() !== '';
  push(hasSecret, 'سر الـ Worker', hasSecret ? `WORKER_SECRET=${String(s).length} حرف` : 'WORKER_SECRET=❌ ناقص',
       'Dashboard → Settings → Variables، وبعدها **Promote** للنسخة');
  const fp = await secretFingerprint(s);
  push(!!fp, 'بصمة WORKER_SECRET', fp ? `بصمة ${fp} · مجموعة ${SECRET_GROUP} — لازم تطابق باقي أعضاء المجموعة` : 'مفيش سر — البصمة مستحيلة',
       'لو البصمة مختلفة عن Worker الهب، الهب هيرجّع 401 من الـ Worker ده بس');

  push(Object.keys(env).filter(k => ENV_REQUIRED.includes(k) && String(env[k] ?? '').trim()).length === ENV_REQUIRED.length,
       'متغيرات شوبيفاي', ENV_REQUIRED.map(k => `${k}=${String(env[k] ?? '').trim() ? '✓' : '❌'}`).join(' · '),
       '`SHOP_DOMAIN` من `[vars]` في wrangler.toml، و`CLIENT_ID`/`CLIENT_SECRET` أسرار + Promote');

  try {
    assertEnv(env);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM logs WHERE tool = ?').bind(TOOL_NAME).first();
    push(true, 'D1', `متصل · ${n?.n ?? 0} صف تحت \`${TOOL_NAME}\``);
  } catch (e) {
    push(false, 'D1 / المتغيرات', `FAILED: ${e.message}`, 'binding اسمه `DB` بالحرف في `wrangler.toml`');
  }

  // شوبيفاي: OAuth + الصلاحيات + تعريفات الميتافيلدز اللي بنكتبها (القيم المطلوبة موجودة في choice list؟)
  try {
    const token = await getAccessToken(env);
    push(true, 'شوبيفاي OAuth', 'التوكن اتجاب');
    const costLog = [];
    const sc = await shopifyGQL(env, token, `{ currentAppInstallation { accessScopes { handle } } }`, {}, 'diag_scopes', costLog);
    const scopes = (sc.data.currentAppInstallation?.accessScopes || []).map(x => x.handle);
    const need = ['read_orders', 'write_orders'];
    const miss = need.filter(h => !scopes.includes(h));
    push(miss.length === 0, 'صلاحيات التطبيق', `${scopes.length} صلاحية` + (miss.length ? ` · ناقص: ${miss.join(', ')}` : ' · read_orders + write_orders ✓'),
         '`write_orders` لازم عشان `metafieldsSet` على الأوردرات');

    const REQUIRED_CHOICES = {
      manual_status: [S1_READY, S1_TARGET], status_2_r_e: [S2_READY, S2_TARGET],
      zone: [...ZONES_ELIGIBLE, ZONE_OTHER], courier: [COURIER_BOSTA], package_shipping_re_assign: [MARKER_VALUE],
    };
    try {
      const md = await shopifyGQL(env, token,
        `{ metafieldDefinitions(ownerType: ORDER, first: 100, namespace: "${MF_NS}") { nodes { key type { name } validations { name value } } } }`,
        {}, 'diag_definitions', costLog);
      const defs = new Map((md.data.metafieldDefinitions?.nodes || []).map(n => [n.key, n]));
      for (const [key, wanted] of Object.entries(REQUIRED_CHOICES)) {
        const def = defs.get(key);
        if (!def) { push(false, `تعريف custom.${key}`, 'مش موجود على المتجر', 'الأداة هتفشل في الكتابة عليه'); continue; }
        let choices = [];
        try { choices = JSON.parse(def.validations.find(v => v.name === 'choices')?.value || '[]'); } catch {}
        const missing = wanted.filter(w => !choices.includes(w));
        const typeOk = def.type?.name === MF_TYPE;
        push(typeOk && missing.length === 0, `تعريف custom.${key}`,
             `${def.type?.name}${missing.length ? ` · ناقص من القايمة: ${missing.join(' / ')}` : ' · القيم المطلوبة موجودة ✓'}`,
             `الكتابة بقيمة مش في الـ choice list بتترفض كلها (الكتابة ذرّية)`);
      }
    } catch (e) {
      push(false, 'تعريفات الميتافيلدز', `FAILED: ${e.message}`, 'قراءة التعريفات محتاجة صلاحية على الأوردرات');
    }
    push(true, 'تكلفة الاستعلام', `throttle: ${_lastThrottle ? `${_lastThrottle.currentlyAvailable}/${_lastThrottle.maximumAvailable} (+${_lastThrottle.restoreRate}/s)` : '—'}`);
    push(true, 'actualQueryCost', _lastQueryCost ? `آخر نداء ${_lastQueryCost.op}: ${_lastQueryCost.actual ?? '—'} (طُلب ${_lastQueryCost.requested ?? '—'})` : '—');
  } catch (e) {
    push(false, 'شوبيفاي', `FAILED: ${e.message}`, 'تأكد من `CLIENT_ID`/`CLIENT_SECRET`/`SHOP_DOMAIN` وإن النسخة اتعملها Promote');
  }

  const origin = request.headers.get('Origin') || '(بلا Origin)';
  push(ALLOWED_ORIGINS.includes(origin), 'الـ Origin', `${origin} · المسموح: ${ALLOWED_ORIGINS.join(', ')}`,
       'الواجهة لازم تتفتح من https://ecommoda-dev.github.io');

  return json({ ok: checks.every(c => c.ok), version: WORKER_VERSION, tool: TOOL_NAME, checks }, 200, request);
}

// ══════════════════════════════════════════════════════════════
// §HANDLER
// ══════════════════════════════════════════════════════════════
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: getCORS(request) });

    // 🔴 حارس السر الغايب **قبل** فحص الـ auth — من غيره `"Bearer undefined"` بيعدّي.
    if (typeof env.WORKER_SECRET !== 'string' || !env.WORKER_SECRET.trim())
      return json({ ok: false, error: 'WORKER_SECRET غير مضبوط على الـ Worker', step: 'env' }, 500, request);

    const auth = request.headers.get('Authorization');
    if (!auth || auth !== `Bearer ${env.WORKER_SECRET}`)
      return json({ error: 'Unauthorized' }, 401, request);

    const url    = new URL(request.url);
    const action = url.searchParams.get('action') || '';

    try {
      if (action === 'get_config')
        return json({ ok: true, version: WORKER_VERSION, WORKER_VERSION, tool: TOOL_NAME }, 200, request);
      if (action === 'diag') return await handleDiag(env, request);

      // ─── §LOOKUP ───
      if (action === 'get_order') return await handleGetOrder(env, url, request);

      // ─── §REASSIGN ───
      if (action === 'reassign_to_bosta') return await handleReassign(request, env);

      // ─── §LOG-ENDPOINTS ───
      if (action === 'get_logs' || action === 'get_logs_count' || action === 'get_logs_export') {
        assertEnvDb(env);
        const filters = logParamsFrom(url, TOOL_NAME);
        if (action === 'get_logs') {
          const entries = await getLogs(env.DB, {
            ...filters,
            limit:   parseInt(url.searchParams.get('limit')  || '100', 10),
            offset:  parseInt(url.searchParams.get('offset') || '0', 10),
            sortBy:  url.searchParams.get('sortBy'),
            sortDir: url.searchParams.get('sortDir'),
          });
          return json({ ok: true, entries }, 200, request);
        }
        if (action === 'get_logs_count')
          return json({ ok: true, total: await getLogsCount(env.DB, filters) }, 200, request);
        const [entries, total] = await Promise.all([getLogsExport(env.DB, filters), getLogsCount(env.DB, filters)]);
        return json({ ok: true, entries, total, cap: LOG_EXPORT_MAX, truncated: total > entries.length }, 200, request);
      }

      return json({ error: 'Unknown action' }, 404, request);
    } catch (err) {
      console.error(err);
      return json({ ok: false, error: err.message }, 500, request);
    }
  },
};

function assertEnvDb(env) {
  if (!env.DB) throw new Error('binding قاعدة البيانات ناقص (`DB`) — (شغّل ?action=diag)');
}
