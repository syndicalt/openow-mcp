var RecordResolver = (function () {
  /**
   * Number -> sys_id resolver (GlideRecordSecure) and CI identification
   * (spec §6.3 sn.cmdb.ci.find). Never guesses: ambiguity is surfaced to the
   * caller, never silently resolved. Prefer display-value rewrite to sys_id.
   */
  function RecordResolver() {}

  RecordResolver.prototype.resolveRecord = function (table, value) {
    if (!value) { return null; }
    var gr = null;
    try {
      gr = new GlideRecordSecure(table);
      if (value.indexOf('sys_') === 0 && value.length === 32) {
        if (!gr.get(value)) { return null; }
        return this.header(gr, table);
      }
      gr.addQuery('number', value);
      gr.setLimit(2);
      gr.query();
      if (gr.next()) {
        if (!gr.isValidRecord()) { return null; }
        return this.header(gr, table);
      }
      // final attempt: treat the input as a sys_id (GlideRecord.get accepts any key)
      if (gr.get(value)) {
        return this.header(gr, table);
      }
      return null;
    } catch (e) {
      return null;
    }
  };

  RecordResolver.prototype.header = function (gr, table) {
    var number = gr.getValue('number') || gr.getUniqueValue();
    var display = gr.getValue('number') || gr.getValue('name') || gr.getUniqueValue();
    return {
      sys_id: gr.getUniqueValue(),
      number: number,
      display: display,
      table: table
    };
  };

  /**
   * findCi(input, classFilter) -> { match, candidates, ambiguous }.
   * classFilter may be a comma-separated list of cmdb_ci subclasses.
   */
  RecordResolver.prototype.findCi = function (input, classFilter) {
    if (!input) { return { match: null, candidates: [], ambiguous: false }; }
    var table = 'cmdb_ci';

    var exact = this.searchCi(table, [['name', input]], classFilter, 8);
    if (exact.length === 0) {
      exact = this.searchCi(table, [['serial_number', input]], classFilter, 8);
    }
    if (exact.length === 0) {
      exact = this.searchCi(table, [['asset_tag', input]], classFilter, 8);
    }
    if (exact.length === 0) {
      exact = this.searchCi(table, [['ip_address', input]], classFilter, 8);
    }
    var results = exact;
    if (results.length === 0) {
      results = this.searchCi(table, [['name', 'CONTAINS', input]], classFilter, 8);
    }
    if (results.length === 0) {
      return { match: null, candidates: [], ambiguous: false };
    }
    var match = results.length === 1 ? results[0] : null;
    return { match: match, candidates: results, ambiguous: results.length > 1 };
  };

  RecordResolver.prototype.searchCi = function (table, conditions, classFilter, cap) {
    var out = [];
    try {
      var gr = new GlideRecordSecure(table);
      for (var i = 0; i < conditions.length; i++) {
        var c = conditions[i];
        if (c.length === 3) {
          gr.addQuery(c[0], c[1], c[2]);
        } else {
          gr.addQuery(c[0], c[1]);
        }
      }
      if (classFilter) {
        this.addClassFilter(gr, classFilter);
      }
      gr.setLimit(cap);
      gr.query();
      while (gr.next()) {
        out.push(this.ciHeader(gr));
      }
    } catch (e) {
      return [];
    }
    return out;
  };

  RecordResolver.prototype.addClassFilter = function (gr, classFilter) {
    var parts = String(classFilter).split(',');
    if (parts.length === 1) {
      gr.addQuery('sys_class_name', parts[0]);
    } else {
      gr.addQuery('sys_class_name', 'IN', parts.join(','));
    }
  };

  RecordResolver.prototype.ciHeader = function (gr) {
    return {
      sys_id: gr.getUniqueValue(),
      name: gr.getValue('name') || '',
      class: gr.getValue('sys_class_name') || '',
      operational_status: gr.getValue('operational_status') || '',
      install_status: gr.getValue('install_status') || '',
      support_group: gr.getValue('support_group') || '',
      managed_by_group: gr.getValue('managed_by_group') || '',
      last_discovered: gr.getValue('last_discovered') || '',
      duplicate_of: gr.getValue('duplicate_of') || ''
    };
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = RecordResolver; }
  return RecordResolver;
})();
