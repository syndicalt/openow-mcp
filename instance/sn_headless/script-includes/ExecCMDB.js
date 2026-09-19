/**
 * ExecCMDB — skill executables for the CMDB domain (§6.3 cards).
 * ES5 only (ServiceNow scoped app): var/function, no arrows, no template literals.
 *
 * All three skills are read-only. Planners return { error?, focusedPayload,
 * missingFields?, recordNumbers? } and never mutate. This file is the
 * anti-duplicate primitive: ambiguity is surfaced, never guessed.
 */
var ExecCMDB = function () {
  this.VERSION = '1.0.0';
  this.DOMAIN = 'cmdb';
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

function _cap(arr, n) {
  if (!arr) { return []; }
  return arr.slice(0, n || 25);
}

function _ciHeaderCoin(rec) {
  return {
    sys_id: _gv(rec, 'sys_id'),
    name: _gv(rec, 'name'),
    'class': _gv(rec, 'sys_class_name'),
    operational_status: _dv(rec, 'operational_status'),
    install_status: _dv(rec, 'install_status'),
    support_group: _dv(rec, 'support_group') || _gv(rec, 'support_group'),
    managed_by_group: _dv(rec, 'managed_by_group') || _gv(rec, 'managed_by_group'),
    last_discovered: _gv(rec, 'last_discovered'),
    duplicate_of: _gv(rec, 'duplicate_of')
  };
}

function _findCiDirect(term, classFilter) {
  /* Direct fallback when ctx.findCi is absent: exact then contains, class-filtered */
  var out = { match: null, candidates: [], ambiguous: false };
  if (!term) { return out; }
  var conditions = [['name', term], ['host_name', term], ['serial_number', term], ['asset_tag', term], ['ip_address', term], ['sys_id', term]];
  var i, j;
  var results = [];
  for (i = 0; i < conditions.length && results.length === 0; i++) {
    var gr = _newGR('cmdb_ci');
    if (!gr) { return out; }
    try {
      gr.addQuery(conditions[i][0], conditions[i][1]);
      if (classFilter) {
        var parts = String(classFilter).split(',');
        if (parts.length === 1) { gr.addQuery('sys_class_name', parts[0]); }
        else { gr.addQuery('sys_class_name', 'IN', parts.join(',')); }
      }
      gr.setLimit(9);
      gr.query();
      while (gr.next()) { results.push(_ciHeaderCoin(gr)); }
    } catch (e) { /* */ }
  }
  if (results.length === 0) {
    var g2 = _newGR('cmdb_ci');
    if (g2) {
      try {
        g2.addQuery('name', 'CONTAINS', term);
        if (classFilter) {
          var p2 = String(classFilter).split(',');
          if (p2.length === 1) { g2.addQuery('sys_class_name', p2[0]); }
          else { g2.addQuery('sys_class_name', 'IN', p2.join(',')); }
        }
        g2.setLimit(9);
        g2.query();
        while (g2.next()) { results.push(_ciHeaderCoin(g2)); }
      } catch (e) { /* */ }
    }
  }
  if (results.length === 1) { out.match = results[0]; }
  if (results.length > 1) { out.ambiguous = true; }
  out.candidates = results;
  return out;
}

function _resolveCi(ctx, term, classFilter) {
  var r = null;
  try {
    if (ctx && ctx.findCi && typeof ctx.findCi === 'function') {
      r = ctx.findCi(term, classFilter);
    }
  } catch (e) { r = null; }
  if (!r || (r.candidates && r.candidates.length === 0 && !r.match)) {
    r = _findCiDirect(term, classFilter);
  }
  if (!r) { r = { match: null, candidates: [], ambiguous: false }; }
  if (r.match && (!r.candidates || r.candidates.length === 0)) { r.candidates = [r.match]; }
  if (r.candidates && r.candidates.length === 1 && !r.match) { r.match = r.candidates[0]; r.ambiguous = false; }
  return r;
}

/* ---------------------------------------------------------------------- *
 * sn.cmdb.ci.find — Find a CI with identification context (read)
 * ---------------------------------------------------------------------- */

ExecCMDB.prototype.plan_ci_find = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var c = a.ctx, inp = a.inputs;
  var term = _echo(inp, 'term', ['name', 'fqdn', 'serial_number', 'asset_tag', 'ip_address', 'sys_id', 'query']) || '';
  if (!term) { return { focusedPayload: {}, missingFields: ['term or ci'] }; }
  var classFilter = _echo(inp, 'class', ['class_filter', 'sys_class_name']) || '';

  var r = _resolveCi(c, term, classFilter);
  var payload = {
    input: term,
    class_filter: classFilter,
    match: r.match,
    candidates: _cap(r.candidates || [], 8),
    ambiguous: !!(r.ambiguous || (r.candidates && r.candidates.length > 1))
  };
  if (payload.ambiguous) {
    payload.message = 'multiple candidates; downstream write skills must not pick silently';
  }
  return {
    focusedPayload: payload,
    recordNumbers: r.match ? [r.match.sys_id] : []
  };
};

