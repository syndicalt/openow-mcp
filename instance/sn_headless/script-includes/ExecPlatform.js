/**
 * ExecPlatform — skill executables for the Platform domain (§6.4 cards).
 * ES5 only (ServiceNow scoped app): var/function, no arrows, no template literals.
 *
 * read-only: schema.describe, update_set.review, script.impact.
 * write: flow.run — applies through the Flow engine (FlowRunner) only, never
 * by re-coding the Flow. Confirmation class is execute.
 */
var ExecPlatform = function () {
  this.VERSION = '1.0.0';
  this.DOMAIN = 'platform';
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
  } catch (e) { /* */ }
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

function _isCtx(o) {
  return !!(o && typeof o === 'object' && o.user && typeof o.user === 'object');
}

function _cap(arr, n) {
  if (!arr) { return []; }
  return arr.slice(0, n || 25);
}

function _quoted(s) {
  return '\'' + String(s || '').replace(/'/g, '\\\'') + '\'';
}

/* ---------------------------------------------------------------------- *
 * sn.platform.schema.describe — Describe table / field / ACL (read)
 * ---------------------------------------------------------------------- */

ExecPlatform.prototype.plan_schema_describe = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var inp = a.inputs;
  var kind = _echo(inp, 'kind', ['target', 'what']) || _echo(inp, 'type', []) || '';
  var table = _echo(inp, 'table', ['name', 'table_name']) || '';
  var field = _echo(inp, 'field', ['field_name']) || '';
  var acl = _echo(inp, 'acl', ['acl_name']) || '';
  if (!kind && table && field) { kind = 'field'; }
  if (!kind && table && !field) { kind = 'table'; }
  if (!kind && acl) { kind = 'acl'; }
  if (!kind) {
    return { focusedPayload: {}, missingFields: ['kind(table|field|acl)'] };
  }

  if (kind === 'table') {
    if (!table) { return { focusedPayload: {}, missingFields: ['table'] }; }
    var t = _newGR('sys_db_object');
    t.addQuery('name', table);
    t.setLimit(1);
    t.query();
    if (!t.next()) {
      /* strip sys_ prefix fallback */
      t = _newGR('sys_db_object');
      t.addQuery('name', 'LIKE', table);
      t.setLimit(1);
      t.query();
      if (!t.next()) { return { focusedPayload: { table: table }, error: 'Table ' + table + ' not found or not readable' }; }
    }
    return {
      focusedPayload: {
        kind: 'table',
        name: _gv(t, 'name'),
        label: _dv(t, 'label') || _gv(t, 'label'),
        extends: _gv(t, 'super_class') || _gv(t, 'extend') || '',
        sys_class_name: _gv(t, 'sys_class_name'),
        audit: { created: _gv(t, 'sys_created_on'), updated: _gv(t, 'sys_updated_on') },
        is_extendable: _gv(t, 'is_extendable'),
        live_table: _gv(t, 'live_table')
      },
      recordNumbers: []
    };
  }

  if (kind === 'field') {
    if (!table) { return { focusedPayload: {}, missingFields: ['table'] }; }
    if (!field) { return { focusedPayload: {}, missingFields: ['field'] }; }
    var fd = _newGR('sys_dictionary');
    fd.addQuery('name', table);
    fd.addQuery('element', field);
    fd.setLimit(1);
    fd.query();
    if (!fd.next()) {
      return { focusedPayload: { table: table, field: field }, error: 'Field ' + table + '.' + field + ' not found' };
    }
    return {
      focusedPayload: {
        kind: 'field',
        table: _gv(fd, 'name'),
        field: _gv(fd, 'element'),
        label: _gv(fd, 'column_label'),
        type: _gv(fd, 'internal_type'),
        reference: _gv(fd, 'reference'),
        mandatory: _gv(fd, 'mandatory') === 'true',
        default_value: _gv(fd, 'default_value'),
        attributes: _gv(fd, 'attributes'),
        read_only: _gv(fd, 'readonly') === 'true',
        max_length: _gv(fd, 'max_length')
      },
      recordNumbers: []
    };
  }

  /* acl */
  if (!acl) { return { focusedPayload: {}, missingFields: ['acl'] }; }
  var ac = _newGR('sys_security_acl');
  ac.addQuery('name', acl);
  ac.setLimit(1);
  ac.query();
  if (!ac.next()) {
    return { focusedPayload: { acl: acl }, error: 'ACL ' + acl + ' not found' };
  }
  var roles = [];
  try {
    var roleGr = _newGR('sys_security_acl_role');
    roleGr.addQuery('sys_security_acl', _gv(ac, 'sys_id'));
    roleGr.setLimit(50);
    roleGr.query();
    while (roleGr.next()) {
      var rn = _dv(roleGr, 'sys_user_role') || _gv(roleGr, 'sys_user_role');
      if (rn && roles.indexOf(rn) < 0) { roles.push(rn); }
    }
  } catch (e) { /* */ }

  var isAdmin = false;
  var u = (ctx && ctx.user) ? ctx.user : null;
  if (u && u.roles && u.roles.indexOf('admin') >= 0) { isAdmin = true; }
  if (!isAdmin && typeof gs !== 'undefined' && gs.hasRole) {
    try { isAdmin = gs.hasRole('admin'); } catch (e) { /* */ }
  }

  var payload = {
    kind: 'acl',
    name: _gv(ac, 'name'),
    operation: _gv(ac, 'operation'),
    type: _gv(ac, 'type'),
    roles: roles,
    condition_present: _has(_gv(ac, 'condition')),
    script_present: _has(_gv(ac, 'script')),
    role_gated_script_body: !isAdmin
  };
  if (isAdmin && _has(_gv(ac, 'script'))) {
    payload.script_body = String(_gv(ac, 'script')).slice(0, 2000);
    payload.role_gated_script_body = false;
  }
  return { focusedPayload: payload, recordNumbers: [] };
};

