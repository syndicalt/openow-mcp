/**
 * ExecKB — skill executable for the Knowledge domain (§6.3 card sn.kb.answer).
 * ES5 only (ServiceNow scoped app): var/function, no arrows, no template literals.
 *
 * Read-only. Prefers a published article or a catalog item over opening a
 * ticket. Returns pointers + the first useful paragraph — never full article
 * bodies in context.
 */
var ExecKB = function () {
  this.VERSION = '1.0.0';
  this.DOMAIN = 'kb';
};

/* ---------------------------------------------------------------------- *
 * Shared ES5 helpers (inline; no cross-file dependency)
 * ---------------------------------------------------------------------- */

function _args(ctx, inputs) {
  return { ctx: ctx || {}, inputs: inputs || {} };
}

function _newGR(table) {
  if (typeof GlideRecordSecure !== 'undefined') { return new GlideRecordSecure(table); }
  if (typeof GlideRecord !== 'undefined') { return new GlideRecord(table); }
  return null;
}

function _gv(rec, field) {
  if (!rec) { return ''; }
  try {
    if (rec.isValidField && !rec.isValidField(field)) { return ''; }
    var v = rec.getValue ? rec.getValue(field) : rec[field];
    if (v === null || v === undefined) { return ''; }
    return String(v);
  } catch (e) { return ''; }
}

function _dv(rec, field) {
  if (!rec) { return ''; }
  try {
    if (rec.isValidField && !rec.isValidField(field)) { return ''; }
    var v = rec.getDisplayValue ? rec.getDisplayValue(field) : rec[field];
    if (v === null || v === undefined) { return ''; }
    return String(v);
  } catch (e) { return ''; }
}

function _echo(inputs, name, aliases) {
  if (inputs === null || inputs === undefined) { return undefined; }
  if (inputs[name] !== undefined && inputs[name] !== null && inputs[name] !== '') { return inputs[name]; }
  var list = aliases || [];
  for (var i = 0; i < list.length; i++) {
    var v = inputs[list[i]];
    if (v !== undefined && v !== null && v !== '') { return v; }
  }
  return undefined;
}

function _isCtx(o) {
  return !!(o && typeof o === 'object' && o.user && typeof o.user === 'object');
}

function _stamp(ctx) {
  var d = (ctx && ctx.now && typeof ctx.now === 'function') ? ctx.now() : new Date();
  if (d && d.getValue) { return String(d.getValue()); }
  if (d && d.toJSON) { return String(d.toJSON()); }
  return String(d);
}

function _datePart(ctx) {
  var d = (ctx && ctx.now && typeof ctx.now === 'function') ? ctx.now() : new Date();
  var s = '';
  if (d && d.getValue) { s = String(d.getValue()); }
  else if (d && d.toISOString) { s = String(d.toISOString()); }
  else { s = String(d); }
  return s.slice(0, 10);
}

function _cap(arr, n) {
  if (!arr) { return []; }
  return arr.slice(0, n || 25);
}

/* ---------------------------------------------------------------------- *
 * sn.kb.answer — Answer from Knowledge and catalog (read)
 * ---------------------------------------------------------------------- */

ExecKB.prototype.plan_answer = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var c = a.ctx, inp = a.inputs;
  var question = _echo(inp, 'question', ['text', 'query', 'q']) || '';
  if (!question) { return { focusedPayload: {}, missingFields: ['question'] }; }
  var provisioning = inp.provisioning === true || /provision|request|order|buy|need|setup|create/.test(String(question).toLowerCase());

  var today = _datePart(c);
  var articles = [];
  try {
    var k = _newGR('kb_knowledge');
    k.addQuery('workflow_state', 'published');
    k.addQuery('retired', false);
    k.addQuery('valid_to', '>=', today);
    k.addQuery('short_description', 'CONTAINS', String(question).slice(0, 120));
    k.orderBy('sys_updated_on');
    k.setLimit(3);
    k.query();
    while (k.next()) {
      var text = _gv(k, 'text');
      articles.push({
        number: _gv(k, 'number'),
        title: _gv(k, 'short_description'),
        excerpt: String(text).slice(0, 240) || String(_gv(k, 'text')).slice(0, 240)
      });
    }
  } catch (e) { /* KB table unavailable */ }

  var items = [];
  if (provisioning) {
    try {
      var gi = _newGR('sc_cat_item');
      gi.addQuery('active', true);
      gi.addQuery('name', 'CONTAINS', String(question).slice(0, 120));
      gi.setLimit(5);
      gi.query();
      while (gi.next()) {
        items.push({ sys_id: _gv(gi, 'sys_id'), name: _gv(gi, 'name') });
      }
    } catch (e) { /* catalog unavailable */ }
  }

  var confidence = 'high';
  var next = [];
  if (articles.length === 0 && items.length === 0) {
    confidence = 'low';
    next = ['sn.itsm.incident.triage', 'sn.itsm.request.submit'];
  }

  return {
    focusedPayload: {
      question: question,
      articles: _cap(articles, 3),
      catalog_items: _cap(items, 5),
      confidence: confidence,
      next_skills: next
    },
    recordNumbers: articles.length > 0 ? [articles[0].number] : []
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExecKB;
}