/* ---------------------------------------------------------------------- *
 * sn.cmdb.ci.blast_radius — Relationship walk / blast radius (read)
 * ---------------------------------------------------------------------- */

ExecCMDB.prototype._walkRelations = function (startSysId, depth) {
  /* Local BFS fallback when ctx.blastRadius is absent. */
  var nodes = [];
  var seen = {};
  var queue = [{ sys_id: startSysId, depth: 0 }];
  var i;
  while (queue.length > 0 && nodes.length < 50) {
    var cur = queue.shift();
    if (seen[cur.sys_id]) { continue; }
    seen[cur.sys_id] = true;
    var gr = _newGR('cmdb_ci');
    if (!gr || !gr.get(cur.sys_id)) { continue; }
    var label = _gv(gr, 'name');
    var cls = _gv(gr, 'sys_class_name');
    var lastDisc = _gv(gr, 'last_discovered');
    var stale = lastDisc !== '' && _stamp(ctx).slice(0, 10) > lastDisc.slice(0, 10);
    nodes.push({ sys_id: cur.sys_id, name: label, 'class': cls, depth: cur.depth, stale: stale, type: '' });
    if (cur.depth >= depth) { continue; }
    var rel = _newGR('cmdb_rel_ci');
    rel.addQuery('parent', cur.sys_id);
    rel.setLimit(100);
    rel.query();
    while (rel.next()) {
      var child = _gv(rel, 'child');
      if (child && child !== cur.sys_id) { queue.push({ sys_id: child, depth: cur.depth + 1 }); }
    }
    var rel2 = _newGR('cmdb_rel_ci');
    rel2.addQuery('child', cur.sys_id);
    rel2.setLimit(100);
    rel2.query();
    while (rel2.next()) {
      var parent = _gv(rel2, 'parent');
      if (parent && parent !== cur.sys_id) { queue.push({ sys_id: parent, depth: cur.depth + 1 }); }
    }
  }
  return nodes;
};

ExecCMDB.prototype.plan_ci_blast_radius = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var c = a.ctx, inp = a.inputs;
  var term = _echo(inp, 'ci', ['ci_name', 'name', 'sys_id']) || '';
  if (!term) { return { focusedPayload: {}, missingFields: ['ci'] }; }
  var depth = Number(inp.depth || 2);
  if (!isFinite(depth)) { depth = 2; }
  if (depth < 1) { depth = 1; }
  if (depth > 3) { depth = 3; }

  var r = _resolveCi(c, term, '');
  if (r.candidates && r.candidates.length > 1 && !r.match) {
    return {
      focusedPayload: { ci: term, ci_candidates: r.candidates, ci_ambiguous: true },
      message: 'CI ambiguous: refusing to guess'
    };
  }
  var root = r.match || (r.candidates && r.candidates[0]) || null;
  if (!root) { return { focusedPayload: { ci: term }, error: 'CI "' + term + '" not found' }; }
  var rootSysId = root.sys_id;

  var nodes = [];
  var services = [];
  var summary = '';
  try {
    if (c.blastRadius && typeof c.blastRadius === 'function') {
      var br = c.blastRadius(rootSysId, depth);
      nodes = (br && br.nodes) ? br.nodes.slice() : [];
      services = (br && br.services) ? (br.services || []).slice() : [];
      summary = (br && br.summary) ? br.summary : '';
    }
  } catch (e) { nodes = []; }
  if (nodes.length === 0) {
    nodes = this._walkRelations(rootSysId, depth);
    summary = nodes.length + ' CI node(s) reached within depth cap.';
  }

  var byClass = {};
  var i;
  for (i = 0; i < nodes.length; i++) {
    var cls = nodes[i]['class'] || 'unknown';
    byClass[cls] = (byClass[cls] || 0) + 1;
  }
  var stale = [];
  for (i = 0; i < nodes.length; i++) {
    if (nodes[i].stale) { stale.push(nodes[i].name || nodes[i].sys_id); }
  }

  var payload = {
    root: { sys_id: rootSysId, name: root.name || term, 'class': root['class'] || '' },
    depth: depth,
    node_count: nodes.length,
    nodes: _cap(nodes, 50),
    services: _cap(services, 20),
    by_class: byClass,
    stale_relations: stale,
    capped: nodes.length >= 50,
    summary: summary || nodes.length + ' CI node(s) reached within depth cap.'
  };
  return { focusedPayload: payload, recordNumbers: [rootSysId] };
};

