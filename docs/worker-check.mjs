// فحص الـ Worker على شوبيفاي ووهمي + D1 وهمي — `node docs/worker-check.mjs`
// ⚠️ بيقيس المنطق (الأهلية · الكتابة الذرّية · compareDigest · حالات النتيجة · السجل) — **مش** شوبيفاي الحقيقية.
//    أول تحويل حقيقي بعد النشر هو الاختبار الفعلي (راجع CLAUDE.md).
import worker from '../index.js';
console.error = () => {};   // الأخطاء المتوقعة في السيناريوهات (متغير ناقص…) مش ضوضاء في الفحص

let pass = 0, fail = 0;
const is = (c, m, d = '') => { c ? pass++ : fail++; console.log(c ? '  ✅' : '  ❌', m, c || !d ? '' : `\n       ${d}`); };
const sec = (t) => console.log(`\n══ ${t} ══`);

// ── شوبيفاي وهمي ───────────────────────────────────────────
const store = new Map();          // legacyId → { name, cancelledAt, fulfillment, mf: {key: value}, digests: {key: n} }
let gqlCalls = [], failNext = null, mutateBehavior = null, staleOnWrite = false;
function mk(id, name, mf = {}, extra = {}) {
  const digests = {}; for (const k of Object.keys(mf)) digests[k] = 'd0';
  store.set(String(id), { name, cancelledAt: null, fulfillment: 'UNFULFILLED', mf: { ...mf }, digests, ...extra });
}
const MF_KEYS = { s1: 'manual_status', s2: 'status_2_r_e', zone: 'zone', courier: 'courier', whereS1: 'package_whereabouts_s1',
  whereS2: 'package_whereabouts_s2', trackS1: 'bosta_tracking_number_s1', trackS2: 'bosta_tracking_number_s2', marker: 'package_shipping_re_assign' };
function render(id) {
  const o = store.get(String(id)); if (!o) return null;
  const n = { id: `gid://shopify/Order/${id}`, legacyResourceId: String(id), name: o.name, createdAt: '2026-10-01T10:00:00Z', cancelledAt: o.cancelledAt,
    displayFinancialStatus: 'PENDING', displayFulfillmentStatus: o.fulfillment,
    currentTotalPriceSet: { shopMoney: { amount: '1500.0', currencyCode: 'EGP' } },
    shippingAddress: { name: 'عميل تجريبي', city: 'Cairo', province: 'Cairo' },
    lineItems: { nodes: [{ title: 'Shirt', variantTitle: 'M', sku: 'S1', currentQuantity: 2 }, { title: 'Removed', variantTitle: null, sku: 'X', currentQuantity: 0 }] } };
  for (const [a, k] of Object.entries(MF_KEYS)) n[a] = o.mf[k] != null ? { value: o.mf[k], compareDigest: o.digests[k] || 'd0' } : null;
  return n;
}
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('/oauth/access_token')) return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 });
  const { query, variables } = JSON.parse(init.body);
  gqlCalls.push({ query, variables });
  if (failNext && query.includes(failNext.match)) { const f = failNext; failNext = null; if (f.throw) throw new Error(f.throw); return new Response(f.body, { status: f.status || 200 }); }
  const ok = (data) => new Response(JSON.stringify({ data, extensions: { cost: { requestedQueryCost: 20, actualQueryCost: 12, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 980, restoreRate: 50 } } } }), { status: 200 });
  if (query.includes('ReassignOrderById')) return ok({ order: render(variables.id.split('/').pop()) });
  if (query.includes('ReassignOrderByName')) {
    const q = variables.q.replace(/^name:/, '');
    return ok({ orders: { nodes: [...store.keys()].filter(id => store.get(id).name.includes(q)).map(render) } });
  }
  if (query.includes('metafieldsSet')) {
    if (mutateBehavior === 'userErrorsStale') return ok({ metafieldsSet: { metafields: [], userErrors: [{ field: ['metafields'], message: 'Stale object', code: 'STALE_OBJECT' }] } });
    if (mutateBehavior === 'userErrorsOther') return ok({ metafieldsSet: { metafields: [], userErrors: [{ field: ['metafields', '0'], message: 'Value is not included in the list', code: 'INCLUSION' }] } });
    if (mutateBehavior === 'toplevel') return new Response(JSON.stringify({ errors: [{ message: 'Access denied for metafieldsSet field', extensions: { code: 'ACCESS_DENIED' } }], data: null }), { status: 200 });
    const inputs = variables.metafields; const id = inputs[0].ownerId.split('/').pop(); const o = store.get(id);
    // compareDigest حقيقي: لو الـ digest مش مطابق = STALE (ذرّي — ولا واحد بيتكتب)
    for (const i of inputs) if (i.compareDigest && i.compareDigest !== (o.digests[i.key] || 'd0')) return ok({ metafieldsSet: { metafields: [], userErrors: [{ field: [], message: 'stale', code: 'STALE_OBJECT' }] } });
    if (mutateBehavior === 'throwAfterApply') { for (const i of inputs) o.mf[i.key] = i.value; throw new Error('connection reset'); }
    if (mutateBehavior === 'throwNoApply') throw new Error('connection reset');
    const applied = mutateBehavior === 'partial' ? inputs.slice(0, 2) : inputs;
    for (const i of applied) o.mf[i.key] = i.value;
    if (mutateBehavior === 'emptyPayload') return ok({ metafieldsSet: { metafields: [], userErrors: [] } });
    return ok({ metafieldsSet: { metafields: applied.map(i => ({ namespace: i.namespace, key: i.key, value: i.value })), userErrors: [] } });
  }
  return ok({});
};

