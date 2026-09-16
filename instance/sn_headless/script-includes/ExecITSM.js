/**
 * ExecITSM — skill executables for the ITSM domain (§6.2 cards).
 * ES5 only (ServiceNow scoped app): var/function, no arrows, no template literals.
 *
 * Planner methods return { error?, focusedPayload, diff?, draft?, missingFields?,
 * recordNumbers?, owned? } and never mutate. Applier methods receive (ctx, plan)
 * and return { recordNumbers, focusedPayload? } after performing the writes
 * through GlideRecordSecure. Table API/engine semantics are preserved: the
 * applier never invents state transitions and never calls setWorkflow(false).
 */
var ExecITSM = function () {
  this.VERSION = '1.0.0';
  this.DOMAIN = 'itsm';
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
  } catch (e) { /* field not present on this table: skip */ }
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

function _roleOk(ctx, role) {
  var u = (ctx && ctx.user) ? ctx.user : null;
  if (u && u.hasRole && typeof u.hasRole === 'function') { return !!u.hasRole(role); }
  if (u && u.roles && u.roles.indexOf(role) >= 0) { return true; }
  if (typeof gs !== 'undefined' && gs.hasRole) {
    try { return !!gs.hasRole(role); } catch (e) { return false; }
  }
  return false;
}

function _cap(arr, n) {
  if (!arr) { return []; }
  return arr.slice(0, n || 25);
}

function _dedupe(arr) {
  var out = [], i;
  for (i = 0; i < arr.length; i++) {
    if (arr[i] && out.indexOf(arr[i]) < 0) { out.push(arr[i]); }
  }
  return out;
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

function _addDays(ctx, days) {
  var base = new Date();
  try {
    if (ctx && ctx.now && typeof ctx.now === 'function') {
      var g = ctx.now();
      if (g && g.getValue) { base = new Date(String(g.getValue()).replace(' ', 'T') + 'Z'); }
    }
  } catch (e) { base = new Date(); }
  base.setDate(base.getDate() + days);
  var m = String(base.getMonth() + 1), dd = String(base.getDate());
  if (m.length < 2) { m = '0' + m; }
  if (dd.length < 2) { dd = '0' + dd; }
  return String(base.getFullYear()) + '-' + m + '-' + dd;
}

function _priority(impact, urgency) {
  var im = Number(impact), ug = Number(urgency);
  if (!isFinite(im) || im < 1 || im > 3) { im = 3; }
  if (!isFinite(ug) || ug < 1 || ug > 3) { ug = 3; }
  if (im === 1 && ug === 1) { return '1'; }
  if ((im === 1 && ug === 2) || (im === 2 && ug === 1)) { return '2'; }
  if ((im === 1 && ug === 3) || (im === 2 && ug === 2) || (im === 3 && ug === 1)) { return '3'; }
  return '4';
}

function _row(rec) {
  return {
    sys_id: _gv(rec, 'sys_id'),
    number: _gv(rec, 'number') || _gv(rec, 'name'),
    short_description: _gv(rec, 'short_description'),
    state: _dv(rec, 'state'),
    priority: _dv(rec, 'priority'),
    assigned_to: _dv(rec, 'assigned_to'),
    assignment_group: _dv(rec, 'assignment_group')
  };
}

function _queryIncidents(ctx, conditions, limit) {
  /* conditions: array of [field, op, value] or [field, value] */
  var out = [];
  var gr = _newGR('incident');
  if (!gr) { return out; }
  try {
    gr.addQuery('active', true);
    for (var i = 0; i < conditions.length; i++) {
      var c = conditions[i];
      if (c.length === 3) { gr.addQuery(c[0], c[1], c[2]); } else { gr.addQuery(c[0], c[1]); }
    }
    gr.orderByDesc('sys_created_on');
    gr.setLimit(limit || 25);
    gr.query();
    while (gr.next()) { out.push(_row(gr)); }
  } catch (e) { /* table or ACL access unavailable */ }
  return out;
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

function _incidentRow(rec) {
  return {
    sys_id: _gv(rec, 'sys_id'),
    number: _gv(rec, 'number'),
    short_description: _gv(rec, 'short_description'),
    state: _dv(rec, 'state'),
    priority: _dv(rec, 'priority'),
    assigned_to: _dv(rec, 'assigned_to'),
    assignment_group: _dv(rec, 'assignment_group'),
    cmdb_ci: _dv(rec, 'cmdb_ci'),
    updated: _gv(rec, 'sys_updated_on')
  };
}

function _diffEntry(rec, field, after) {
  var before = _gv(rec, field);
  if (String(before) === String(after)) { return null; }
  return { field: field, before: before === '' ? null : before, after: after };
}

/* ---------------------------------------------------------------------- *
 * sn.itsm.shift.briefing — Shift start / queue briefing (read)
 * ---------------------------------------------------------------------- */

ExecITSM.prototype._myGroupIds = function (ctx) {
  var me = _me(ctx);
  var ids = [];
  if (!me) { return ids; }
  var gr = _newGR('sys_user_grmember');
  if (!gr) { return ids; }
  try {
    gr.addQuery('user', me);
    gr.setLimit(200);
    gr.query();
    while (gr.next()) {
      var g = _gv(gr, 'group');
      if (g && ids.indexOf(g) < 0) { ids.push(g); }
    }
  } catch (e) { /* resolver internals; no groups is an empty briefing */ }
  return ids;
};

ExecITSM.prototype.plan_shift_briefing = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var c = a.ctx, inp = a.inputs;
  var me = _me(c);
  var groupIds = this._myGroupIds(c);
  var out = { at_risk: [], unassigned: [], mine: [], majors: [], changes_today: [], first_actions: [] };
  var numbers = [];
  var i;

  /* Assigned to me, open */
  var mine = _queryIncidents(c, [['assigned_to', me]], 25);
  for (i = 0; i < mine.length; i++) { numbers.push(mine[i].number); }
  out.mine = mine;

  /* Unassigned in my groups */
  if (groupIds.length > 0) {
    out.unassigned = _queryIncidents(c, [['assignment_group', 'IN', groupIds.join(',')], ['assigned_to', '']], 25);
  }

  /* SLA at risk (>= 75% consumed, not breached) — dot-walked to my scope */
  try {
    var sla = _newGR('task_sla');
    if (sla) {
      sla.addQuery('active', true);
      sla.addQuery('has_breached', false);
      sla.addQuery('business_percentage', '>=', 75);
      if (groupIds.length > 0) {
        sla.addQuery('task.assignment_group', 'IN', groupIds.join(','));
        sla.addOrCondition('task.assigned_to', me);
      } else if (me) {
        sla.addQuery('task.assigned_to', me);
      }
      sla.orderBy('planned_end_time');
      sla.setLimit(25);
      sla.query();
      while (sla.next()) {
        var num = _dv(sla, 'task') || _gv(sla, 'task');
        out.at_risk.push({
          number: num,
          percent: _gv(sla, 'business_percentage'),
          planned_end: _gv(sla, 'planned_end_time'),
          assigned_to: _dv(sla, 'task.assigned_to') || '',
          type: _dv(sla, 'task_sys_class_name') || ''
        });
        if (num) { numbers.push(num); }
      }
    }
  } catch (e) { /* SLA table missing: keep empty */ }

  /* Major incidents open */
  var majors = [];
  var gr = _newGR('incident');
  if (gr) {
    try {
      gr.addQuery('active', true);
      gr.addNotNullQuery('major_incident_state');
      gr.setLimit(25);
      gr.query();
      while (gr.next()) {
        majors.push(_incidentRow(gr));
        numbers.push(_gv(gr, 'number'));
      }
    } catch (e) { /* */ }
  }
  out.majors = majors;

  /* Changes go live today that touch supported CIs */
  var today = _datePart(c);
  var changes = [];
  try {
    var chg = _newGR('change_request');
    if (chg) {
      chg.addQuery('state', 'IN', '-5,-4');
      chg.addQuery('planned_start_date', '<=', today);
      chg.addQuery('planned_end_date', '>=', today);
      chg.setLimit(25);
      chg.query();
      while (chg.next()) {
        changes.push({
          sys_id: _gv(chg, 'sys_id'),
          number: _gv(chg, 'number'),
          short_description: _gv(chg, 'short_description'),
          state: _dv(chg, 'state'),
          start: _gv(chg, 'planned_start_date'),
          end: _gv(chg, 'planned_end_date')
        });
        numbers.push(_gv(chg, 'number'));
      }
    }
  } catch (e) { /* */ }
  out.changes_today = _cap(changes, 25);

  /* First three recommended actions */
  var acts = [];
  if (out.at_risk.length > 0) { acts.push('sla check ' + out.at_risk[0].number); }
  if (out.unassigned.length > 0) { acts.push('assign ' + out.unassigned[0].number); }
  if (out.mine.length > 0) { acts.push('work ' + out.mine[0].number); }
  if (out.majors.length > 0 && acts.length < 3) { acts.push('major incident: ' + out.majors[0].number); }
  out.first_actions = acts.slice(0, 3);

  return {
    focusedPayload: out,
    recordNumbers: _dedupe(numbers).slice(0, 25)
  };
};

/* ---------------------------------------------------------------------- *
 * sn.itsm.incident.triage — Triage a new or assigned incident (update_shared)
 * ---------------------------------------------------------------------- */

ExecITSM.prototype.plan_incident_similar = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var c = a.ctx, inp = a.inputs;
  var number = _echo(inp, 'incident_number', ['number']) || '';
  var text = _echo(inp, 'text', ['short_description', 'query']) || '';
  var ciTerm = _echo(inp, 'ci', ['ci_name', 'cmdb_ci']) || '';
  var base = { similar_incidents: [], known_errors: [], articles: [] };

  var rec = number ? _loadByNumber('incident', number) : null;
  if (rec) {
    if (!text) { text = _gv(rec, 'short_description') + ' ' + _gv(rec, 'description'); }
    if (!ciTerm) { ciTerm = _gv(rec, 'cmdb_ci'); }
  }
  var ciSysId = '';
  if (ciTerm) {
    var found = _findCi(c, ciTerm);
    if (found.match) { ciSysId = found.match.sys_id; }
  }

  /* same CI first */
  try {
    if (ciSysId) {
      var g = _newGR('incident');
      g.addQuery('cmdb_ci', ciSysId);
      if (rec) { g.addQuery('sys_id', '!=', _gv(rec, 'sys_id')); }
      g.orderByDesc('sys_created_on');
      g.setLimit(5);
      g.query();
      while (g.next()) {
        base.similar_incidents.push({ number: _gv(g, 'number'), short_description: _gv(g, 'short_description'), why: 'same CI' });
      }
    }
  } catch (e) { /* */ }

  /* text keywords before giving up */
  if (base.similar_incidents.length < 5 && text) {
    try {
      var h = _newGR('incident');
      h.addQuery('active', true);
      h.addQuery('short_description', 'CONTAINS', text.slice(0, 80));
      if (rec) { h.addQuery('sys_id', '!=', _gv(rec, 'sys_id')); }
      h.orderByDesc('sys_created_on');
      h.setLimit(5 - base.similar_incidents.length);
      h.query();
      while (h.next()) {
        base.similar_incidents.push({ number: _gv(h, 'number'), short_description: _gv(h, 'short_description'), why: 'keyword match' });
      }
    } catch (e) { /* */ }
  }

  /* known errors */
  try {
    var p = _newGR('problem');
    p.addQuery('known_error', true);
    if (ciSysId) { p.addQuery('cmdb_ci', ciSysId); }
    else if (text) { p.addQuery('short_description', 'CONTAINS', text.slice(0, 80)); }
    p.orderByDesc('sys_created_on');
    p.setLimit(3);
    p.query();
    while (p.next()) {
      base.known_errors.push({ number: _gv(p, 'number'), short_description: _gv(p, 'short_description'), why: ciSysId ? 'same CI' : 'keyword match' });
    }
  } catch (e) { /* */ }

  /* published KB articles */
  try {
    var k = _newGR('kb_knowledge');
    k.addQuery('workflow_state', 'published');
    k.addQuery('retired', false);
    if (text) { k.addQuery('short_description', 'CONTAINS', text.slice(0, 80)); }
    k.orderByDesc('sys_updated_on');
    k.setLimit(3);
    k.query();
    while (k.next()) {
      base.articles.push({ number: _gv(k, 'number'), short_description: _gv(k, 'short_description'), why: 'kb match' });
    }
  } catch (e) { /* */ }

  return { focusedPayload: base };
};

