/**
 * ExecITOM — skill executables for the ITOM domain (§6.3 cards).
 * ES5 only (ServiceNow scoped app): var/function, no arrows, no template literals.
 *
 * Planner methods return { error?, focusedPayload, diff?, draft?, missingFields?,
 * recordNumbers?, owned? } and never mutate. Appliers receive (ctx, plan) and
 * return { recordNumbers } after performing writes through GlideRecordSecure.
 */
var ExecITOM = function () {
  this.VERSION = '1.0.0';
  this.DOMAIN = 'itom';
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
  } catch (e) { /* fall through */ }
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
        support_group: _dv(gr, 'support_group')
      });
    }
    if (out.candidates.length === 1) { out.match = out.candidates[0]; }
    if (out.candidates.length > 1) { out.ambiguous = true; }
  } catch (e) { /* */ }
  return out;
}

function _alertRow(rec) {
  return {
    sys_id: _gv(rec, 'sys_id'),
    number: _gv(rec, 'number') || _gv(rec, 'name'),
    message_key: _gv(rec, 'message_key'),
    severity: _dv(rec, 'severity') || _gv(rec, 'severity'),
    ci: _dv(rec, 'ci') || _gv(rec, 'ci'),
    metric: _gv(rec, 'metric_name') || _gv(rec, 'metric'),
    short_description: _gv(rec, 'short_description')
  };
}

/* ---------------------------------------------------------------------- *
 * sn.itom.alert.triage — Alert to service impact (read)
 * ---------------------------------------------------------------------- */

ExecITOM.prototype.plan_alert_triage = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var c = a.ctx, inp = a.inputs;
  var alert = _echo(inp, 'alert_number', ['number', 'sys_id']) || '';
  if (!alert) { return { focusedPayload: {}, missingFields: ['alert_number'] }; }

  var rec = _loadByNumber('em_alert', alert);
  if (!rec) {
    var byId = _newGR('em_alert');
    if (byId && byId.get(alert)) { rec = byId; }
  }
  if (!rec) { return { focusedPayload: { alert_number: alert }, error: 'Alert ' + alert + ' not found or not readable' }; }

  var ciSysId = _gv(rec, 'ci');
  var ciName = _dv(rec, 'ci');
  var serviceImpact = { service: '', affected: [] };
  var affected = 0;
  if (ciSysId) {
    try {
      var br = (c.blastRadius && typeof c.blastRadius === 'function') ? c.blastRadius(ciSysId, 2) : null;
      if (br && br.nodes) {
        affected = br.nodes.length;
        serviceImpact.affected = _cap(br.nodes.map(function (n) { return n.name || n.sys_id; }), 10);
      }
      if (br && br.services && br.services.length > 0) {
        serviceImpact.service = br.services[0].name || br.services[0].sys_id;
      }
    } catch (e) { /* no blast radius available */ }
  }

  var openIncidents = [];
  try {
    var inc = _newGR('incident');
    inc.addQuery('active', true);
    if (ciSysId) { inc.addQuery('cmdb_ci', ciSysId); }
    else { inc.addQuery('short_description', 'CONTAINS', ciName); }
    inc.orderByDesc('sys_created_on');
    inc.setLimit(5);
    inc.query();
    while (inc.next()) {
      openIncidents.push({ number: _gv(inc, 'number'), short_description: _gv(inc, 'short_description'), state: _dv(inc, 'state') });
    }
  } catch (e) { /* */ }

  var recommendation = 'acknowledge';
  var next = ['sn.itom.alert.correlate'];
  if (openIncidents.length > 0) {
    recommendation = 'correlate into existing incident ' + openIncidents[0].number;
    next = ['sn.itom.alert.correlate', 'sn.itsm.incident.update'];
  } else {
    recommendation = 'open new incident via sn.itsm.incident.triage';
    next = ['sn.itsm.incident.triage'];
  }

  return {
    focusedPayload: {
      alert: _alertRow(rec),
      service_impact: serviceImpact,
      impact_node_count: affected,
      open_incidents: openIncidents,
      recommendation: recommendation,
      side_effects: ['acknowledge is a write; correlation is update_shared']
    },
    recordNumbers: [_gv(rec, 'number') || _gv(rec, 'sys_id')],
    next_skills: next
  };
};

/* ---------------------------------------------------------------------- *
 * sn.itom.alert.correlate — Correlate alerts to incident / CI (update_shared)
 * ---------------------------------------------------------------------- */