// ── D1 وهمي ──
const logs = [];
const DB = { prepare: (sql) => ({ bind: (...a) => ({ run: async () => { if (/INSERT INTO logs/.test(sql)) logs.push({ tool: a[1], type: a[2], employee: a[3], order_id: a[4], order_name: a[5], value_before: a[9], value_after: a[10], notes: a[11], extra: a[12] ? JSON.parse(a[12]) : null }); return {}; },
  first: async () => ({ n: 0 }), all: async () => ({ results: [] }) }) }) };
const env = { WORKER_SECRET: 'sec', SHOP_DOMAIN: 'x.myshopify.com', CLIENT_ID: 'a', CLIENT_SECRET: 'b', DB };
const H = { Authorization: 'Bearer sec', Origin: 'https://ecommoda-dev.github.io', 'Content-Type': 'application/json' };
const get = async (qs, e = env, h = H) => { const r = await worker.fetch(new Request(`https://w.dev/?${qs}`, { headers: h }), e); return { r, j: await r.json().catch(() => null) }; };
const post = async (qs, body, e = env) => { const r = await worker.fetch(new Request(`https://w.dev/?${qs}`, { method: 'POST', headers: H, body: JSON.stringify(body) }), e); return { r, j: await r.json().catch(() => null) }; };
const reset = () => { store.clear(); logs.length = 0; gqlCalls = []; failNext = null; mutateBehavior = null; };

// ═════════════════════════════════════════
sec('① الحماية');
{
  let x = await get('action=get_config', env, {}); is(x.r.status === 401, 'بلا Authorization → 401');
  x = await get('action=get_config', { ...env, WORKER_SECRET: undefined }); is(x.r.status === 500 && /غير مضبوط/.test(x.j.error), 'سر غايب → 500 مش "Bearer undefined" مقبول');
  x = await get('action=get_config', env, { ...H, Authorization: 'Bearer undefined' }); is(x.r.status === 401, '"Bearer undefined" مرفوض والسر موجود');
  x = await get('action=get_config'); is(x.j.version === '1.1.0' && x.j.tool === 're_assign_package_zone_bosta', 'get_config بيرجّع النسخة والـ tool');
  x = await get('action=get_config', env, { ...H, Origin: 'https://evil.example' }); is(x.r.headers.get('Access-Control-Allow-Origin') === 'https://ecommoda-dev.github.io', 'CORS صارم — أصل غريب مابيتعكسش');
}

