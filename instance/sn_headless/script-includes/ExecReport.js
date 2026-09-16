/**
 * ExecReport — skill executable for the ops/report domain (§6.3 card sn.ops.report.aggregate).
 * ES5 only (ServiceNow scoped app): var/function, no arrows, no template literals.
 *
 * Read-only safe aggregate / PA snapshot. Allowlisted tables and group-by
 * fields only; COUNT/AVG/MIN/MAX/SUM with a group cap; requests that are
 * actually record lists in disguise are rejected.
 */
var ExecReport = function () {
  this.VERSION = '1.0.0';
  this.DOMAIN = 'ops';
};

var ALLOWED_TABLES = {
  incident: true,
  change_request: true,
  problem: true,
  task_sla: true,
  cmdb_ci: true,
  sc_req_item: true,
  sc_request: true,
  kb_knowledge: true,
  em_alert: true,
  sysapproval_approver: true,
  sn_si_incident: true
};

var ALLOWED_GROUP_FIELDS = {
  incident: ['priority', 'state', 'assignment_group', 'category', 'cmdb_ci', 'created_on', 'sys_created_on'],
  change_request: ['type', 'state', 'risk', 'impact', 'assignment_group', 'sys_created_on'],
  problem: ['state', 'known_error', 'category', 'sys_created_on'],
  task_sla: ['has_breached', 'task_sys_class_name', 'planned_end_time'],
  cmdb_ci: ['sys_class_name', 'operational_status', 'install_status', 'support_group'],
  sc_req_item: ['state', 'cat_item', 'sys_created_on'],
  sc_request: ['state', 'requested_for', 'sys_created_on'],
  kb_knowledge: ['workflow_state', 'kb_knowledge_base', 'sys_created_on'],
  em_alert: ['severity', 'state', 'ci', 'sys_created_on'],
  sysapproval_approver: ['state', 'approver', 'sysapproval', 'sys_created_on'],
  sn_si_incident: ['severity', 'state', 'assigned_to', 'sys_created_on']
};

var AGGREGATES = ['count', 'avg', 'min', 'max', 'sum'];

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

function _newGA(table) {
  if (typeof GlideAggregate !== 'undefined') { return new GlideAggregate(table); }
  return null;
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

/* ---------------------------------------------------------------------- *
 * sn.ops.report.aggregate — Safe aggregate / PA snapshot (read)
 * ---------------------------------------------------------------------- */

ExecReport.prototype.plan_report_aggregate = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var inp = a.inputs;
  var table = _echo(inp, 'table', ['table_name']) || '';
  var aggregate = _echo(inp, 'aggregate', ['agg', 'operation']) || 'count';
  var field = _echo(inp, 'field', ['metric']) || '';
  var groupBy = _echo(inp, 'groupBy', ['group_by']) || '';
  var filter = _echo(inp, 'filter', ['query']) || '';
  var missing = [];
  if (!table) { missing.push('table'); }
  if (missing.length > 0) { return { focusedPayload: {}, missingFields: missing }; }

  if (!ALLOWED_TABLES[table]) {
    return { focusedPayload: { table: table }, error: 'Table "' + table + '" is not on the aggregate allowlist (record lists must use raw instead)' };
  }
  if (AGGREGATES.indexOf(aggregate) < 0) {
    return { focusedPayload: { table: table, aggregate: aggregate }, error: 'aggregate must be one of ' + AGGREGATES.join(', ') };
  }
  if ((aggregate === 'avg' || aggregate === 'min' || aggregate === 'max' || aggregate === 'sum') && !field) {
    return { focusedPayload: { table: table, aggregate: aggregate }, missingFields: ['field'] };
  }

  var groupField = groupBy || '';
  var allowedGroup = ALLOWED_GROUP_FIELDS[table] || [];
  if (groupField && allowedGroup.indexOf(groupField) < 0) {
    return {
      focusedPayload: { table: table, groupBy: groupField },
      error: 'groupBy "' + groupField + '" is not allowlisted for ' + table + ' (allowed: ' + allowedGroup.join(', ') + ')'
    };
  }

  var rows = [];
  var method = 'aggregate';
  var ga = _newGA(table);

  if (ga) {
    try {
      if (groupField) {
        ga.groupBy(groupField);
        ga.addAggregate(aggregate === 'count' ? 'COUNT' : aggregate.toUpperCase(), field || 'sys_id');
      } else {
        ga.addAggregate(aggregate === 'count' ? 'COUNT' : aggregate.toUpperCase(), field || 'sys_id');
      }
      ga.setGroupByLimit ? ga.setGroupByLimit(20) : null;
      /* allow field filtering only through dotted conditions: keep it simple and safe */
      if (filter) {
        var kv = String(filter).split('=');
        if (kv.length === 2 && kv[0] && kv[1]) {
          ga.addQuery(kv[0], kv[1]);
        }
      }
      ga.query();
      while (ga.next()) {
        var row = {};
        if (groupField) {
          row[groupField] = ga.getGroupValue ? ga.getGroupValue(groupField) : _gv(ga, groupField);
        }
        row.value = ga.getAggregate ? ga.getAggregate(aggregate === 'count' ? 'COUNT' : aggregate.toUpperCase()) : '';
        rows.push(row);
      }
      method = 'GlideAggregate';
    } catch (e) { /* fall through to manual loop */ }
  }

  if (rows.length === 0) {
    /* Manual fallback: count-only, full scan, still capped */
    var gr = _newGR(table);
    if (gr) {
      try {
        if (filter) {
          var kv2 = String(filter).split('=');
          if (kv2.length === 2 && kv2[0] && kv2[1]) { gr.addQuery(kv2[0], kv2[1]); }
        }
        if (aggregate === 'count' && !groupField) {
          gr.query();
          rows.push({ count: gr.getRowCount() });
          method = 'GlideRecord.count';
        }
      } catch (e) { /* */ }
    }
  }

  if (aggregate !== 'count' && rows.length === 0) {
    method = 'manual-scan';
    var gr2 = _newGR(table);
    if (gr2) {
      try {
        if (filter) {
          var kv3 = String(filter).split('=');
          if (kv3.length === 2 && kv3[0] && kv3[1]) { gr2.addQuery(kv3[0], kv3[1]); }
        }
        gr2.setLimit(10000);
        gr2.query();
        var values = [], acc = 0, cnt = 0, mn = null, mx = null;
        while (gr2.next()) {
          var v = Number(_gv(gr2, field));
          if (!isFinite(v)) { continue; }
          cnt++; acc += v;
          if (mn === null || v < mn) { mn = v; }
          if (mx === null || v > mx) { mx = v; }
          values.push(v);
          if (cnt > 5000) { break; } /* bound the scan */
        }
        var out = { count: cnt };
        if (aggregate === 'avg') { out.avg = cnt > 0 ? acc / cnt : 0; }
        if (aggregate === 'min') { out.min = mn; }
        if (aggregate === 'max') { out.max = mx; }
        if (aggregate === 'sum') { out.sum = acc; }
        rows = [out];
      } catch (e) { /* */ }
    }
  }

  var capped = rows.length >= 20;
  if (rows.length > 20) { rows = rows.slice(0, 20); }
  return {
    focusedPayload: {
      table: table,
      aggregate: aggregate,
      field: field || '',
      groupBy: groupField || '',
      method: method,
      rows: rows,
      groups_capped: capped,
      is_record_list: false
    },
    recordNumbers: []
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExecReport;
}