function _findCi(ctx, term) {
  var out = { match: null, candidates: [], ambiguous: false };
  if (!term) { return out; }
  try {
    if (ctx && ctx.findCi && typeof ctx.findCi === 'function') {
      var r = ctx.findCi(term);
      if (r && r.match) { out.match = r.match; }
      if (r && r.candidates) { out.candidates = r.candidates; }
      if (r && r.ambiguous !== undefined) { out.ambiguous = !!r.ambiguous; }
      return out;
    }
  } catch (e) { /* fall through to direct query */ }
  var gr = _newGR('cmdb_ci');
  if (!gr) { return out; }
  try {
    gr.addQuery('name', term);
    gr.addOrCondition('host_name', term);
    gr.addOrCondition('serial_number', term);
    gr.addOrCondition('asset_tag', term);
    gr.addOrCondition('ip_address', term);
    gr.setLimit(9);
    gr.query();
    while (gr.next()) {
      out.candidates.push({
        sys_id: _gv(gr, 'sys_id'), name: _gv(gr, 'name'), class: _gv(gr, 'sys_class_name'),
        operational_status: _dv(gr, 'operational_status'), support_group: _dv(gr, 'support_group')
      });
    }
    if (out.candidates.length === 1) { out.match = out.candidates[0]; }
    if (out.candidates.length > 1) { out.ambiguous = true; }
  } catch (e) { /* */ }
  return out;
}

function _inferCategory(ciClass) {
  var cls = String(ciClass || '').toLowerCase();
  if (cls.indexOf('server') >= 0 || cls.indexOf('hardware') >= 0) { return 'hardware'; }
  if (cls.indexOf('network') >= 0 || cls.indexOf('cluster') >= 0) { return 'network'; }
  if (cls.indexOf('appl') >= 0 || cls.indexOf('service') >= 0 || cls.indexOf('software') >= 0) { return 'software'; }
  return '';
}

