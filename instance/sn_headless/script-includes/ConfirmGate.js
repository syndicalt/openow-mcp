var ConfirmGate = (function () {
  /**
   * Confirmation policy engine (spec §4.4 + §3.3 dispatch). Maps the
   * confirmation class to client behavior; computes diffs/drafts without side
   * effects; enforces idempotency on request_id.
   */
  function ConfirmGate() {}

  ConfirmGate.prototype.shouldConfirm = function (confirmation, req, owned, policy) {
    if (!confirmation || confirmation === 'read') { return false; }
    if (confirmation === 'update_owned') {
      // auto-apply only when policy allows AND the record is owned by the caller
      if (policy && policy.autoApply === true && owned === true) { return false; }
      return true;
    }
    return true;
  };

  ConfirmGate.prototype.buildDiff = function (record, proposed) {
    var diff = [];
    for (var key in proposed) {
      if (!proposed.hasOwnProperty(key)) { continue; }
      var after = proposed[key];
      var before = record && record.getValue ? record.getValue(key) : undefined;
      if (String(before === undefined ? '' : before) !== String(after === undefined ? '' : after)) {
        diff.push({ field: key, before: before === undefined ? null : before, after: after === undefined ? null : after });
      }
    }
    return diff;
  };

  ConfirmGate.prototype.buildDraft = function (summary, fields) {
    return { summary: summary, fields: fields };
  };

  /**
   * Idempotency: an applied/pending answer for an existing request_id is
   * replayed; the applier is never run twice (spec §7.2 no double writes).
   */
  ConfirmGate.prototype.replay = function (storedRun) {
    if (!storedRun) { return null; }
    var payload = null;
    try {
      payload = JSON.parse(storedRun.resultSummary || 'null');
    } catch (e) {
      payload = null;
    }
    return {
      replayed: true,
      outcome: storedRun.outcome,
      auditId: storedRun.sysId,
      focusedPayload: payload || {},
      message: storedRun.outcome === 'applied' ? 'already applied' : undefined
    };
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = ConfirmGate; }
  return ConfirmGate;
})();