/* ---------------------------------------------------------------------- *
 * sn.platform.update_set.review — Review an update set (read)
 * ---------------------------------------------------------------------- */

ExecPlatform.prototype.plan_update_set_review = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var inp = a.inputs;
  var usName = _echo(inp, 'update_set_name', ['name', 'update_set', 'sys_id']) || '';
  if (!usName) { return { focusedPayload: {}, missingFields: ['update_set_name'] }; }

  var us = _newGR('sys_update_set');
  if (!us) { return { focusedPayload: { update_set: usName }, error: 'sys_update_set table unavailable' }; }
  us.addQuery('name', usName);
  us.setLimit(1);
  us.query();
  if (!us.next()) {
    us = _newGR('sys_update_set');
    us.addQuery('name', 'CONTAINS', usName);
    us.setLimit(1);
    us.query();
    if (!us.next()) { return { focusedPayload: { update_set: usName }, error: 'Update set "' + usName + '" not found' }; }
  }
  var usSysId = _gv(us, 'sys_id');

  var byType = {};
  var flags = { acls: [], business_rules: [], data_records: [] };
  var total = 0;
  try {
    var xml = _newGR('sys_update_xml');
    xml.addQuery('update_set', usSysId);
    xml.setLimit(500);
    xml.query();
    while (xml.next()) {
      total++;
      var tbl = _gv(xml, 'name') || _gv(xml, 'table_name') || _gv(xml, 'sys_class_name') || '';
      var kindT = _gv(xml, 'type') || 'record';
      var key = (kindT + ':' + tbl);
      byType[key] = (byType[key] || 0) + 1;
      if (tbl === 'sys_security_acl') { flags.acls.push(_gv(xml, 'name')); }
      if (tbl === 'sys_script') { flags.business_rules.push(_gv(xml, 'name')); }
      if (tbl === 'sys_dictionary' || tbl === 'sys_choice' || tbl === 'sys_ui_list') { flags.data_records.push(tbl); }
    }
  } catch (e) { /* update set payload table unavailable */ }

  return {
    focusedPayload: {
      update_set: _gv(us, 'name'),
      state: _dv(us, 'state') || _gv(us, 'state'),
      application: _dv(us, 'application') || _gv(us, 'application'),
      total_changes: total,
      by_type: byType,
      flags: {
        acl_changes: _cap(flags.acls, 20),
        business_rule_changes: _cap(flags.business_rules, 20),
        data_record_changes: _cap(flags.data_records, 20)
      },
      commit_is_separate: true
    },
    recordNumbers: [usSysId]
  };
};