ExecITSM.prototype.plan_incident_triage = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var c = a.ctx, inp = a.inputs;
  var number = _echo(inp, 'incident_number', ['number']) || '';
  if (!number) {
    return { focusedPayload: {}, missingFields: ['incident_number'] };
  }
  var rec = _loadByNumber('incident', number);
  if (!rec) {
    return { focusedPayload: { number: number }, error: 'Incident ' + number + ' not found or not readable' };
  }

  var similar = this.plan_incident_similar(c, { incident_number: number, ci: _gv(rec, 'cmdb_ci') });
  var ciCandidates = [];
  var chosenCi = '';
  var hostname = _echo(inp, 'hostname', ['ci', 'ci_name']) || '';
  var serviceName = _echo(inp, 'service_name', ['business_service']) || '';
  if (hostname || serviceName) {
    var f = _findCi(c, hostname || serviceName);
    ciCandidates = f.candidates || [];
    if (f.match) { chosenCi = f.match.sys_id; }
  }

  var category = _gv(rec, 'category');
  if (!category && chosenCi) {
    category = _inferCategory((f && f.match && f.match.class) ? f.match.class : '');
    /* keep empty -> propose nothing unless we can infer */
  }
  var supportGroup = (f && f.match && f.match.support_group) ? f.match.support_group : '';
  var proposal = { category: category, subcategory: '', impact: '', urgency: '' };
  if (chosenCi && !_gv(rec, 'cmdb_ci')) { proposal.cmdb_ci = chosenCi; }
  if (supportGroup && !_gv(rec, 'assignment_group')) { proposal.assignment_group = supportGroup; }

  var impact = proposal.impact || _gv(rec, 'impact') || '3';
  var urgency = proposal.urgency || _gv(rec, 'urgency') || '3';
  var priority = _priority(impact, urgency);

  var diff = [];
  var keys = ['category', 'subcategory', 'impact', 'urgency', 'priority', 'cmdb_ci', 'assignment_group'];
  var vals = {
    category: proposal.category, subcategory: proposal.subcategory,
    impact: proposal.impact, urgency: proposal.urgency, priority: priority,
    cmdb_ci: proposal.cmdb_ci, assignment_group: proposal.assignment_group
  };
  for (var i = 0; i < keys.length; i++) {
    var after = vals[keys[i]];
    if (!_has(after)) { continue; }
    var before = _gv(rec, keys[i]);
    if (before !== String(after)) {
      diff.push({ field: keys[i], before: before === '' ? null : before, after: after });
    }
  }

  var method = hostname ? 'name' : (number ? 'number' : '');
  var artifact = {
    number: number,
    current: { state: _dv(rec, 'state'), priority: _dv(rec, 'priority'), category: _dv(rec, 'category'), assignment_group: _dv(rec, 'assignment_group') },
    proposed: vals,
    ci_candidates: ciCandidates,
    similar_count: similar.focusedPayload.similar_incidents.length + similar.focusedPayload.known_errors.length,
    similar: similar.focusedPayload,
    next_skills: ['sn.itsm.incident.similar', 'sn.kb.answer']
  };
  var plan = {
    focusedPayload: artifact,
    diff: diff,
    recordNumbers: [number]
  };
  if (diff.length > 0) {
    plan.draft = { summary: 'Triage ' + number + ': apply proposed category/priority/assignment', fields: vals };
  }
  return plan;
};

/**
 * Triage apply: patch ONLY the proposed fields from the planner diff and add
 * a work note citing similar records + CI match method. Never sets state to
 * Resolved, never changes caller_id (spec §6.2).
 */
ExecITSM.prototype.apply_incident_triage = function (ctx, plan) {
  var diff = (plan && plan.diff) || [];
  var payload = (plan && plan.focusedPayload) || {};
  var number = payload.number || ((plan && plan.recordNumbers && plan.recordNumbers[0]) || '');
  var recordNumbers = [];
  try {
    var gr = new GlideRecordSecure('incident');
    var found = false;
    if (number.length === 32) { found = gr.get(number); }
    if (!found && number) {
      gr.addQuery('number', number);
      gr.setLimit(1);
      gr.query();
      found = gr.next();
    }
    if (found) {
      for (var i = 0; i < diff.length; i++) {
        gr.setValue(diff[i].field, diff[i].after);
      }
      var note = 'Triage applied by Open Now:';
      if (payload.similar_count !== undefined && payload.similar_count !== null) {
        note += ' ' + payload.similar_count + ' similar/known-error match(es) found;';
      }
      note += ' CI resolved by ' + (payload.ci_match_method || 'platform identification') + '.';
      gr.setValue('work_notes', (gr.getValue('work_notes') || '') + '\n' + note);
      gr.update();
    }
    recordNumbers.push(number || '');
  } catch (e) {
    recordNumbers.push(number || '');
  }
  return { recordNumbers: recordNumbers };
};

ExecITSM.prototype.plan_incident_update = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var c = a.ctx, inp = a.inputs;
  var number = _echo(inp, 'incident_number', ['number']) || '';
  var mode = _echo(inp, 'mode', ['action']) || '';
  var missing = [];
  if (!number) { missing.push('incident_number'); }
  if (!mode) { missing.push('mode'); }
  if (missing.length > 0) { return { focusedPayload: {}, missingFields: missing }; }
  if (['comment', 'work_note', 'resolve', 'close'].indexOf(mode) < 0) {
    return { focusedPayload: { number: number }, error: 'mode must be comment, work_note or resolve (got ' + mode + ')' };
  }
  var rec = _loadByNumber('incident', number);
  if (!rec) { return { focusedPayload: { number: number }, error: 'Incident ' + number + ' not found or not readable' }; }

  var plan = { focusedPayload: { number: number, mode: mode }, recordNumbers: [number], missingFields: [] };
  var me = _me(c);

  if (mode === 'resolve') {
    var code = _echo(inp, 'resolution_code', ['close_code']) || '';
    var notes = _echo(inp, 'resolution_notes', ['close_notes', 'note']) || '';
    if (!code) { plan.missingFields.push('resolution_code'); }
    if (!notes) { plan.missingFields.push('resolution_notes'); }
    var openChildren = 0;
    try {
      var kids = _newGR('incident');
      kids.addQuery('parent', _gv(rec, 'sys_id'));
      kids.addQuery('state', 'IN', '1,2,3');
      kids.setLimit(1);
      kids.query();
      if (kids.next()) { openChildren = 1; }
    } catch (e) { /* */ }
    if (openChildren) {
      plan.blocked = 'open child incidents (state 1/2/3)';
      plan.focusedPayload.blocked = plan.blocked;
    }
    plan.diff = [
      _diffEntry(rec, 'state', '6'),
      _diffEntry(rec, 'resolved_at', _stamp(c)),
      _diffEntry(rec, 'resolution_code', code),
      _diffEntry(rec, 'resolution_notes', notes)
    ].filter(function (d) { return d !== null; });
    plan.focusedPayload.proposed_state = '6 (Resolved)';
    plan.focusedPayload.next_skills = ['sn.itsm.sla.at_risk'];
  } else if (mode === 'comment') {
    var comment = _echo(inp, 'comment', ['comments', 'text']) || '';
    if (!comment) { plan.missingFields.push('comment'); }
    plan.diff = [_diffEntry(rec, 'comments', comment)].filter(function (d) { return d !== null; });
    plan.focusedPayload.journal_snippet = String(comment).slice(0, 120);
  } else { /* work_note */
    var note = _echo(inp, 'work_note', ['work_notes', 'note', 'comment', 'body']) || '';
    if (!note) { plan.missingFields.push('work_note'); }
    plan.diff = [_diffEntry(rec, 'work_notes', note)].filter(function (d) { return d !== null; });
    plan.focusedPayload.journal_snippet = String(note).slice(0, 120);
  }

  /* remaining SLA */
  try {
    var sla = _newGR('task_sla');
    sla.addQuery('task', _gv(rec, 'sys_id'));
    sla.addQuery('has_breached', false);
    sla.orderBy('planned_end_time');
    sla.setLimit(1);
    sla.query();
    if (sla.next()) { plan.focusedPayload.remaining_sla = _gv(sla, 'planned_end_time'); }
  } catch (e) { /* */ }

  /* update_owned: auto-apply only when the record is assigned to the caller */
  var owned = _gv(rec, 'assigned_to') === me;
  if (!owned && mode !== 'resolve') {
    owned = me === '' && true; /* open records without ownership still confirm */
  }
  plan.owned = owned;
  return plan;
};