ExecITOM.prototype.plan_alert_correlate = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var c = a.ctx, inp = a.inputs;
  var alert = _echo(inp, 'alert_number', ['number', 'sys_id']) || '';
  if (!alert) { return { focusedPayload: {}, missingFields: ['alert_number'] }; }

  var rec = _loadByNumber('em_alert', alert);
  if (!rec) { return { focusedPayload: { alert_number: alert }, error: 'Alert ' + alert + ' not found or not readable' }; }
  var ciTerm = _echo(inp, 'ci', ['ci_name', 'ci']) || _dv(rec, 'ci') || _gv(rec, 'ci');
  var f = _findCi(c, ciTerm);
  if (!f.match && f.candidates.length > 1) {
    return {
      focusedPayload: { alert: _alertRow(rec), ci_candidates: f.candidates, ci_ambiguous: true },
      message: 'CI ambiguous: refusing to guess'
    };
  }
  var ciSysId = f.match ? f.match.sys_id : (_gv(rec, 'ci') || '');
  var ciName = f.match ? f.match.name : ciTerm;

  var existing = null;
  try {
    var inc = _newGR('incident');
    inc.addQuery('active', true);
    inc.addQuery('cmdb_ci', ciSysId);
    inc.setLimit(1);
    inc.query();
    if (inc.next()) { existing = inc; }
  } catch (e) { /* */ }

  var alertRow = _alertRow(rec);
  if (existing) {
    var incNumber = _gv(existing, 'number');
    var diff = [{ field: 'incident', before: _gv(rec, 'incident') || null, after: _gv(existing, 'sys_id') }];
    if (!_gv(rec, 'incident')) {
      return {
        focusedPayload: { alert: alertRow, correlate_to: incNumber, ci: ciName, created_new: false },
        diff: diff,
        draft: { summary: 'Correlate ' + alert + ' to ' + incNumber, fields: { incident: _gv(existing, 'sys_id') } },
        recordNumbers: [incNumber],
        owned: false
      };
    }
    return {
      focusedPayload: { alert: alertRow, correlate_to: incNumber, ci: ciName, already_correlated: true, created_new: false },
      recordNumbers: [incNumber]
    };
  }

  /* No existing incident: propose a new one via the triage skill (create after confirm) */
  var fields = {
    short_description: 'Alert ' + alert + ' — ' + (ciName || 'unknown CI'),
    cmdb_ci: ciSysId || '',
    category: 'inquiry',
    impact: '3',
    urgency: '3'
  };
  return {
    focusedPayload: { alert: alertRow, ci: ciName, created_new: true, draft: fields },
    draft: { summary: 'Open incident for alert ' + alert + ' (' + (ciName || 'no CI') + ')', fields: fields },
    recordNumbers: [_gv(rec, 'number') || alert],
    owned: false
  };
};

ExecITOM.prototype.apply_alert_correlate = function (ctx, plan) {
  var numbers = [];
  var c = ctx || {};
  var payload = (plan && plan.focusedPayload) || {};
  var alertNumber = payload && payload.alert ? (payload.alert.number || '') : '';

  if (payload.created_new) {
    /* open the new incident */
    try {
      var inc = _newGR('incident');
      inc.initialize();
      var fields = payload.draft || {};
      _set(inc, 'short_description', fields.short_description);
      _set(inc, 'cmdb_ci', fields.cmdb_ci);
      _set(inc, 'category', fields.category);
      _set(inc, 'impact', fields.impact);
      _set(inc, 'urgency', fields.urgency);
      _set(inc, 'state', '1');
      var incSysId = inc.insert();
      var incNumber = _gv(inc, 'number') || incSysId;
      numbers.push(incNumber);
      /* bind the alert */
      var alert = alertNumber ? _loadByNumber('em_alert', alertNumber) : null;
      if (alert) {
        _set(alert, 'incident', incSysId);
        try { alert.update(); } catch (e) { /* */ }
        numbers.push(alertNumber);
      }
      return { recordNumbers: numbers, focusedPayload: { incident_number: incNumber } };
    } catch (e) {
      return { recordNumbers: numbers, error: 'incident create failed: ' + String(e) };
    }
  }

  /* correlate to the existing incident */
  var alert = alertNumber ? _loadByNumber('em_alert', alertNumber) : null;
  if (alert) {
    var incId = (plan && plan.diff && plan.diff[0] && plan.diff[0].after) || '';
    if (!incId && plan && plan.draft && plan.draft.fields) { incId = plan.draft.fields.incident || ''; }
    if (incId) {
      _set(alert, 'incident', incId);
      try { alert.update(); } catch (e) { /* */ }
      numbers.push(alertNumber);
    }
  }
  return { recordNumbers: numbers, focusedPayload: payload };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExecITOM;
}