/* ---------------------------------------------------------------------- *
 * sn.cmdb.service.health — Application service health snapshot (read)
 * ---------------------------------------------------------------------- */

var SERVICE_CLASSES = ['cmdb_ci_service', 'cmdb_ci_appl', 'cmdb_ci_service_offering'];

ExecCMDB.prototype.plan_service_health = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var c = a.ctx, inp = a.inputs;
  var term = _echo(inp, 'service', ['service_name', 'name', 'sys_id']) || '';
  if (!term) { return { focusedPayload: {}, missingFields: ['service'] }; }

  var r = _resolveCi(c, term, SERVICE_CLASSES.join(','));
  if (!r.match && r.candidates && r.candidates.length > 1) {
    return {
      focusedPayload: { service: term, ci_candidates: r.candidates, ci_ambiguous: true },
      message: 'service ambiguous: refusing to guess'
    };
  }
  var svc = r.match || (r.candidates && r.candidates[0]) || null;
  if (!svc) {
    /* fall back to unfiltered lookup: maybe the caller used a name without class hint */
    var r2 = _resolveCi(c, term, '');
    svc = r2.match || (r2.candidates && r2.candidates[0]) || null;
    if (!svc) { return { focusedPayload: { service: term }, error: 'Service "' + term + '" not found' }; }
  }
  var svcSysId = svc.sys_id;

  var openP1P2 = [];
  var openAlerts = [];
  var nextChange = null;
  var nodeCount = 0;
  try {
    var br = (c.blastRadius && typeof c.blastRadius === 'function') ? c.blastRadius(svcSysId, 2) : null;
    if (br && br.nodes) { nodeCount = br.nodes.length; }
  } catch (e) { /* */ }

  try {
    var inc = _newGR('incident');
    inc.addQuery('active', true);
    inc.addQuery('business_service', svcSysId);
    inc.addQuery('priority', 'IN', '1,2');
    inc.orderBy('priority');
    inc.setLimit(10);
    inc.query();
    while (inc.next()) {
      openP1P2.push({ number: _gv(inc, 'number'), priority: _dv(inc, 'priority'), short_description: _gv(inc, 'short_description') });
    }
  } catch (e) { /* business_service field may not exist on the mock */ }

  try {
    var al = _newGR('em_alert');
    al.addQuery('active', true);
    if (brHint(al, svcSysId)) {
      al.addQuery('ci', svcSysId);
    } else {
      al.addQuery('state', '!=', 'closed');
    }
    al.orderBy('severity');
    al.setLimit(10);
    al.query();
    while (al.next()) {
      openAlerts.push({ number: _gv(al, 'number') || _gv(al, 'name'), severity: _dv(al, 'severity') || _gv(al, 'severity'), short_description: _gv(al, 'short_description') });
    }
  } catch (e) { /* */ }

  try {
    var ch = _newGR('change_request');
    ch.addQuery('state', 'IN', '-5,-4');
    if (ch.isValidField && ch.isValidField('business_service')) {
      ch.addQuery('business_service', svcSysId);
    }
    ch.orderBy('planned_start_date');
    ch.setLimit(1);
    ch.query();
    if (ch.next()) {
      nextChange = { number: _gv(ch, 'number'), start: _gv(ch, 'planned_start_date'), short_description: _gv(ch, 'short_description') };
    }
  } catch (e) { /* */ }

  var status = 'unknown';
  if (openP1P2.length > 0) { status = 'degraded'; }
  else if (nodeCount > 0) { status = 'operational'; }

  return {
    focusedPayload: {
      service: { sys_id: svcSysId, name: svc.name || term, 'class': svc['class'] || '' },
      status: status,
      open_p1_p2: openP1P2,
      open_alerts: openAlerts,
      next_change: nextChange,
      member_ci_count: nodeCount,
      snapshot_at: _stamp(c)
    },
    recordNumbers: [svcSysId]
  };
};

function brHint(al, svcSysId) {
  /* Only include the ci query when the field exists to avoid silent zeros */
  try { return al.isValidField && al.isValidField('ci'); } catch (e) { return true; }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExecCMDB;
}