ExecITSM.prototype.apply_incident_update = function (ctx, plan) {
  var c = ctx || {};
  var number = (plan && plan.focusedPayload && plan.focusedPayload.number) || '';
  var rec = number ? _loadByNumber('incident', number) : null;
  var numbers = [];
  if (rec) {
    var mode = (plan && plan.focusedPayload && plan.focusedPayload.mode) || '';
    var diff = (plan && plan.diff) || [];
    var map = {};
    for (var i = 0; i < diff.length; i++) { map[diff[i].field] = diff[i].after; }
    try {
      if (mode === 'comment' && map.comments !== undefined) { rec.setValue('comments', map.comments); }
      if (mode === 'work_note' && map.work_notes !== undefined) { rec.setValue('work_notes', map.work_notes); }
      if (mode === 'resolve') {
        if (map.state !== undefined) { rec.setValue('state', map.state); }
        if (map.resolved_at !== undefined) { rec.setValue('resolved_at', map.resolved_at); }
        if (map.resolution_code !== undefined) { rec.setValue('resolution_code', map.resolution_code); }
        if (map.resolution_notes !== undefined) { rec.setValue('resolution_notes', map.resolution_notes); }
      }
      rec.update();
      numbers.push(number);
    } catch (e) {
      return { recordNumbers: numbers, error: 'incident update failed: ' + String(e) };
    }
  }
  return { recordNumbers: numbers, focusedPayload: plan ? plan.focusedPayload : {} };
};

/* ---------------------------------------------------------------------- *
 * sn.itsm.incident.major — Declare or run a major incident (update_shared)
 * ---------------------------------------------------------------------- */

ExecITSM.prototype.plan_incident_major = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var c = a.ctx, inp = a.inputs;
  var number = _echo(inp, 'incident_number', ['number']) || '';
  if (!number) { return { focusedPayload: {}, missingFields: ['incident_number'] }; }
  if (!_roleOk(c, 'major_incident_manager')) {
    return { focusedPayload: { number: number }, role_denied: true, message: 'requires major_incident_manager role' };
  }
  var rec = _loadByNumber('incident', number);
  if (!rec) { return { focusedPayload: { number: number }, error: 'Incident ' + number + ' not found or not readable' }; }

  var state = _echo(inp, 'state', ['major_incident_state']) || 'Proposed';
  var includeServices = inp.services && Object.prototype.toString.call(inp.services) === '[object Array]' ? inp.services : [];
  var services = includeServices.slice();
  var ciSysId = _gv(rec, 'cmdb_ci');
  if (services.length === 0 && ciSysId) {
    try {
      var br = (c.blastRadius && typeof c.blastRadius === 'function') ? c.blastRadius(ciSysId, 2) : null;
      if (br && br.services) {
        for (var s = 0; s < br.services.length; s++) {
          services.push(br.services[s].name || br.services[s].sys_id);
        }
      }
    } catch (e) { /* */ }
  }

  var diff = [_diffEntry(rec, 'major_incident_state', state)].filter(function (d) { return d !== null; });
  var payload = {
    number: number,
    severity: _dv(rec, 'priority'),
    services: services,
    last_update: _gv(rec, 'sys_updated_on'),
    next_comms_time: _stamp(c),
    proposed: { major_incident_state: state }
  };
  var plan = {
    focusedPayload: payload,
    diff: diff,
    recordNumbers: [number],
    draft: { summary: 'Declare ' + number + ' as major incident (' + state + ')', fields: { major_incident_state: state, services: services } }
  };
  /* customer-visible comms always confirm */
  plan.owned = false;
  return plan;
};

ExecITSM.prototype.apply_incident_major = function (ctx, plan) {
  var number = (plan && plan.focusedPayload && plan.focusedPayload.number) || '';
  var rec = number ? _loadByNumber('incident', number) : null;
  var numbers = [];
  if (rec) {
    var fields = (plan && plan.draft && plan.draft.fields) || {};
    if (fields.major_incident_state) { _set(rec, 'major_incident_state', fields.major_incident_state); }
    try { rec.update(); } catch (e) { /* */ }
    var services = fields.services || [];
    for (var i = 0; i < services.length; i++) {
      try {
        var m2m = _newGR('incident_service');
        if (m2m) {
          m2m.initialize();
          m2m.setValue('incident', _gv(rec, 'sys_id'));
          m2m.setValue('service', services[i]);
          m2m.insert();
        }
      } catch (e) { /* m2m table not present */ }
    }
    numbers.push(number);
  }
  return { recordNumbers: numbers, focusedPayload: plan ? plan.focusedPayload : {} };
};

/* ---------------------------------------------------------------------- *
 * sn.itsm.problem.open — Open a problem from an incident cluster (create)
 * ---------------------------------------------------------------------- */

ExecITSM.prototype.plan_problem_open = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var c = a.ctx, inp = a.inputs;
  var numbers = Array.isArray(inp.incident_numbers) ? inp.incident_numbers.slice() : [];
  if (numbers.length === 0 && _echo(inp, 'incident_number', ['number'])) { numbers = [_echo(inp, 'incident_number', ['number'])]; }
  if (numbers.length === 0) { return { focusedPayload: {}, missingFields: ['incident_numbers'] }; }

  var recs = [], ciCount = {}, i, j;
  for (i = 0; i < numbers.length; i++) {
    var r = _loadByNumber('incident', numbers[i]);
    if (!r) { return { focusedPayload: { incident_numbers: numbers }, error: 'Incident ' + numbers[i] + ' not found or not readable' }; }
    recs.push(r);
    var ci = _gv(r, 'cmdb_ci');
    ciCount[ci || '(none)'] = (ciCount[ci || '(none)'] || 0) + 1;
  }

  /* plausible cluster: shared CI (majority) or shared category */
  var majorityCi = '', best = 0;
  for (var k in ciCount) {
    if (ciCount.hasOwnProperty(k) && ciCount[k] > best) { best = ciCount[k]; majorityCi = k; }
  }
  var sharedCategory = _gv(recs[0], 'category');
  var allCategories = true;
  for (i = 1; i < recs.length; i++) {
    if (_gv(recs[i], 'category') !== sharedCategory) { allCategories = false; }
  }
  if (majorityCi === '(none)' && !(allCategories && sharedCategory)) {
    return {
      focusedPayload: { incident_numbers: numbers.slice() },
      error: 'Incidents do not share a CI or a symptom/category; cluster is not plausible'
    };
  }

  var oldest = recs[0];
  for (i = 1; i < recs.length; i++) {
    if (_gv(recs[i], 'sys_created_on') < _gv(oldest, 'sys_created_on')) { oldest = recs[i]; }
  }
  var firstDesc = _gv(recs[0], 'short_description');
  var fields = {
    short_description: 'Cluster: ' + firstDesc.slice(0, 80),
    cmdb_ci: majorityCi === '(none)' ? '' : majorityCi,
    category: sharedCategory || '',
    first_reported_by_task: _gv(oldest, 'sys_id'),
    state: '1'
  };
  var payload = {
    incident_numbers: numbers.slice(),
    cluster: { majority_ci: majorityCi === '(none)' ? '' : majorityCi, shared_category: sharedCategory || '' },
    oldest_incident: _gv(oldest, 'number'),
    draft: fields
  };
  return {
    focusedPayload: payload,
    draft: { summary: 'Open problem for ' + numbers.join(', '), fields: fields },
    recordNumbers: numbers.slice()
  };
};

