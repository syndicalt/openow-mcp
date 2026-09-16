var RawExecutor = (function () {
  /**
   * Builder fallback (spec §8.3, §10.2): raw table access behind QueryGuard.
   * Never raw if a skill exists — this is the escape hatch, with stricter
   * confirmation semantics upstream. HR/SecOps tables are denied by
   * AuthContext before reaching here.
   */
  function RawExecutor() {}

  var DEFAULT_FIELDS = {
    'incident': ['number', 'short_description', 'state', 'priority', 'sys_created_on'],
    'problem': ['number', 'short_description', 'state', 'priority', 'sys_created_on'],
    'change_request': ['number', 'short_description', 'state', 'type', 'sys_created_on'],
    'sc_request': ['number', 'state', 'requested_for', 'sys_created_on'],
    'sc_req_item': ['number', 'state', 'cat_item', 'sys_created_on'],
    'em_alert': ['number', 'short_description', 'severity', 'state', 'sys_created_on'],
    'sn_si_incident': ['number', 'short_description', 'severity', 'state', 'sys_created_on'],
    'hr_case': ['number', 'state', 'subject_person', 'topic', 'sys_created_on'],
    'kb_knowledge': ['number', 'short_description', 'sys_updated_on'],
    'cmdb_ci': ['sys_id', 'name', 'sys_class_name', 'operational_status']
  };
  var GROUP_ALLOWLIST = ['state', 'priority', 'assignment_group', 'category', 'severity'];

  RawExecutor.prototype.execute = function (req) {
    if (!req.table) { return { error: 'table is required' }; }
    if (!this.tableExists(req.table)) {
      return { unsupported: true, error: 'table ' + req.table + ' does not exist or is not readable' };
    }
    var qg = new QueryGuard();
    var allowed = req.fields && req.fields.length ? req.fields : DEFAULT_FIELDS[req.table] || ['sys_id'];
    var parsed = qg.parse(req.query || '', { fieldAllowlist: allowed, limit: req.limit || 25 });
    if (parsed.rejected) { return { error: parsed.rejected, queryHash: parsed.hash }; }

    if (req.aggregate) {
      return this.aggregate(req, parsed);
    }
    return this.queryRows(req, parsed, allowed);
  };

  RawExecutor.prototype.tableExists = function (table) {
    try {
      var gr = new GlideRecordSecure('sys_db_object');
      gr.addQuery('name', table);
      gr.addQuery('super_class', '!=', '');
      gr.setLimit(1);
      gr.query();
      return gr.next();
    } catch (e) {
      return true; // unavailable metadata -> let GlideRecord decide
    }
  };

  RawExecutor.prototype.queryRows = function (req, parsed, allowed) {
    var out = [];
    try {
      var gr = new GlideRecordSecure(req.table);
      if (parsed.query) { gr.addEncodedQuery(parsed.query); }
      if (req.orderBy && allowed.indexOf(req.orderBy) >= 0) { gr.orderBy(req.orderBy); }
      gr.setLimit(parsed.limit);
      gr.query();
      var n = 0;
      while (gr.next()) {
        var row = {};
        for (var i = 0; i < allowed.length; i++) {
          row[allowed[i]] = gr.getValue(allowed[i]);
        }
        out.push(row);
        n++;
      }
      return { rows: out, count: n, queryHash: parsed.hash, limit: parsed.limit };
    } catch (e) {
      return { error: e.getMessage ? e.getMessage() : String(e), queryHash: parsed.hash };
    }
  };

  RawExecutor.prototype.aggregate = function (req, parsed) {
    var rows = [];
    try {
      var gr = new GlideAggregate(req.table);
      if (parsed.query) { gr.addEncodedQuery(parsed.query); }
      if (req.aggregate === 'count') {
        gr.addAggregate('COUNT');
      } else {
        var field = req.groupBy || 'state';
        gr.addAggregate(req.aggregate.toUpperCase(), field);
      }
      if (req.groupBy && GROUP_ALLOWLIST.indexOf(req.groupBy) >= 0) {
        gr.groupBy(req.groupBy);
      }
      gr.query();
      while (gr.next()) {
        var row = { value: gr.getAggregate(req.aggregate === 'count' ? 'COUNT' : req.aggregate.toUpperCase()) };
        if (req.groupBy && GROUP_ALLOWLIST.indexOf(req.groupBy) >= 0) {
          row.group = gr.getValue(req.groupBy);
        }
        rows.push(row);
      }
      return { aggregates: rows, count: rows.length, queryHash: parsed.hash };
    } catch (e) {
      return { error: e.getMessage ? e.getMessage() : String(e) };
    }
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = RawExecutor; }
  return RawExecutor;
})();
