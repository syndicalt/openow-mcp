var Audit = (function () {
  /**
   * Audit writer for sn_headless_run (spec §8.2, observability invariant).
   * A dispatch without an audit line is a failed dispatch.
   */
  function Audit() {}

  Audit.prototype.write = function (run) {
    var gr = new GlideRecordSecure('sn_headless_run');
    gr.initialize();
    gr.setValue('request_id', run.requestId);
    gr.setValue('skill_id', run.skillId);
    gr.setValue('skill_version', run.skillVersion || '');
    gr.setValue('user', gs.getUserID());
    gr.setValue('client_app', run.clientApp || '');
    gr.setValue('inputs_hash', run.inputsHash || '');
    gr.setValue('tables_touched', joinList(run.tablesTouched));
    gr.setValue('record_numbers', joinList(run.recordNumbers));
    if (run.queryHash) { gr.setValue('query_hash', run.queryHash); }
    gr.setValue('outcome', run.outcome || 'ok');
    if (run.error) { gr.setValue('error', run.error); }
    gr.setValue('latency_ms', run.latencyMs || 0);
    if (run.tokenApp) { gr.setValue('token_app', run.tokenApp); }
    if (run.resultSummary) { gr.setValue('result_summary', run.resultSummary); }
    gr.setValue('confirmed', run.confirmed === true);
    var id = gr.insert();
    return id;
  };

  Audit.prototype.findByRequestId = function (requestId) {
    if (!requestId) { return null; }
    var gr = new GlideRecordSecure('sn_headless_run');
    gr.addQuery('request_id', requestId);
    gr.orderByDesc('sys_created_on');
    gr.setLimit(10);
    gr.query();
    var fallback = null;
    var settled = null;
    while (gr.next()) {
      var row = this.fromRecord(gr);
      if (!fallback) { fallback = row; }
      if (row.outcome === 'applied') { return row; }
      if (row.outcome !== 'pending' && !settled) { settled = row; }
    }
    // Prefer a settled outcome (error/denied/unsupported/applied) over a stale
    // pending row from an earlier attempt; pending wins only when nothing settled.
    return settled || fallback;
  };

  Audit.prototype.fromRecord = function (gr) {
    return {
      sysId: gr.getUniqueValue(),
      requestId: gr.getValue('request_id') || '',
      skillId: gr.getValue('skill_id') || '',
      skillVersion: gr.getValue('skill_version') || '',
      user: gr.getValue('user') || '',
      clientApp: gr.getValue('client_app') || '',
      inputsHash: gr.getValue('inputs_hash') || '',
      tablesTouched: splitList(gr.getValue('tables_touched')),
      recordNumbers: splitList(gr.getValue('record_numbers')),
      queryHash: gr.getValue('query_hash') || undefined,
      outcome: gr.getValue('outcome') || 'ok',
      error: gr.getValue('error') || undefined,
      latencyMs: parseInt(gr.getValue('latency_ms') || '0', 10) || 0,
      tokenApp: gr.getValue('token_app') || undefined,
      resultSummary: gr.getValue('result_summary') || undefined,
      confirmed: gr.getValue('confirmed') === 'true',
      createdAt: gr.getValue('sys_created_on') || ''
    };
  };

  function joinList(list) {
    if (!list) { return ''; }
    return list.join(',');
  }

  function splitList(value) {
    if (!value) { return []; }
    return value.split(',').filter(function (s) { return s.length > 0; });
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = Audit; }
  return Audit;
})();