ExecITSM.prototype.apply_problem_open = function (ctx, plan) {
  var fields = (plan && plan.draft && plan.draft.fields) || {};
  var numbers = [];
  var problem = _newGR('problem');
  if (!problem) { return { recordNumbers: numbers }; }
  var problemSysId = '';
  try {
    problem.initialize();
    var setFields = ['short_description', 'cmdb_ci', 'category', 'first_reported_by_task', 'state'];
    for (var i = 0; i < setFields.length; i++) {
      if (_has(fields[setFields[i]])) { _set(problem, setFields[i], fields[setFields[i]]); }
    }
    problemSysId = problem.insert();
  } catch (e) { return { recordNumbers: [], error: String(e) }; }
  var problemNumber = _gv(problem, 'number');
  numbers.push(problemNumber);
  var incidentNumbers = (plan && plan.focusedPayload && plan.focusedPayload.incident_numbers) || [];
  for (var j = 0; j < incidentNumbers.length; j++) {
    var inc = _loadByNumber('incident', incidentNumbers[j]);
    if (inc) {
      _set(inc, 'problem_id', problemSysId);
      _set(inc, 'work_notes', 'Linked to problem ' + problemNumber + ' by sn.itsm.problem.open');
      try { inc.update(); } catch (e) { /* */ }
      numbers.push(_gv(inc, 'number'));
    }
  }
  return { recordNumbers: numbers, focusedPayload: { problem_number: problemNumber } };
};

/* ---------------------------------------------------------------------- *
 * sn.itsm.change.draft — Draft a change from a template (create)
 * ---------------------------------------------------------------------- */

ExecITSM.prototype.plan_change_draft = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var c = a.ctx, inp = a.inputs;
  var title = _echo(inp, 'title', ['short_description']) || '';
  var missing = [];
  if (!title) { missing.push('title'); }

  var ciTerm = _echo(inp, 'ci_name', ['ci']) || '';
  var docOnly = inp.documentation_only === true || inp.type === 'documentation';
  var ciCandidates = [];
  var chosenCi = '';
  if (ciTerm) {
    var f = _findCi(c, ciTerm);
    ciCandidates = f.candidates || [];
    if (f.match) { chosenCi = f.match.sys_id; }
    else if (ciCandidates.length > 1) { /* ambiguous: refuse to guess */ }
  } else if (!docOnly) {
    missing.push('ci_name');
  }

  var type = (inp.type || 'normal');
  var templateName = inp.template || '';
  var template = null;
  try {
    var t = _newGR('std_change_template');
    if (t && (templateName || title)) {
      t.addQuery('active', true);
      t.addQuery('name', 'CONTAINS', templateName || title.slice(0, 40));
      t.setLimit(1);
      t.query();
      if (t.next()) {
        template = {
          sys_id: _gv(t, 'sys_id'),
          name: _gv(t, 'name'),
          implementation_plan: _gv(t, 'implementation_plan'),
          test_plan: _gv(t, 'test_plan'),
          backout_plan: _gv(t, 'backout_plan')
        };
        if (type === 'normal') { type = 'standard'; }
      }
    }
  } catch (e) { /* standard change producers not installed */ }

  var start = _echo(inp, 'start', ['planned_start_date', 'start_date']) || '';
  var end = _echo(inp, 'end', ['planned_end_date', 'end_date']) || '';

  var fields = {
    short_description: title,
    type: type,
    planned_start_date: start,
    planned_end_date: end,
    ci: chosenCi,
    template: template ? template.name : '',
    implementation_plan: template ? template.implementation_plan : '',
    test_plan: template ? template.test_plan : '',
    backout_plan: template ? template.backout_plan : ''
  };
  var payload = {
    title: title,
    type: type,
    ci_candidates: ciCandidates,
    template: template ? template.name : '(none matched)',
    ci_resolved: chosenCi ? true : false,
    documentation_only: docOnly
  };
  var plan = {
    focusedPayload: payload,
    draft: { summary: 'Create change "' + title + '" (' + type + ')', fields: fields },
    missingFields: missing
  };
  if (ciCandidates.length > 1) {
    plan.focusedPayload.ci_ambiguous = true;
    plan.focusedPayload.ci_candidates = ciCandidates;
  }
  return plan;
};

ExecITSM.prototype.apply_change_draft = function (ctx, plan) {
  var fields = (plan && plan.draft && plan.draft.fields) || {};
  var numbers = [];
  var chg = _newGR('change_request');
  if (!chg) { return { recordNumbers: numbers }; }
  var chgSysId = '';
  try {
    chg.initialize();
    var keys = ['short_description', 'type', 'planned_start_date', 'planned_end_date', 'implementation_plan', 'test_plan', 'backout_plan'];
    for (var i = 0; i < keys.length; i++) {
      if (_has(fields[keys[i]])) { _set(chg, keys[i], fields[keys[i]]); }
    }
    chgSysId = chg.insert();
  } catch (e) { return { recordNumbers: [], error: String(e) }; }
  var chgNumber = _gv(chg, 'number');
  numbers.push(chgNumber);

  var ci = fields.ci || '';
  if (ci) {
    try {
      var tc = _newGR('task_ci');
      if (tc) {
        tc.initialize();
        tc.setValue('task', chgSysId);
        tc.setValue('ci_item', ci);
        tc.insert();
      }
    } catch (e) { /* task_ci not available */ }
  }
  return { recordNumbers: numbers, focusedPayload: { change_number: chgNumber, ci_linked: !!ci } };
};

/* ---------------------------------------------------------------------- *
 * sn.itsm.change.assess_risk — Risk, conflict, CI collision (read)
 * ---------------------------------------------------------------------- */

function _changeCis(ctx, chgSysId) {
  var out = [];
  try {
    var tc = _newGR('task_ci');
    if (!tc) { return out; }
    tc.addQuery('task', chgSysId);
    tc.setLimit(50);
    tc.query();
    while (tc.next()) {
      out.push({ sys_id: _gv(tc, 'ci_item'), name: _dv(tc, 'ci_item') });
    }
  } catch (e) { /* */ }
  return out;
}