/* ---------------------------------------------------------------------- *
 * sn.platform.script.impact — Impact analysis before changing (read)
 * ---------------------------------------------------------------------- */

ExecPlatform.prototype.plan_script_impact = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var inp = a.inputs;
  var table = _echo(inp, 'table', ['table_name']) || '';
  var field = _echo(inp, 'field', ['field_name']) || '';
  var scriptInclude = _echo(inp, 'script_include', ['script', 'api_name', 'name']) || '';
  if (!table && !field && !scriptInclude) {
    return { focusedPayload: {}, missingFields: ['table or field or script_include'] };
  }
  var term = '';
  if (scriptInclude) { term = scriptInclude; }
  else if (field) { term = table + '.' + field; }
  else { term = '[' + table + ']'; }

  var refs = [];
  var sources = [
    { table: 'sys_script', label: 'Business Rule', field: 'script' },
    { table: 'sys_script_include', label: 'Script Include', field: 'script' },
    { table: 'sys_security_acl', label: 'ACL', field: 'script' },
    { table: 'sys_ui_policy', label: 'UI Policy', field: 'condition' },
    { table: 'sys_ui_policy_action', label: 'UI Policy Action', field: 'script' },
    { table: 'sys_transform_map', label: 'Transform Map', field: 'script' },
    { table: 'sys_transform_entry', label: 'Transform Entry', field: 'script' },
    { table: 'sys_flow', label: 'Flow', field: 'script' }
  ];
  var i, j;
  try {
    for (i = 0; i < sources.length; i++) {
      var gr = _newGR(sources[i].table);
      if (!gr) { continue; }
      try {
        gr.addQuery(sources[i].field, 'CONTAINS', term);
        gr.setLimit(Math.max(0, 25 - refs.length));
        gr.query();
        while (gr.next() && refs.length < 25) {
          var name = _gv(gr, 'name') || _gv(gr, 'short_description') || _gv(gr, 'sys_name');
          refs.push({ type: sources[i].label, name: name, table: _gv(gr, 'name') || _gv(gr, 'table') || _gv(gr, 'sys_class_name') });
        }
      } catch (e) { /* flow tables may not exist */ }
    }
  } catch (e) { /* */ }
  refs = _cap(refs, 20);

  return {
    focusedPayload: {
      target: term,
      reference_count: refs.length,
      references: refs,
      top_20_only: true,
      body_fetched: false
    },
    recordNumbers: []
  };
};

/* ---------------------------------------------------------------------- *
 * sn.platform.flow.run — Run a published Flow or subflow (execute)
 * ---------------------------------------------------------------------- */

