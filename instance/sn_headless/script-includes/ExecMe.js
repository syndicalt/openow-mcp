/**
 * ExecMe — skill executable for the Me domain (§6.3 card sn.me.work).
 * ES5 only (ServiceNow scoped app): var/function, no arrows, no template literals.
 *
 * Read-only home skill. Lists assigned-to-me, pending approvals, watches and
 * requested-for-me, each capped and each line being number/type/state/due.
 * Never a record dump; offers the matching domain skill as the next action.
 */
var ExecMe = function () {
  this.VERSION = '1.0.0';
  this.DOMAIN = 'me';
};

var TASK_TABLES = ['incident', 'change_request', 'problem', 'sc_req_item'];
var CAP = 15;

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

function _me(ctx) {
  var c = ctx || {}, u = c.user || {};
  return u.sys_id || c.userId || '';
}

function _isCtx(o) {
  return !!(o && typeof o === 'object' && o.user && typeof o.user === 'object');
}

function _cap(arr, n) {
  if (!arr) { return []; }
  return arr.slice(0, n || CAP);
}

function _due(rec) {
  return _gv(rec, 'due_date') || _gv(rec, 'planned_end_time') || _gv(rec, 'planned_end_date') || _gv(rec, 'end_date');
}

function _line(rec) {
  return {
    number: _gv(rec, 'number') || _gv(rec, 'sys_id'),
    type: _gv(rec, 'sys_class_name') || '',
    short_description: _gv(rec, 'short_description'),
    state: _dv(rec, 'state') || _gv(rec, 'state'),
    due: _due(rec)
  };
}

/* ---------------------------------------------------------------------- *
 * sn.me.work — My work, my approvals, my watches (read)
 * ---------------------------------------------------------------------- */

ExecMe.prototype.plan_work = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var c = a.ctx, inp = a.inputs;
  var me = _me(c);
  var out = { assigned: [], approvals: [], watches: [], requested_for: [] };
  var numbers = [];
  var i;

  if (!me) { return { focusedPayload: out, error: 'no current user identity' }; }

  /* Assigned to me (open) */
  for (i = 0; i < TASK_TABLES.length && out.assigned.length < CAP; i++) {
    try {
      var gr = _newGR(TASK_TABLES[i]);
      if (!gr) { continue; }
      gr.addQuery('assigned_to', me);
      gr.addQuery('active', true);
      gr.orderByDesc('sys_created_on');
      gr.setLimit(CAP - out.assigned.length);
      gr.query();
      while (gr.next()) {
        out.assigned.push(_line(gr));
        numbers.push(_gv(gr, 'number'));
      }
    } catch (e) { /* table hidden */ }
  }
  /* Re-sort by due date, keep cap */
  out.assigned.sort(function (x, y2) { return String(x.due).localeCompare(String(y2.due)); });
  out.assigned = _cap(out.assigned, CAP);

  /* Pending approvals where approver = me */
  try {
    var appr = _newGR('sysapproval_approver');
    appr.addQuery('approver', me);
    appr.addQuery('state', 'requested');
    appr.orderByDesc('sys_created_on');
    appr.setLimit(CAP);
    appr.query();
    while (appr.next()) {
      var rec = {
        number: _dv(appr, 'sysapproval') || _gv(appr, 'sysapproval') || _gv(appr, 'sys_id'),
        type: 'approval',
        short_description: _gv(appr, 'short_description') || _dv(appr, 'sysapproval_name') || '',
        state: 'requested',
        due: _gv(appr, 'due') || _gv(appr, 'expiration')
      };
      out.approvals.push(rec);
      numbers.push(rec.number);
    }
  } catch (e) { /* */ }

  /* Watches */
  try {
    var watch = _newGR('sys_user_watch');
    watch.addQuery('user', me);
    watch.orderByDesc('sys_created_on');
    watch.setLimit(CAP);
    watch.query();
    var watchedGr = null;
    while (watch.next()) {
      var target = _gv(watch, 'task') || _gv(watch, 'table_sys_id') || '';
      if (!watchedGr) { watchedGr = _newGR('task'); }
      if (watchedGr && target && watchedGr.get(target)) {
        out.watches.push(_line(watchedGr));
        numbers.push(_gv(watchedGr, 'number'));
      }
    }
  } catch (e) { /* */ }

  /* Requested for me, not closed */
  try {
    var ritm = _newGR('sc_req_item');
    ritm.addQuery('requested_for', me);
    ritm.addQuery('state', 'NOT IN', '3,4');
    ritm.orderByDesc('sys_created_on');
    ritm.setLimit(CAP);
    ritm.query();
    while (ritm.next()) {
      out.requested_for.push(_line(ritm));
      numbers.push(_gv(ritm, 'number'));
    }
  } catch (e) { /* */ }

  /* Offer the matching domain skill as the next action */
  out.next_skills = [];
  if (out.approvals.length > 0) { out.next_skills.push('sn.itsm.request.fulfill'); }
  if (out.assigned.length > 0) { out.next_skills.push('sn.itsm.incident.triage'); }
  if (out.watches.length > 0) { out.next_skills.push('sn.itsm.incident.update'); }

  return { focusedPayload: out, recordNumbers: numbers.slice(0, 15) };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExecMe;
}
