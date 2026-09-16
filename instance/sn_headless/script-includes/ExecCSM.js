/**
 * ExecCSM — skill executables for the CSM domain (§6.4 cards).
 * ES5 only (ServiceNow scoped app): var/function, no arrows, no template literals.
 *
 * plan_case_briefing: read-only account + case briefing.
 * plan/apply_case_update: customer-visible comments confirm; escalation uses
 * the published path only (a case state/priority change is proposed, never
 * invented). Applier writes through GlideRecordSecure.
 */
var ExecCSM = function () {
  this.VERSION = '1.0.0';
  this.DOMAIN = 'csm';
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

function _set(rec, field, value) {
  if (!rec || !rec.setValue) { return; }
  if (value === null || value === undefined || value === '') { return; }
  try {
    if (rec.isValidField && !rec.isValidField(field)) { return; }
    rec.setValue(field, value);
  } catch (e) { /* field not present: skip */ }
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

function _has(value) {
  return value !== undefined && value !== null && value !== '';
}

function _me(ctx) {
  var c = ctx || {}, u = c.user || {};
  return u.sys_id || c.userId || '';
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

function _cap(arr, n) {
  if (!arr) { return []; }
  return arr.slice(0, n || 25);
}

function _loadByNumber(table, number) {
  var gr = _newGR(table);
  if (!gr || !number) { return null; }
  try {
    if (String(number).indexOf('sys_') === 0 && String(number).length === 32) {
      if (gr.get(number)) { return gr; }
    }
    gr.addQuery('number', number);
    gr.setLimit(2);
    gr.query();
    if (gr.next()) { return gr; }
  } catch (e) { return null; }
  return null;
}

function _findByName(table, name) {
  var gr = _newGR(table);
  if (!gr || !name) { return null; }
  try {
    gr.addQuery('name', name);
    gr.setLimit(1);
    gr.query();
    if (gr.next()) { return gr; }
    gr = _newGR(table);
    gr.addQuery('name', 'CONTAINS', name);
    gr.setLimit(1);
    gr.query();
    if (gr.next()) { return gr; }
  } catch (e) { return null; }
  return null;
}

function _caseRow(rec) {
  return {
    sys_id: _gv(rec, 'sys_id'),
    number: _gv(rec, 'number'),
    short_description: _gv(rec, 'short_description'),
    state: _dv(rec, 'state') || _gv(rec, 'state'),
    priority: _dv(rec, 'priority') || _gv(rec, 'priority'),
    assigned_to: _dv(rec, 'assigned_to'),
    assignment_group: _dv(rec, 'assignment_group'),
    created: _gv(rec, 'sys_created_on')
  };
}

/* ---------------------------------------------------------------------- *
 * sn.csm.case.briefing — Account and case briefing (read)
 * ---------------------------------------------------------------------- */

ExecCSM.prototype.plan_case_briefing = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var c = a.ctx, inp = a.inputs;
  var accountTerm = _echo(inp, 'account', ['account_name', 'name', 'number']) || '';
  if (!accountTerm) { return { focusedPayload: {}, missingFields: ['account'] }; }

  var acct = _findByName('csn_account', accountTerm) || _loadByNumber('csn_account', accountTerm);
  if (!acct) {
    return { focusedPayload: { account: accountTerm }, error: 'Account "' + accountTerm + '" not found or not readable (403 is valid)' };
  }
  var acctSysId = _gv(acct, 'sys_id');

  var cases = [];
  var entitlements = [];
  var interactions = [];

  try {
    var cs = _newGR('sn_customerservice_case');
    cs.addQuery('account', acctSysId);
    cs.orderBy('priority');
    cs.setLimit(20);
    cs.query();
    while (cs.next()) {
      cases.push(_caseRow(cs));
    }
  } catch (e) { /* CSM case table unavailable */ }

  try {
    var ent = _newGR('sn_customerservice_entitlement');
    if (!ent) { ent = _newGR('sn_entitlement'); }
    if (ent) {
      ent.addQuery('account', acctSysId);
      ent.setLimit(20);
      ent.query();
      var today = _stamp(c).slice(0, 10);
      while (ent.next()) {
        var expiry = _gv(ent, 'expiration_date') || _gv(ent, 'end_date');
        var expired = expiry !== '' && expiry.slice(0, 10) < today;
        var entail = {
          sys_id: _gv(ent, 'sys_id'),
          name: _gv(ent, 'name'),
          expiry: expiry,
          expired: expired
        };
        entitlements.push(entail);
      }
    }
  } catch (e) { /* entitlement tables unavailable */ }

  try {
    var journal = _newGR('sys_journal_field');
    journal.addQuery('name', 'sn_customerservice_case');
    journal.addQuery('element', 'IN', 'comments,work_notes');
    journal.orderByDesc('sys_created_on');
    journal.setLimit(5);
    journal.query();
    while (journal.next()) {
      interactions.push({
        case: _gv(journal, 'element') === 'comments' ? '' : '',
        author: _dv(journal, 'sys_created_by'),
        when: _gv(journal, 'sys_created_on'),
        snippet: String(_gv(journal, 'value')).slice(0, 140),
        internal: _gv(journal, 'element') === 'work_notes'
      });
    }
  } catch (e) { /* journal unavailable */ }

  return {
    focusedPayload: {
      account: { sys_id: acctSysId, name: _gv(acct, 'name'), number: _gv(acct, 'number') },
      open_cases: _cap(cases, 20),
      entitlements: _cap(entitlements, 20),
      last_interactions: _cap(interactions, 5),
      internal_notes_hidden: false
    },
    recordNumbers: [acctSysId]
  };
};

/* ---------------------------------------------------------------------- *
 * sn.csm.case.update — Update or escalate a case (update_owned)
 * ---------------------------------------------------------------------- */

ExecCSM.prototype.plan_case_update = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var c = a.ctx, inp = a.inputs;
  var number = _echo(inp, 'case_number', ['number']) || '';
  var mode = _echo(inp, 'mode', ['action']) || '';
  var missing = [];
  if (!number) { missing.push('case_number'); }
  if (!mode) { missing.push('mode'); }
  if (['comment', 'work_note', 'escalate'].indexOf(mode) < 0 && mode) { missing.push('mode(comment|work_note|escalate)'); }
  if (missing.length > 0) { return { focusedPayload: {}, missingFields: missing }; }

  var rec = _loadByNumber('sn_customerservice_case', number);
  if (!rec) {
    /* HR/Case naming drift safety: some instances name the table differently */
    rec = _loadByNumber('cs_case', number) || _loadByNumber('sn_customerservice_case', '');
    if (!rec) { return { focusedPayload: { case_number: number }, error: 'Case ' + number + ' not found or not readable' }; }
  }
  if (!_gv(rec, 'number')) {
    /* reloaded wrong table; keep the original lookup result */
  }

  var me = _me(c);
  var owned = _gv(rec, 'assigned_to') === me;
  var payload = {
    case_number: _gv(rec, 'number'),
    state: _dv(rec, 'state') || _gv(rec, 'state'),
    priority: _dv(rec, 'priority') || _gv(rec, 'priority'),
    assigned_to: _dv(rec, 'assigned_to'),
    mode: mode
  };
  var plan = { focusedPayload: payload, recordNumbers: [_gv(rec, 'number')], owned: owned };

  if (mode === 'comment') {
    var comment = _echo(inp, 'comment', ['comments', 'text']) || '';
    if (!comment) { plan.missingFields = ['comment']; }
    plan.diff = [{ field: 'comments', before: null, after: comment }];
    plan.focusedPayload.journal_snippet = String(comment).slice(0, 120);
  } else if (mode === 'work_note') {
    var note = _echo(inp, 'work_note', ['work_notes', 'note']) || '';
    if (!note) { plan.missingFields = ['work_note']; }
    plan.diff = [{ field: 'work_notes', before: null, after: note }];
    plan.focusedPayload.journal_snippet = String(note).slice(0, 120);
  } else { /* escalate: published path only — propose priority bump, never invent state */
    var target = _echo(inp, 'priority', ['to_priority']) || '1';
    var cur = _gv(rec, 'priority') || '3';
    plan.diff = [{ field: 'priority', before: cur, after: target }];
    plan.focusedPayload.escalation = { from: cur, to: target };
    plan.owned = false;
  }
  if (mode === 'comment') { plan.owned = owned; }
  return plan;
};

ExecCSM.prototype.apply_case_update = function (ctx, plan) {
  var numbers = [];
  var payload = (plan && plan.focusedPayload) || {};
  var number = payload.case_number || '';
  var rec = number ? _loadByNumber('sn_customerservice_case', number) : null;
  if (!rec && number) { rec = _loadByNumber('cs_case', number); }
  if (!rec) { return { recordNumbers: numbers, error: number + ' not found' }; }

  var mode = payload.mode || '';
  try {
    if (mode === 'comment') {
      for (var i = 0; i < (plan.diff || []).length; i++) {
        if (plan.diff[i].field === 'comments') { _set(rec, 'comments', plan.diff[i].after); }
      }
      rec.update();
    } else if (mode === 'work_note') {
      for (var j = 0; j < (plan.diff || []).length; j++) {
        if (plan.diff[j].field === 'work_notes') { _set(rec, 'work_notes', plan.diff[j].after); }
      }
      rec.update();
    } else { /* escalate: priority only; state transitions stay with Flow/playbook */
      for (var k = 0; k < (plan.diff || []).length; k++) {
        if (plan.diff[k].field === 'priority') { _set(rec, 'priority', plan.diff[k].after); }
      }
      rec.update();
    }
    numbers.push(number);
  } catch (e) {
    return { recordNumbers: numbers, error: 'case update failed: ' + String(e) };
  }
  return { recordNumbers: numbers, focusedPayload: payload };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExecCSM;
}