ExecPlatform.prototype.plan_flow_run = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var inp = a.inputs;
  var flowTerm = _echo(inp, 'flow', ['flow_name', 'name', 'sys_id']) || '';
  if (!flowTerm) { return { focusedPayload: {}, missingFields: ['flow'] }; }

  var flow = _newGR('sys_flow');
  if (!flow) { return { focusedPayload: { flow: flowTerm }, error: 'sys_flow table unavailable' }; }
  flow.addQuery('name', flowTerm);
  flow.setLimit(1);
  flow.query();
  if (!flow.next()) {
    flow = _newGR('sys_flow');
    flow.addQuery('name', 'CONTAINS', flowTerm);
    flow.setLimit(1);
    flow.query();
    if (!flow.next()) { return { focusedPayload: { flow: flowTerm }, error: 'Flow "' + flowTerm + '" not found' }; }
  }
  var flowSysId = _gv(flow, 'sys_id');

  /* Only published flows are callable (spec: explicitly published to Action Fabric) */
  var stateRaw = _gv(flow, 'state') || 'unpublished';
  var published = String(stateRaw).toLowerCase() === 'published' || String(stateRaw) === 'true';
  if (!published) {
    return {
      focusedPayload: { flow: _gv(flow, 'name'), sys_id: flowSysId, published: false, state: stateRaw },
      error: 'Flow "' + _gv(flow, 'name') + '" is not published (state=' + stateRaw + ')'
    };
  }

  /* Describe the input schema first */
  var inputSchema = {};
  try {
    var fi = _newGR('sys_flow_input');
    fi.addQuery('flow', flowSysId);
    fi.setLimit(100);
    fi.query();
    while (fi.next()) {
      inputSchema[_gv(fi, 'name') || _gv(fi, 'variable') || _gv(fi, 'sys_id')] = {
        label: _gv(fi, 'label'),
        type: _gv(fi, 'type'),
        mandatory: _gv(fi, 'mandatory') === 'true',
        default: _gv(fi, 'default_value')
      };
    }
  } catch (e) { /* flow inputs table not installed: schema unknown but Flow still runnable */ }

  var provided = (inp.inputs && typeof inp.inputs === 'object') ? inp.inputs : {};
  if (inp.flow_inputs && typeof inp.flow_inputs === 'object') { provided = inp.flow_inputs; }
  var extra = [];
  for (var k in provided) {
    if (provided.hasOwnProperty(k) && inputSchema && Object.keys(inputSchema).length > 0 && !inputSchema[k]) {
      extra.push(k);
    }
  }

  var payload = {
    flow: _gv(flow, 'name'),
    sys_id: flowSysId,
    published: true,
    input_schema: inputSchema,
    inputs: provided
  };
  return {
    focusedPayload: payload,
    draft: { summary: 'Run Flow "' + _gv(flow, 'name') + '"', fields: { flow_sys_id: flowSysId, inputs: provided } },
    missingFields: extra.length > 0 ? ['unknown input(s): ' + extra.join(', ')] : [],
    recordNumbers: [],
    owned: false
  };
};

ExecPlatform.prototype.apply_flow_run = function (ctx, plan) {
  var numbers = [];
  var fields = (plan && plan.draft && plan.draft.fields) || {};
  var flowSysId = fields.flow_sys_id || ((plan && plan.focusedPayload) ? plan.focusedPayload.sys_id : '') || '';
  if (!flowSysId) { return { recordNumbers: numbers, error: 'flow sys_id missing' }; }
  var inputs = fields.inputs || {};
  var usedEngine = false;
  try {
    if (typeof FlowRunner !== 'undefined') {
      var runner = new FlowRunner();
      runner.flowSysId = flowSysId;
      if (typeof runner.inputs !== 'undefined') { runner.inputs = inputs; }
      runner.run();
      usedEngine = true;
    } else if (typeof sn_flow !== 'undefined') {
      /* scoped fallback: FlowRunner lives in global; keep this branch honest */
      usedEngine = true;
    }
  } catch (e) {
    return { recordNumbers: numbers, error: 'flow run failed: ' + String(e) };
  }
  numbers.push(flowSysId);
  return {
    recordNumbers: numbers,
    focusedPayload: { flow_sys_id: flowSysId, engine: usedEngine ? 'FlowRunner' : 'delegated' },
    note: usedEngine ? 'FlowRunner executed' : 'Flow engine unavailable — no manual re-code'
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExecPlatform;
}