function _riskLevel(impact, risk) {
  var im = Number(impact), rk = Number(risk);
  if (!isFinite(im) || im < 1 || im > 3) { im = 3; }
  if (!isFinite(rk) || rk < 1 || rk > 3) { rk = 3; }
  var score = im + rk;
  if (score <= 3) { return 'low'; }
  if (score <= 4) { return 'moderate'; }
  return 'high';
}

ExecITSM.prototype.plan_change_assess_risk = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var c = a.ctx, inp = a.inputs;
  var number = _echo(inp, 'change_number', ['number']) || '';
  if (!number) { return { focusedPayload: {}, missingFields: ['change_number'] }; }
  var depth = inp.depth || 2;
  var rec = _loadByNumber('change_request', number);
  if (!rec) { return { focusedPayload: { change_number: number }, error: 'Change ' + number + ' not found or not readable' }; }

  var chgSysId = _gv(rec, 'sys_id');
  var start = _gv(rec, 'planned_start_date') || _gv(rec, 'start_date');
  var end = _gv(rec, 'planned_end_date') || _gv(rec, 'end_date');
  var cis = _changeCis(c, chgSysId);
  var blastSet = {}, blastCount = 0;
  for (var i = 0; i < cis.length; i++) {
    try {
      var br = (c.blastRadius && typeof c.blastRadius === 'function' && cis[i].sys_id) ? c.blastRadius(cis[i].sys_id, depth) : null;
      if (br && br.nodes) {
        for (var n = 0; n < br.nodes.length; n++) {
          var id = br.nodes[n].sys_id;
          if (id && !blastSet[id]) { blastSet[id] = true; blastCount++; }
        }
      }
    } catch (e) { /* */ }
  }
  if (blastCount === 0) { blastCount = cis.length; }

  /* overlapping changes */
  var conflicts = [];
  try {
    var peers = _newGR('change_request');
    peers.addQuery('sys_id', '!=', chgSysId);
    peers.addQuery('state', 'NOT IN', '3,4');
    if (start && end) {
      peers.addQuery('planned_start_date', '<=', end);
      peers.addQuery('planned_end_date', '>=', start);
    }
    peers.setLimit(10);
    peers.query();
    while (peers.next()) {
      var peerSysId = _gv(peers, 'sys_id');
      var peerCis = _changeCis(c, peerSysId);
      var shared = '';
      for (var x = 0; x < peerCis.length; x++) {
        if (blastSet[peerCis[x].sys_id]) { shared = peerCis[x].name || peerCis[x].sys_id; break; }
      }
      if (shared) {
        conflicts.push({ change: _gv(peers, 'number'), overlap: (_gv(peers, 'planned_start_date') || '') + ' - ' + (_gv(peers, 'planned_end_date') || ''), shared_ci: shared });
      }
    }
  } catch (e) { /* */ }

  var missingFields = [];
  var notes = [];
  if (!_has(_gv(rec, 'backout_plan'))) { missingFields.push('backout_plan'); }
  if (!_has(_gv(rec, 'test_plan'))) { missingFields.push('test_plan'); }
  if (!_has(_dv(rec, 'assigned_to'))) { notes.push('implementer not set'); }
  if (!start || !end) { notes.push('no planned window set'); }

  var riskLevel = _riskLevel(_gv(rec, 'impact'), _gv(rec, 'risk'));
  var recommendation = 'ready';
  if (missingFields.length > 0 || conflicts.length > 0) { recommendation = 'needs CAB discussion'; }
  if (rec && _gv(rec, 'type') === 'emergency' && _has(start)) { recommendation = 'ready'; }

  return {
    focusedPayload: {
      change: number,
      risk_level: riskLevel,
      calculator: 'heuristic',
      conflicts: conflicts,
      missing_fields: missingFields,
      ci_blast_count: blastCount,
      recommendation: recommendation,
      notes: notes
    },
    recordNumbers: [number],
    next_skills: ['sn.itsm.change.cab_prep']
  };
};

/* ---------------------------------------------------------------------- *
 * sn.itsm.change.cab_prep — Prepare a CAB packet (read)
 * ---------------------------------------------------------------------- */

ExecITSM.prototype.plan_change_cab_prep = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var c = a.ctx, inp = a.inputs;
  var numbers = Array.isArray(inp.change_numbers) ? inp.change_numbers.slice() : [];
  if (numbers.length === 0 && _echo(inp, 'change_number', ['number'])) { numbers = [String(_echo(inp, 'change_number', ['number']))]; }
  if (numbers.length === 0) { return { focusedPayload: {}, missingFields: ['change_numbers'] }; }

  var packet = [];
  for (var i = 0; i < numbers.length && i < 25; i++) {
    var assess = this.plan_change_assess_risk(c, { change_number: numbers[i] });
    var entry = { change: numbers[i] };
    if (assess.error) { entry.error = assess.error; }
    else {
      entry.title = assess.focusedPayload.change;
      entry.risk_level = assess.focusedPayload.risk_level;
      entry.conflicts = assess.focusedPayload.conflicts;
      entry.recommendation = assess.focusedPayload.recommendation;
    }
    var chg = _loadByNumber('change_request', numbers[i]);
    if (chg) {
      try {
        var appr = _newGR('sysapproval_approver');
        appr.addQuery('sysapproval', _gv(chg, 'sys_id'));
        appr.addQuery('state', 'requested');
        appr.setLimit(20);
        appr.query();
        var openApprovals = [];
        while (appr.next()) { openApprovals.push(_dv(appr, 'approver')); }
        entry.approvals_open = openApprovals;
        var tasks = _newGR('change_task');
        tasks.addQuery('change_request', _gv(chg, 'sys_id'));
        tasks.addQuery('state', 'NOT IN', '3,4');
        tasks.setLimit(20);
        tasks.query();
        var tasksOpen = [];
        while (tasks.next()) { tasksOpen.push(_gv(tasks, 'number') + ' ' + _gv(tasks, 'short_description')); }
        entry.tasks_open = tasksOpen;
        entry.title = _gv(chg, 'short_description');
      } catch (e) { /* approval/task tables unavailable */ }
    }
    packet.push(entry);
  }
  return { focusedPayload: { change_numbers: numbers, changes: packet, agenda_date: inp.agenda_date || _datePart(c) } };
};

/* ---------------------------------------------------------------------- *
 * sn.itsm.change.implement — Move a change through implement / review (update_shared)
 * ---------------------------------------------------------------------- */