sec('② البحث (get_order)');
{
  reset(); mk(111111111111, '#55001', { manual_status: 'Ready', zone: 'Cairo+Giza' }); mk(222222222222, '#55002', { manual_status: 'Ready', zone: 'Show_Room', courier: 'Showroom' });
  let x = await get('action=get_order&q=%2355001'); is(x.j.found && x.j.matchedBy === 'name' && x.j.order.orderNumber === '#55001', 'بحث بالاسم مع #');
  x = await get('action=get_order&q=55001'); is(x.j.found && x.j.order.orderId === '111111111111', 'بحث بالاسم من غير # + orderId الرقمي راجع');
  x = await get('action=get_order&q=111111111111'); is(x.j.found && x.j.matchedBy === 'id', 'رقم طويل (باركود Order ID) → بحث بالـ ID');
  x = await get('action=get_order&q=gid%3A%2F%2Fshopify%2FOrder%2F111111111111'); is(x.j.found && x.j.matchedBy === 'id', 'gid كامل مقبول');
  mk(8888888888888, '#9999999999999', { manual_status: 'Ready', zone: 'Cairo+Giza' });
  x = await get('action=get_order&q=9999999999999'); is(x.j.found && x.j.matchedBy === 'name', 'أوردر اسمه رقم طويل: الـ ID مالقاش → fallback للاسم');
  x = await get('action=get_order&q=77777'); is(x.r.status === 200 && x.j.found === false, 'مش موجود = 200 + found:false (مش خطأ)');
  x = await get('action=get_order&q=55001%20OR%20name:*'); is(x.r.status === 400, 'حقن في نص البحث → 400');
  x = await get('action=get_order&q='); is(x.r.status === 400, 'بحث فاضي → 400');
  x = await get('action=get_order&q=55001'); is(x.j.order.items.length === 1 && x.j.order.customer && !('digests' in x.j) && !JSON.stringify(x.j).includes('compareDigest') && !JSON.stringify(x.j).includes('d0'), 'الأصناف اللي كميتها ٠ بتتشال، والـ digest مابيطلعش للعميل');
  is(Array.isArray(x.j.queryCost) && x.j.queryCost[0].actual === 12, 'queryCost بيرجع لكل استعلام');
}

