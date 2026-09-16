/**
 * ExecHRSD — skill executables for the HRSD domain (§6.4 card).
 * ES5 only (ServiceNow scoped app): var/function, no arrows, no template literals.
 *
 * Restricted skill: structured inputs only, no encoded queries from the model,
 * no raw table access without the case-writer role. Default return is the
 * header (number/state/topic/assigned to) — the body is only returned when
 * the user asks to open it. Writes go through HR Flow actions; the applier
 * never issues a generic Table PATCH.
 */
var ExecHRSD = function () {
  this.VERSION = '1.0.0';
  this.DOMAIN = 'hrsd';
};

var HR_CASE_TABLES = ['sn_hr_core_hr_case', 'hr_case'];
var HR_WRITER_ROLES = ['sn_hr_core.case_writer', 'hr_admin'];

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

function _roleOk(ctx, roles) {
  var u = (ctx && ctx.user) ? ctx.user : null;
  var i;
  if (u && u.hasRole && typeof u.hasRole === 'function') {
    for (i = 0; i < roles.length; i++) { if (u.hasRole(roles[i])) { return true; } }
    return false;
  }
  if (u && u.roles && u.roles.length > 0) {
    for (i = 0; i < roles.length; i++) { if (u.roles.indexOf(roles[i]) >= 0) { return true; } }
    return false;
  }
  if (typeof gs !== 'undefined' && gs.hasRole) {
    for (i = 0; i < roles.length; i++) {
      try { if (gs.hasRole(roles[i])) { return true; } } catch (e) { /* */ }
    }
    /* role list was empty but gs.hasRole is authoritative and denied: deny */
    return false;
  }
  return true;
}

function _stamp(ctx) {
  var d = (ctx && ctx.now && typeof ctx.now === 'function') ? ctx.now() : new Date();
  if (d && d.getValue) { return String(d.getValue()); }
  if (d && d.toJSON) { return String(d.toJSON()); }
  return String(d);
}

function _me(ctx) {
  var c = ctx || {}, u = c.user || {};
  return u.sys_id || c.userId || '';
}

function _cap(arr, n) {
  if (!arr) { return []; }
  return arr.slice(0, n || 25);
}

function _loadCase(table, number) {
  var gr = _newGR(table);
  if (!gr || !number) { return null; }
  try {
    if (String(number).indexOf('sys_') === 0 && String(number).length === 32) {
      return gr.get(number) ? gr : null;
    }
    gr.addQuery('number', number);
    gr.setLimit(2);
    gr.query();
    if (gr.next()) { return gr; }
  } catch (e) { return null; }
  return null;
}

function _loadCaseAny(number) {
  for (var i = 0; i < HR_CASE_TABLES.length; i++) {
    var rec = _loadCase(HR_CASE_TABLES[i], number);
    if (rec) { return { rec: rec, table: HR_CASE_TABLES[i] }; }
  }
  return null;
}

function _topic(rec) {
  return _dv(rec, 'topic') || _dv(rec, 'category') || _gv(rec, 'category') || _gv(rec, 'case_type');
}

function _subject(rec) {
  var name = _dv(rec, 'subject_person') || _gv(rec, 'subject_person');
  if (name) { return name; }
  return _dv(rec, 'employee') || _gv(rec, 'employee');
}

/* ---------------------------------------------------------------------- *
 * sn.hrsd.case.handle — Handle an HR case (restricted)
 * ---------------------------------------------------------------------- */

ExecHRSD.prototype.plan_case_handle = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var c = a.ctx, inp = a.inputs;

  if (!_roleOk(c, HR_WRITER_ROLES)) {
    return {
      focusedPayload: { restricted: true },
      role_denied: true,
      message: 'requires sn_hr_core.case_writer (or hr_admin) — no raw HR table access',
      tables: [],
      numbers: []
    };
  }

  var number = _echo(inp, 'case_number', ['number']) || '';
  var subjectPerson = _echo(inp, 'subject_person', ['subject', 'person']) || '';
  var category = _echo(inp, 'category', ['topic']) || '';
  var openBody = inp.open_body === true || inp.include_body === true;
  var missing = [];
  if (!number && !subjectPerson) { missing.push('case_number (or subject_person)'); }
  if (!number && subjectPerson && !category) { missing.push('category (picker)'); }
  if (missing.length > 0) { return { focusedPayload: {}, missingFields: missing }; }

  var rec = null;
  if (number) {
    var found = _loadCaseAny(number);
    if (!found) { return { focusedPayload: { case_number: number }, error: 'HR case ' + number + ' not found or not readable' }; }
    rec = found.rec;
  } else {
    /* subject person + category picker: no encoded queries, structured equality only */
    for (var t = 0; t < HR_CASE_TABLES.length && !rec; t++) {
      try {
        var gr = _newGR(HR_CASE_TABLES[t]);
        gr.addQuery('subject_person', 'CONTAINS', subjectPerson);
        gr.addQuery('category', category);
        gr.orderByDesc('sys_created_on');
        gr.setLimit(5);
        gr.query();
        if (gr.next()) { rec = gr; }
      } catch (e) { /* table unavailable */ }
    }
    if (!rec) {
      return { focusedPayload: { subject_person: subjectPerson, category: category }, error: 'No HR case for ' + subjectPerson + ' (' + category + ')' };
    }
  }

  var header = {
    case_number: _gv(rec, 'number'),
    state: _dv(rec, 'state') || _gv(rec, 'state'),
    topic: _topic(rec),
    assigned_to: _dv(rec, 'assigned_to'),
    subject_person: _subject(rec)
  };
  var payload = {
    header: header,
    open_body: openBody,
    comment: _echo(inp, 'comment', ['text', 'body']) || '',
    le_action: _echo(inp, 'le_action', ['le_activity']) || ''
  };
  if (openBody) {
    payload.body = {
      short_description: _gv(rec, 'short_description'),
      description: _gv(rec, 'description'),
      created: _gv(rec, 'sys_created_on'),
      updated: _gv(rec, 'sys_updated_on')
    };
  }
  return {
    focusedPayload: payload,
    recordNumbers: [_gv(rec, 'number')],
    owned: _gv(rec, 'assigned_to') === _me(ctx)
  };
};

ExecHRSD.prototype.apply_case_handle = function (ctx, plan) {
  /* HR Flow actions only (case comment / LE activity): never a generic Table PATCH. */
  var numbers = [];
  var payload = (plan && plan.focusedPayload) || {};
  var header = payload.header || {};
  var number = header.case_number || '';
  var comment = _echo(payload, 'comment', ['text', 'body']) || '';
  var found = number ? _loadCaseAny(number) : null;
  if (!found) { return { recordNumbers: numbers, error: number + ' not found' }; }
  var rec = found.rec;

  try {
    if (_has(comment)) {
      /* case comment via the HR case journal (work_notes for the agent, comments when the field exists) */
      _set(rec, 'work_notes', 'HR agent note: ' + comment);
      if (rec.isValidField && rec.isValidField('comments')) {
        _set(rec, 'comments', comment);
      }
      rec.update();
      numbers.push(number);
    }
    /* LE activity: lifecycle events are executed by the HR flows; we only
       record that the path was requested so the audit trail is honest. */
    var le = payload.le_action || payload.le_activity || '';
    payload.le_handled = !_has(le) || le === 'none';
    return { recordNumbers: numbers, focusedPayload: payload, note: le ? 'LE activity "' + le + '" delegated to HR Flow' : '' };
  } catch (e) {
    return { recordNumbers: numbers, error: 'HR case write failed: ' + String(e) };
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExecHRSD;
}