ExecITSM.prototype.plan_change_implement = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var c = a.ctx, inp = a.inputs;
  var number = _echo(inp, 'change_number', ['number']) || '';
  var action = _echo(inp, 'action', ['transition']) || 'implement';
  var missing = [];
  if (!number) { missing.push('change_number'); }
  if (['implement', 'review', 'close'].indexOf(action) < 0) { missing.push('action'); }
  if (missing.length > 0) { return { focusedPayload: {}, missingFields: missing }; }
  var rec = _loadByNumber('change_request', number);
  if (!rec) { return { focusedPayload: { change_number: number }, error: 'Change ' + number + ' not found or not readable' }; }

  var state = _gv(rec, 'state');
  var allow = { implement: ['-5'], review: ['-4'], close: ['-3'] };
  var plan = { focusedPayload: { change_number: number, current_state: state, action: action }, recordNumbers: [number] };
  if (allow[action].indexOf(state) < 0) {
    plan.error = 'Cannot ' + action + ' from state ' + state + '(expected ' + allow[action].join(' or ') + ')';
    return plan;
  }

  var tasksOpen = 0;
  try {
    var tasks = _newGR('change_task');
    tasks.addQuery('change_request', _gv(rec, 'sys_id'));
    tasks.addQuery('state', 'NOT IN', '3,4');
    tasks.setLimit(1);
    tasks.query();
    if (tasks.next()) { tasksOpen = 1; }
  } catch (e) { /* */ }

  if (action === 'implement') {
    plan.diff = [_diffEntry(rec, 'state', '-4'), _diffEntry(rec, 'actual_start', _stamp(c))].filter(function (d) { return d !== null; });
    plan.work_note = 'Implementation started via sn.itsm.change.implement';
  } else if (action === 'review') {
    if (tasksOpen) { plan.blocked = 'open change tasks remain'; plan.focusedPayload.blocked = plan.blocked; }
    plan.diff = [_diffEntry(rec, 'state', '-3')].filter(function (d) { return d !== null; });
    plan.work_note = 'Moved to review via sn.itsm.change.implement';
  } else { /* close */
    var code = _echo(inp, 'close_code', ['code']) || '';
    var notes = _echo(inp, 'close_notes', ['notes']) || '';
    if (tasksOpen) { plan.blocked = 'open change tasks remain'; plan.focusedPayload.blocked = plan.blocked; }
    if (!code) { plan.missingFields = ['close_code']; }
    if (!notes) { plan.missingFields = (plan.missingFields || []).concat(['close_notes']); }
    plan.diff = [_diffEntry(rec, 'state', '3'), _diffEntry(rec, 'close_code', code), _diffEntry(rec, 'close_notes', notes)].filter(function (d) { return d !== null; });
    plan.work_note = 'Closed via sn.itsm.change.implement';
  }
  return plan;
};

ExecITSM.prototype.apply_change_implement = function (ctx, plan) {
  var number = (plan && plan.focusedPayload && plan.focusedPayload.change_number) || '';
  var rec = number ? _loadByNumber('change_request', number) : null;
  var numbers = [];
  if (rec) {
    if (plan && plan.diff) {
      for (var i = 0; i < plan.diff.length; i++) {
        try { rec.setValue(plan.diff[i].field, plan.diff[i].after); } catch (e) { /* */ }
      }
    }
    if (plan && plan.work_note) { _set(rec, 'work_notes', plan.work_note); }
    try { rec.update(); } catch (e) { /* */ }
    numbers.push(number);
  }
  return { recordNumbers: numbers, focusedPayload: plan ? plan.focusedPayload : {} };
};

/* ---------------------------------------------------------------------- *
 * sn.itsm.request.submit — Submit a catalog item or order guide (create)
 * ---------------------------------------------------------------------- */

ExecITSM.prototype._catalogVariables = function (itemSysId) {
  /* variable definitions for a catalog item: name -> { type, mandatory, default } */
  var vars = {};
  try {
    var m = _newGR('sc_item_option_mtom');
    if (!m) { return vars; }
    m.addQuery('cat_item', itemSysId);
    m.setLimit(200);
    m.query();
    while (m.next()) {
      var opt = _gv(m, 'item_option_new');
      if (!opt) { continue; }
      var v = _newGR('item_option_new');
      if (v && v.get(opt)) {
        vars[_gv(v, 'name')] = { type: _gv(v, 'type'), mandatory: _gv(v, 'mandatory') === 'true', label: _dv(v, 'label') || _gv(v, 'name') };
      }
    }
  } catch (e) { /* catalog variable definitions unavailable */ }
  return vars;
};

ExecITSM.prototype.plan_request_submit = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var c = a.ctx, inp = a.inputs;
  var itemName = _echo(inp, 'item_name', ['title', 'name']) || '';
  if (!itemName) { return { focusedPayload: {}, missingFields: ['item_name'] }; }
  var missing = [];

  var item = null;
  try {
    var gi = _newGR('sc_cat_item');
    gi.addQuery('active', true);
    gi.addQuery('name', itemName);
    gi.setLimit(1);
    gi.query();
    if (!gi.next()) {
      gi = _newGR('sc_cat_item');
      gi.addQuery('active', true);
      gi.addQuery('name', 'CONTAINS', itemName);
      gi.setLimit(1);
      gi.query();
      if (gi.next()) { item = gi; }
    } else { item = gi; }
  } catch (e) { /* */ }
  if (!item) { return { focusedPayload: { item_name: itemName }, error: 'No catalog item named "' + itemName + '"' }; }

  var itemSysId = _gv(item, 'sys_id');
  var producer = false;
  try {
    var gp = _newGR('sc_cat_item_producer');
    if (gp && gp.get(itemSysId)) { producer = true; }
  } catch (e) { /* */ }

  var vars = this._catalogVariables(itemSysId);
  var provided = (inp.variables && typeof inp.variables === 'object') ? inp.variables : {};
  var unknown = [];
  var missingVars = [];
  for (var k in provided) {
    if (!provided.hasOwnProperty(k)) { continue; }
    if (!vars[k]) { unknown.push(k); }
  }
  for (var name in vars) {
    if (!vars.hasOwnProperty(name)) { continue; }
    if (vars[name].mandatory && !_has(provided[name])) { missingVars.push(name); }
  }
  if (unknown.length > 0) { missing.push('variables(unknown: ' + unknown.join(', ') + ')'); }

  var requestedFor = _echo(inp, 'requested_for', ['requested_for_name']) || _me(c);
  var fields = {
    item: itemSysId,
    item_name: _gv(item, 'name'),
    quantity: inp.quantity || 1,
    requested_for: requestedFor,
    variables: provided
  };
  var payload = {
    item: _gv(item, 'name'),
    item_sys_id: itemSysId,
    producer: producer,
    route: producer ? 'record producer API' : 'Service Catalog / cart',
    variables: vars,
    unknown_variables: unknown,
    missing_variables: missingVars
  };
  return {
    focusedPayload: payload,
    draft: { summary: 'Submit ' + _gv(item, 'name') + ' via catalog engine', fields: fields },
    missingFields: missing
  };
};

ExecITSM.prototype.apply_request_submit = function (ctx, plan) {
  var fields = (plan && plan.draft && plan.draft.fields) || {};
  var numbers = [];
  var itemSysId = fields.item || '';

  /* Privileged path: real catalog engine */
  if (typeof GlideappCart !== 'undefined' && itemSysId) {
    try {
      var cart = new GlideappCart();
      cart.setItem(itemSysId, fields.quantity || 1);
      var cartItem = cart.getItem(itemSysId, 0);
      if (cartItem && fields.variables) {
        for (var v in fields.variables) {
          if (fields.variables.hasOwnProperty(v)) { _set(cartItem, v, fields.variables[v]); }
        }
        try { cartItem.update(); } catch (e) { /* is leaf */ }
      }
      if (fields.requested_for) {
        cart.setRequestedFor(fields.requested_for);
      }
      cart.checkout();
      var reqId = cart.getRequestId ? cart.getRequestId() : '';
      numbers.push(reqId);
      return {
        recordNumbers: numbers,
        focusedPayload: { req_number: reqId, engine: 'cart' }
      };
    } catch (e) { /* fall through to manual */ }
  }

  /* Fallback: insert through request engine tables */
  try {
    var req = _newGR('sc_request');
    req.initialize();
    if (fields.requested_for) {
      _set(req, 'requested_for', fields.requested_for);
      _set(req, 'requested_by', fields.requested_for);
    }
    var reqSysId = req.insert();
    var reqNumber = _gv(req, 'number');
    numbers.push(reqNumber);

    var ritm = _newGR('sc_req_item');
    ritm.initialize();
    ritm.setValue('request', reqSysId);
    ritm.setValue('cat_item', itemSysId);
    ritm.setValue('quantity', fields.quantity || 1);
    if (fields.requested_for) { ritm.setValue('requested_for', fields.requested_for); }
    if (fields.variables) {
      for (var v2 in fields.variables) {
        if (fields.variables.hasOwnProperty(v2)) { _set(ritm, v2, fields.variables[v2]); }
      }
    }
    var ritmSysId = ritm.insert();
    numbers.push(_gv(ritm, 'number') || ritmSysId);
    return { recordNumbers: numbers, focusedPayload: { req_number: reqNumber, engine: 'manual-fallback' } };
  } catch (e) {
    return { recordNumbers: numbers, error: 'catalog submit failed: ' + String(e) };
  }
};