sec('③ الأهلية — الأسباب');
{
  const ev = async (mf, extra = {}) => { reset(); mk(1000000000001, '#1', mf, extra); const x = await get('action=get_order&q=1000000000001'); return x.j.eligibility; };
  let e = await ev({ manual_status: 'Ready', zone: 'Cairo+Giza' }); is(e.eligible && e.machine === 's1' && e.plan.changes.length === 4, 'S1 Ready + Cairo+Giza → مؤهل بأربع تغييرات');
  is(e.plan.changes[0].key === 'manual_status' && e.plan.changes[0].to === 'Confirmed' && e.plan.changes[1].to === 'Other_Regions' && e.plan.changes[2].to === 'Bosta', 'الأهداف: Confirmed · Other_Regions · Bosta');
  e = await ev({ manual_status: 'Ready', zone: 'Show_Room', courier: 'Showroom' }); is(e.eligible && e.plan.changes[2].from === 'Showroom', 'Show_Room مؤهل، والمندوب الحالي بيتعرض');
  e = await ev({ manual_status: 'Delivered', status_2_r_e: 'Ready', zone: 'Cairo+Giza' }); is(e.eligible && e.machine === 's2' && e.plan.changes[0].key === 'status_2_r_e' && e.plan.changes[0].to === 'Confirmed + EXCHANGE', 'S2 Ready → الهدف Confirmed + EXCHANGE على status_2_r_e');
  e = await ev({ manual_status: 'Confirmed', zone: 'Cairo+Giza' }); is(!e.eligible && e.reasons[0].code === 'not_ready' && /«Confirmed»/.test(e.reasons[0].text), 'مش Ready → السبب بالقيمة الحرفية');
  e = await ev({ manual_status: 'Ready', zone: 'Other_Regions' }); is(!e.eligible && e.reasons.some(r => r.code === 'zone_other'), 'زون Other_Regions → مش مؤهل');
  e = await ev({ manual_status: 'Ready', zone: 'BLANK' }); is(!e.eligible && e.reasons.some(r => r.code === 'zone_blank'), 'زون BLANK → سبب «لسه ما اتحددش»');
  e = await ev({ manual_status: 'Ready' }); is(!e.eligible && e.reasons.some(r => r.code === 'zone_blank'), 'زون غايب → نفس السبب');
  e = await ev({ manual_status: 'Ready', zone: 'Mars' }); is(!e.eligible && e.reasons.some(r => r.code === 'zone_unknown' && /«Mars»/.test(r.text)), 'زون غريب → القيمة بالحرف');
  e = await ev({ manual_status: 'Ready', zone: 'Cairo+Giza' }, { cancelledAt: '2026-10-02T00:00:00Z' }); is(!e.eligible && e.reasons.some(r => r.code === 'cancelled'), 'ملغي → مش مؤهل');
  e = await ev({ manual_status: 'Ready', status_2_r_e: 'Ready', zone: 'Cairo+Giza' }); is(!e.eligible && e.reasons.some(r => r.code === 'both_ready'), 'S1 و S2 الاتنين Ready → مش مؤهل (غموض)');
  e = await ev({ manual_status: 'Confirmed', zone: 'Other_Regions', courier: 'Bosta' }); is(!e.eligible && e.already && e.reasons.length === 1 && e.reasons[0].code === 'already', 'اتحوّل قبل كده → already (سبب واحد)');
  e = await ev({ manual_status: 'Delivered', status_2_r_e: 'Confirmed + EXCHANGE', zone: 'Other_Regions', courier: 'Bosta' }); is(e.already && e.machine === 's2', 'already على S2');
  e = await ev({ manual_status: 'Ready', zone: 'Cairo+Giza', status_2_r_e: 'Returned' }, { fulfillment: 'FULFILLED' }); is(e.eligible, 'S1 Ready مؤهل حتى لو S2 قديمة (Returned)');
  e = await ev({ manual_status: 'Ready', zone: 'Other_Regions' }); is(!e.eligible && !e.already, 'Ready + Other_Regions (من غير Bosta مثلًا) مش already');
  e = await ev({ manual_status: 'Confirmed', zone: 'Other_Regions', courier: 'Bosta' }); const reasonsTexts = e.reasons.map(r => r.text).join(' '); is(!/ما اتحددش/.test(reasonsTexts), 'already مابيعرضش أسباب تانية متضاربة');
}

sec('④ التحويل — S1');
{
  reset(); mk(3000000000001, '#3001', { manual_status: 'Ready', zone: 'Cairo+Giza', courier: null }); mk(3000000000002, '#3002', { manual_status: 'Ready', zone: 'Show_Room', courier: 'Showroom' });
  let x = await post('action=reassign_to_bosta', { orderId: '3000000000001', employee: 'Ahmed_Ibraheem' });
  const o = store.get('3000000000001');
  is(x.j.status === 'success' && x.j.ok, 'نجاح', JSON.stringify(x.j));
  is(o.mf.manual_status === 'Confirmed' && o.mf.zone === 'Other_Regions' && o.mf.courier === 'Bosta' && o.mf.package_shipping_re_assign === 'Bosta', 'الأربع ميتافيلدز اتكتبوا على الأوردر');
  const w = gqlCalls.filter(c => c.query.includes('metafieldsSet')); is(w.length === 1 && w[0].variables.metafields.length === 4, 'نداء كتابة واحد ذرّي بأربع ميتافيلدز');
  const inp = w[0].variables.metafields;
  is(inp.every(i => i.namespace === 'custom' && i.type === 'single_line_text_field'), 'namespace وtype صح');
  is(inp.find(i => i.key === 'manual_status').compareDigest === 'd0' && inp.find(i => i.key === 'zone').compareDigest === 'd0', 'compareDigest على الحالة والزون');
  is(!('compareDigest' in inp.find(i => i.key === 'package_shipping_re_assign')) && !('compareDigest' in inp.find(i => i.key === 'courier')), 'ميتافيلد غايبة من القراءة بتتكتب من غير compareDigest');
  is(x.j.order.s1 === 'Confirmed' && x.j.order.zone === 'Other_Regions', 'الرد فيه الأوردر بعد التحويل (من قراءة جديدة)');
  is(logs.length === 2 && logs[0].tool === 're_assign_package_zone_bosta' && logs[0].type === 'reassign_to_bosta' && logs[0].extra.result === 'success' && logs[0].extra.verified === 'applied', 'صف سجل الأداة (success/applied)');
  is(logs[1].tool === 'metafields_change' && logs[1].type === 'update' && logs[1].value_before === 'Ready' && logs[1].value_after === 'Confirmed' && logs[1].extra.source === 're_assign_package_zone_bosta' && logs[1].extra.field === 'manual_status', 'صف metafields_change المشترك (Ready → Confirmed · extra.source)');
  is(logs.every(l => !JSON.stringify(l).includes('عميل تجريبي')), 'صفر اسم عميل في السجل');
  is(logs[0].employee === 'Ahmed_Ibraheem' && logs[0].order_id === '3000000000001' && logs[0].order_name === '#3001', 'الموظف والأوردر في السجل');
  // مرة تانية على نفس الأوردر = already
  logs.length = 0; gqlCalls = [];
  x = await post('action=reassign_to_bosta', { orderId: '3000000000001', employee: 'Ahmed_Ibraheem' });
  is(x.j.status === 'already' && !gqlCalls.some(c => c.query.includes('metafieldsSet')) && logs.length === 1 && logs[0].type === 'rejected' && logs[0].extra.result === 'already', 'تحويل تاني = already · صفر كتابة · صف rejected');
  // Show_Room
  x = await post('action=reassign_to_bosta', { orderId: '3000000000002', employee: 'E' });
  is(x.j.status === 'success' && store.get('3000000000002').mf.courier === 'Bosta', 'Show_Room → المندوب Showroom بقى Bosta');
}

sec('⑤ التحويل — S2 والرفض');
{
  reset(); mk(4000000000001, '#4001', { manual_status: 'Delivered', status_2_r_e: 'Ready', zone: 'Cairo+Giza' });
  let x = await post('action=reassign_to_bosta', { orderId: '4000000000001', employee: 'E' }); const o = store.get('4000000000001');
  is(x.j.status === 'success' && o.mf.status_2_r_e === 'Confirmed + EXCHANGE' && o.mf.manual_status === 'Delivered', 'S2 → Confirmed + EXCHANGE وS1 (Delivered) ما اتلمسش');
  is(logs[1].extra.field === 'status_2_r_e' && logs[1].extra.machine === 'S2', 'سجل الحالة المشترك على حقل S2');
  reset(); mk(4000000000002, '#4002', { manual_status: 'Confirmed', zone: 'Cairo+Giza' });
  x = await post('action=reassign_to_bosta', { orderId: '4000000000002', employee: 'E' });
  is(x.r.status === 200 && x.j.status === 'rejected' && x.j.reasons[0].code === 'not_ready', 'مش مؤهل → 200 + rejected + السبب');
  is(!gqlCalls.some(c => c.query.includes('metafieldsSet')) && store.get('4000000000002').mf.manual_status === 'Confirmed', 'ولا كتابة اتبعتت');
  is(logs.length === 1 && logs[0].type === 'rejected' && logs[0].extra.result === 'rejected' && logs[0].extra.reasons[0] === 'not_ready', 'صف rejected واحد (⑭ صف لكل محاولة)');
  // الواجهة شافت مؤهل وبعدين الحالة اتغيّرت: القراءة الجديدة هي اللي بتحكم
  reset(); mk(4000000000003, '#4003', { manual_status: 'Ready', zone: 'Cairo+Giza' }); store.get('4000000000003').mf.manual_status = 'Shipped';
  x = await post('action=reassign_to_bosta', { orderId: '4000000000003', employee: 'E' });
  is(x.j.status === 'rejected', 'لقطة قديمة في المتصفح: الفحص بيتعاد على قراءة جديدة → rejected');
  x = await post('action=reassign_to_bosta', { orderId: '99999999999', employee: 'E' }); is(x.r.status === 200 && x.j.status === 'error' && !x.j.ok, 'orderId مش موجود → 200 + status:error (الرسالة توصل للواجهة)');
  x = await post('action=reassign_to_bosta', { orderId: 'abc', employee: 'E' }); is(x.r.status === 400, 'orderId مش رقم → 400');
  x = await post('action=reassign_to_bosta', { orderId: '4000000000003' }); is(x.r.status === 400, 'من غير employee → 400');
  const g = await worker.fetch(new Request('https://w.dev/?action=reassign_to_bosta', { headers: H }), env); is(g.status === 405, 'GET على reassign_to_bosta → 405');
}