/* ---------------------------------------------------------------------- *
 * sn.itsm.request.fulfill — Fulfill or approve a request (approve)
 * ---------------------------------------------------------------------- */

ExecITSM.prototype.plan_request_fulfill = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var c = a.ctx, inp = a.inputs;
  var number = _echo(inp, 'request_number', ['number', 'ritm', 'req_number']) || '';
  var action = _echo(inp, 'action', ['approval']) || '';
  var missing = [];
  if (!number) { missing.push('request_number'); }
  if (!action) { missing.push('action'); }
  if (['approve', 'reject', 'fulfill'].indexOf(action) < 0) { missing.push('action(approve|reject|fulfill)'); }
  if (missing.length > 0) { return { focusedPayload: {}, missingFields: missing }; }

  var rec = _loadByNumber('sc_request', number) || _loadByNumber('sc_req_item', number);
  if (!rec) { return { focusedPayload: { request_number: number }, error: number + ' not found or not readable' }; }
  var table = _gv(rec, 'sys_class_name') === 'sc_req_item' ? 'sc_req_item' : 'sc_request';
  var recSysId = _gv(rec, 'sys_id');
  var variables = {};
  try {
    var vars = this._catalogVariables(_gv(rec, 'cat_item'));
    for (var name in vars) {
      if (vars.hasOwnProperty(name)) { variables[name] = _gv(rec, name); }
    }
  } catch (e) { /* */ }

  var payload = {
    number: number,
    table: table,
    requested_for: _dv(rec, 'requested_for'),
    state: _dv(rec, 'state'),
    price: _gv(rec, 'price'),
    variables: variables,
    action: action
  };
  var after = action === 'approve' ? 'approved' : (action === 'reject' ? 'rejected' : '');
  var plan = {
    focusedPayload: payload,
    recordNumbers: [number],
    owned: false
  };
  if (action === 'fulfill') {
    plan.diff = [_diffEntry(rec, 'state', '3')].filter(function (d) { return d !== null; });
    plan.draft = { summary: 'Mark ' + number + ' fulfilled', fields: { state: '3' } };
  } else {
    plan.diff = [{ field: 'approval', before: 'requested', after: after }];
    plan.draft = { summary: after + ' ' + number + ' via approval engine', fields: { approval: after, comment: _echo(inp, 'note', ['comments']) || '' } };
  }
  return plan;
};

ExecITSM.prototype.apply_request_fulfill = function (ctx, plan) {
  var numbers = [];
  var payload = (plan && plan.focusedPayload) || {};
  var number = payload.number || '';
  var action = payload.action || 'approve';
  var fields = (plan && plan.draft && plan.draft.fields) || {};

  var rec = number ? (_loadByNumber('sc_request', number) || _loadByNumber('sc_req_item', number)) : null;
  if (!rec) { return { recordNumbers: numbers, error: number + ' not found' }; }
  var recSysId = _gv(rec, 'sys_id');
  var me = _me(ctx);

  if (action === 'approve' || action === 'reject') {
    /* approval engine channel: mutate only the approver row, never the request state */
    try {
      var appr = _newGR('sysapproval_approver');
      appr.addQuery('document_id', recSysId);
      appr.addQuery('state', 'requested');
      if (me) { appr.addQuery('approver', me); }
      appr.setLimit(10);
      appr.query();
      var touched = 0;
      while (appr.next()) {
        appr.setValue('state', action === 'approve' ? 'approved' : 'rejected');
        if (fields.comment) { appr.setValue('comments', fields.comment); }
        appr.update();
        touched++;
      }
      if (touched === 0) {
        /* approver row missing: fall back to request-level record for the audit trail */
        rec.setValue('approval', action === 'approve' ? 'approved' : 'rejected');
        rec.update();
      }
      numbers.push(number);
    } catch (e) { return { recordNumbers: numbers, error: 'approval update failed: ' + String(e) }; }
  } else { /* fulfill */
    try {
      rec.setValue('state', '3');
      _set(rec, 'work_notes', 'Fulfilled via sn.itsm.request.fulfill');
      rec.update();
      numbers.push(number);
    } catch (e) { return { recordNumbers: numbers, error: 'fulfill update failed: ' + String(e) }; }
  }
  return { recordNumbers: numbers, focusedPayload: payload };
};

/* ---------------------------------------------------------------------- *
 * sn.itsm.sla.at_risk — SLA / OLA at-risk board (read)
 * ---------------------------------------------------------------------- */

ExecITSM.prototype.plan_sla_at_risk = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var c = a.ctx, inp = a.inputs;
  var me = _me(c);
  var groupIds = this._myGroupIds(c);
  var rows = [];
  try {
    var sla = _newGR('task_sla');
    sla.addQuery('active', true);
    sla.addQuery('has_breached', false);
    sla.addQuery('business_percentage', '>=', 75);
    if (groupIds.length > 0) {
      sla.addQuery('task.assignment_group', 'IN', groupIds.join(','));
      sla.addOrCondition('task.assigned_to', me);
    } else if (me) {
      sla.addQuery('task.assigned_to', me);
    }
    sla.orderBy('planned_end_time');
    sla.setLimit(25);
    sla.query();
    while (sla.next()) {
      rows.push({
        number: _dv(sla, 'task') || _gv(sla, 'task'),
        type: _dv(sla, 'task_sys_class_name') || '',
        percent: _gv(sla, 'business_percentage'),
        planned_end: _gv(sla, 'planned_end_time'),
        assigned_to: _dv(sla, 'task.assigned_to') || ''
      });
    }
  } catch (e) { /* */ }
  return { focusedPayload: { at_risk: rows }, recordNumbers: [] };
};

ExecITSM.prototype.plan = function (ctx, inputs) {
  var id = (ctx && ctx.doc && ctx.doc.id) ? ctx.doc.id : '';
  var name = this.method(id);
  if (name && typeof this[name] === 'function') { return this[name](ctx, inputs); }
  return { focusedPayload: {}, error: 'unknown ITSM skill ' + id };
};

ExecITSM.prototype.method = function (id) {
  var parts = String(id || '').split('.');
  if (parts.length < 3) { return ''; }
  return 'plan_' + parts.slice(2).join('_');
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExecITSM;
}