sec('⑥ الفشل والتحقق');
{
  const fresh = (id = 5000000000001) => { reset(); mk(id, '#5001', { manual_status: 'Ready', zone: 'Cairo+Giza' }); return String(id); };
  let id = fresh(); mutateBehavior = 'userErrorsStale';
  let x = await post('action=reassign_to_bosta', { orderId: id, employee: 'E' });
  is(x.j.status === 'error' && !x.j.ok && /اتغيّر/.test(x.j.error) && logs[0].type === 'reassign_to_bosta' && logs[0].extra.result === 'error' && logs.length === 1, 'STALE_OBJECT → error برسالة واضحة + صف error + صفر صف metafields_change');
  is(logs[0].value_after === 'Ready', 'السجل بيقول القيمة بعد = Ready (ما اتغيّرتش)');
  id = fresh(); mutateBehavior = 'userErrorsOther'; x = await post('action=reassign_to_bosta', { orderId: id, employee: 'E' });
  is(x.j.status === 'error' && /Value is not included/.test(x.j.error), 'userErrors تانية → error بنص شوبيفاي');
  id = fresh(); mutateBehavior = 'toplevel'; x = await post('action=reassign_to_bosta', { orderId: id, employee: 'E' });
  is(x.r.status === 500 || x.j.status === 'error' || !x.j.ok, 'خطأ GraphQL علوي (data:null) مابيتقراش نجاح');
  is(store.get(id).mf.manual_status === 'Ready', '...والأوردر ما اتغيّرش');
  // الاستثناء بعد التنفيذ
  id = fresh(); mutateBehavior = 'throwAfterApply'; x = await post('action=reassign_to_bosta', { orderId: id, employee: 'E' });
  is(x.j.status === 'warning' && x.j.order.zone === 'Other_Regions' && x.j.warnings.some(w => /اتنفّذ فعلاً/.test(w)), 'الكتابة رمت بعد ما اتنفّذت → warning (مش error) مع شرح');
  is(logs.some(l => l.tool === 'metafields_change'), '...والحالة اتسجّلت في metafields_change');
  id = fresh(); mutateBehavior = 'throwNoApply'; x = await post('action=reassign_to_bosta', { orderId: id, employee: 'E' });
  is(x.j.status === 'error' && /ما اتنفّذش/.test(x.j.error) && !logs.some(l => l.tool === 'metafields_change'), 'رمت ومااتنفّذتش → error يقدر يعيد المحاولة');
  id = fresh(); mutateBehavior = 'partial'; x = await post('action=reassign_to_bosta', { orderId: id, employee: 'E' });
  is(x.j.status === 'warning' && x.j.warnings.some(w => /حالة وسط/.test(w)), 'تنفيذ جزئي (لو حصل) → warning بتفصيل المتبقي');
  // قراءة التحقق فشلت
  const readFails = async (behavior) => {
    const id = fresh(); mutateBehavior = behavior; const orig = globalThis.fetch;
    globalThis.fetch = async (u, i) => { const b = i?.body ? JSON.parse(i.body) : {}; if (b.query?.includes('ReassignOrderById') && gqlCalls.some(c => c.query.includes('metafieldsSet'))) throw new Error('boom'); return orig(u, i); };
    const r = await post('action=reassign_to_bosta', { orderId: id, employee: 'E' }); globalThis.fetch = orig; return r;
  };
  x = await readFails(null);
  is(x.j.status === 'success' && x.j.order.zone === 'Other_Regions' && logs[0].extra.verified === 'payload', 'قراءة التحقق فشلت + شوبيفاي أكدت في رد الكتابة → success (التأكيد من الـ payload)');
  x = await readFails('emptyPayload');
  is(x.j.status === 'warning' && x.j.warnings.some(w => /وتأكد/.test(w)) && x.j.order.zone === 'Cairo+Giza', 'لا payload مؤكِّد ولا قراءة → warning (مش نجاح مجهول)');
  // D1 واقع
  id = fresh(); const badEnv = { ...env, DB: { prepare: () => ({ bind: () => ({ run: async () => { throw new Error('d1 down'); } }) }) } };
  x = await post('action=reassign_to_bosta', { orderId: id, employee: 'E' }, badEnv);
  is(x.j.status === 'success' && x.j.logged === false && x.j.logError, 'D1 واقع: التحويل نجح والرد بيقول logged:false');
  // OAuth ناقص
  x = await post('action=reassign_to_bosta', { orderId: id, employee: 'E' }, { ...env, CLIENT_ID: '' }); is(x.r.status === 500 && /CLIENT_ID/.test(x.j.error), 'متغير ناقص → رسالة باسمه');
}

sec('⑦ التشخيص والسجل');
{
  reset();
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (u, i) => {
    const b = i?.body ? JSON.parse(i.body) : {};
    if (b.query?.includes('accessScopes')) return new Response(JSON.stringify({ data: { currentAppInstallation: { accessScopes: [{ handle: 'read_orders' }, { handle: 'write_orders' }] } } }), { status: 200 });
    if (b.query?.includes('metafieldDefinitions')) {
      const ch = (a) => [{ name: 'choices', value: JSON.stringify(a) }];
      return new Response(JSON.stringify({ data: { metafieldDefinitions: { nodes: [
        { key: 'manual_status', type: { name: 'single_line_text_field' }, validations: ch(['Ready', 'Confirmed']) },
        { key: 'status_2_r_e', type: { name: 'single_line_text_field' }, validations: ch(['Ready', 'Confirmed + RETURN']) },   // EXCHANGE ناقصة عمدًا
        { key: 'zone', type: { name: 'single_line_text_field' }, validations: ch(['Cairo+Giza', 'Other_Regions', 'Show_Room', 'BLANK']) },
        { key: 'courier', type: { name: 'single_line_text_field' }, validations: ch(['Bosta']) },
      ] } } }), { status: 200 });
    }
    return origFetch(u, i);
  };
  const x = await get('action=diag'); globalThis.fetch = origFetch;
  const byLabel = Object.fromEntries(x.j.checks.map(c => [c.label, c]));
  is(Array.isArray(x.j.checks) && x.j.checks.every(c => typeof c.ok === 'boolean'), 'diag = مصفوفة بـ ok صريحة');
  is(byLabel['تعريف custom.status_2_r_e'].ok === false && /Confirmed \+ EXCHANGE/.test(byLabel['تعريف custom.status_2_r_e'].detail), 'diag بيمسك قيمة ناقصة من الـ choice list');
  is(byLabel['تعريف custom.package_shipping_re_assign'].ok === false, 'diag بيمسك تعريف العلامة الناقص');
  is(byLabel['صلاحيات التطبيق'].ok, 'diag بيفحص write_orders');
  is(!JSON.stringify(x.j).includes('"sec"') && !/Bearer/.test(JSON.stringify(x.j)), 'diag مابيرجّعش قيمة السر');
  is(/بصمة [0-9a-f]{8}/.test(byLabel['بصمة WORKER_SECRET'].detail), 'بصمة السر (٨ hex)');
  const l = await get('action=get_logs_export'); is(l.j.cap === 2000 && 'truncated' in l.j && 'total' in l.j, 'get_logs_export بيرجّع cap/total/truncated');
}

sec('⑧ السجل — فلاتر الأعمدة (v1.1.0)');
{
  const seen = [];
  const rec = { prepare: (sql) => ({ bind: (...a) => { seen.push({ sql, a }); return { all: async () => ({ results: /GROUP BY employee/.test(sql) ? [{ employee: 'Ahmed_Ibraheem', n: 3 }, { employee: 'Sara', n: 1 }] : [] }), first: async () => ({ total: 0 }), run: async () => ({}) }; } }) };
  const e2 = { ...env, DB: rec };
  let x = await get('action=get_logs&results=success,warning&orderName=55&notes=Confirmed&employees=A,B&types=rejected&dateFrom=2026-10-01&dateTo=2026-10-31&sortBy=type&sortDir=asc&limit=100&offset=0', e2);
  const q = seen.find(c => /FROM logs/.test(c.sql) && /LIMIT/.test(c.sql));
  is(x.j.ok && q && /json_extract\(extra, '\$\.result'\) IN \(\?,\?\)/.test(q.sql), 'results[] بيتحوّل لـ json_extract(extra,$.result) IN');
  is(q && q.a.includes('success') && q.a.includes('warning') && q.a.includes('%55%') && q.a.includes('%Confirmed%'), 'orderName و notes بيتبعتوا bind (مش نص في الـ SQL)');
  is(q && /order_name LIKE \?/.test(q.sql) && /notes LIKE \?/.test(q.sql) && !/55/.test(q.sql), 'مفيش قيمة من العميل متلزقة في نص SQL');
  is(q && /ORDER BY type ASC, timestamp DESC/.test(q.sql), 'الترتيب بـ type (قايمة بيضاء) مع كاسر تعادل');
  is(q && /type NOT IN \('login','logout'\)/.test(q.sql) && q.a[0] === 're_assign_package_zone_bosta', 'login/logout مستثنيين server-side والأداة متفلترة بـ tool');
  seen.length = 0;
  x = await get('action=get_logs_count&results=error', e2);
  is(x.j.ok && seen.some(c => /COUNT\(\*\)/.test(c.sql) && /json_extract/.test(c.sql)), 'get_logs_count بياخد نفس فلتر النتيجة (مصدر واحد)');
  x = await get('action=get_logs&sortBy=bogus%3B%20DROP%20TABLE%20logs', e2);
  is(x.j.ok && seen.some(c => /ORDER BY timestamp DESC/.test(c.sql)), 'مفتاح ترتيب مش في القايمة بيرجع للافتراضي بلا خطأ');
  x = await get('action=get_log_options', e2);
  is(x.j.ok && x.j.employees.length === 2 && x.j.employees[0].value === 'Ahmed_Ibraheem' && x.j.employees[0].count === 3, 'get_log_options بيرجّع الموظفين بعدّادهم');
  is(seen.some(c => /GROUP BY employee/.test(c.sql) && /NOT IN \('login','logout'\)/.test(c.sql)), 'قايمة الموظفين مستثني منها login/logout');
  x = await get('action=get_log_options', { ...env, DB: undefined });
  is(x.r.status === 500 && /DB/.test(x.j.error), 'من غير D1 → رسالة باسم الـ binding');
  x = await get('action=get_log_options', env, { Origin: 'https://ecommoda-dev.github.io' });
  is(x.r.status === 401, 'get_log_options محمي بالسر');
  x = await get('action=get_config'); is(x.j.version === '1.1.0', 'النسخة 1.1.0');
}

console.log(`\n${fail ? '❌' : '✅'} عدّى ${pass} · فشل ${fail}`);
process.exit(fail ? 1 : 0);
