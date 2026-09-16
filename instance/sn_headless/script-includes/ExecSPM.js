/**
 * ExecSPM — skill executables for the SPM domain (§6.4 cards: portfolio, project).
 * ES5 only (ServiceNow scoped app): var/function, no arrows, no template literals.
 *
 * Both skills are read-only. Planners return { error?, focusedPayload,
 * missingFields?, recordNumbers? } and never mutate. Status narratives are
 * summaries, never record dumps.
 */
var ExecSPM = function () {
  this.VERSION = '1.0.0';
  this.DOMAIN = 'spm';
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

function _or(rec, a, b) {
  return _gv(rec, a) || (b ? _gv(rec, b) : '');
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

function _cap(arr, n) {
  if (!arr) { return []; }
  return arr.slice(0, n || 25);
}

function _findByName(table, name, extra) {
  var gr = _newGR(table);
  if (!gr || !name) { return null; }
  try {
    gr.addQuery('name', name);
    gr.setLimit(1);
    gr.query();
    if (gr.next()) { return gr; }
    gr = _newGR(table);
    gr.addQuery('name', 'CONTAINS', name);
    gr.setLimit(1);
    gr.query();
    if (gr.next()) { return gr; }
  } catch (e) { return null; }
  return null;
}

function _findByNumber(table, number) {
  var gr = _newGR(table);
  if (!gr || !number) { return null; }
  try {
    gr.addQuery('number', number);
    gr.setLimit(1);
    gr.query();
    if (gr.next()) { return gr; }
  } catch (e) { return null; }
  return null;
}

/* ---------------------------------------------------------------------- *
 * sn.spm.portfolio.status — Portfolio, goal, and milestone status (read)
 * ---------------------------------------------------------------------- */

ExecSPM.prototype.plan_portfolio_status = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var c = a.ctx, inp = a.inputs;
  var portfolioName = _echo(inp, 'portfolio_name', ['portfolio', 'name']) || '';
  var goalName = _echo(inp, 'goal_name', ['goal']) || '';
  if (!portfolioName && !goalName) { return { focusedPayload: {}, missingFields: ['portfolio_name'] }; }
  var windowDays = Number(inp.window_days || 14);
  if (!isFinite(windowDays) || windowDays < 1) { windowDays = 14; }
  var today = _datePart(c);
  var horizon = _addDays(c, windowDays);

  var gr = null;
  if (portfolioName) { gr = _findByName('pm_portfolio', portfolioName); }
  if (!gr && goalName) { gr = _findByName('pm_goal', goalName) || _findByName('dmn_goal', goalName); }
  if (gr) {
    var name = _gv(gr, 'name');
    /* portfolio/goal are both "containers": treat name resolution as the anchor */
  } else {
    if (portfolioName) { gr = _findByNumber('pm_portfolio', portfolioName); }
    if (!gr && goalName) { gr = _findByNumber('pm_goal', goalName); }
  }
  if (!gr) {
    return { focusedPayload: { portfolio: portfolioName || goalName }, error: 'Portfolio/goal "' + (portfolioName || goalName) + '" not found' };
  }
  var anchorSysId = _gv(gr, 'sys_id');
  var anchorName = _gv(gr, 'name');

  var projects = [];
  try {
    var pj = _newGR('pm_project');
    pj.addQuery('portfolio', anchorSysId);
    pj.setLimit(50);
    pj.query();
    while (pj.next()) {
      var rag = _or(pj, 'rag', 'u_rag') || _or(pj, 'risk', 'status');
      projects.push({
        sys_id: _gv(pj, 'sys_id'),
        number: _gv(pj, 'number'),
        name: _gv(pj, 'name'),
        state: _dv(pj, 'state') || _gv(pj, 'state'),
        percent_complete: _gv(pj, 'percent_complete') || _gv(pj, 'percent_complete_work'),
        rag: rag
      });
    }
  } catch (e) { /* pm_project not installed */ }

  var byState = {};
  for (var i = 0; i < projects.length; i++) {
    var st = projects[i].state || 'unknown';
    byState[st] = (byState[st] || 0) + 1;
  }

  var milestones = [];
  try {
    var ms = _newGR('pm_planned_task');
    ms.addQuery('planned_end_date', '>=', today);
    ms.addQuery('planned_end_date', '<=', horizon);
    ms.setLimit(20);
    ms.query();
    while (ms.next()) {
      var taskState = _gv(ms, 'state');
      if (String(taskState) === 'complete' || taskState === '3') { continue; }
      milestones.push({
        number: _gv(ms, 'number'),
        short_description: _gv(ms, 'short_description'),
        due: _gv(ms, 'planned_end_date'),
        project: _dv(ms, 'project') || _gv(ms, 'project')
      });
    }
  } catch (e) { /* */ }

  var blocked = [];
  for (var b = 0; b < projects.length; b++) {
    if (projects[b].rag === 'red' || projects[b].rag === 'at risk' || projects[b].state === 'on hold') {
      blocked.push({
        number: projects[b].number,
        name: projects[b].name,
        rag: projects[b].rag,
        state: projects[b].state,
        note: ''
      });
    }
  }
  try {
    for (var bl = 0; bl < blocked.length; bl++) {
      var stm = _newGR('pm_project_status');
      if (stm) {
        stm.addQuery('project', blocked[bl].sys_id);
        stm.orderByDesc('sys_created_on');
        stm.setLimit(1);
        stm.query();
        if (stm.next()) { blocked[bl].note = _gv(stm, 'status') || _gv(stm, 'notes'); }
      }
    }
  } catch (e) { /* */ }

  return {
    focusedPayload: {
      portfolio: anchorName,
      project_count: projects.length,
      by_state: byState,
      projects: _cap(projects, 25),
      milestones_due: _cap(milestones, 20),
      window_days: windowDays,
      blocked: _cap(blocked, 10)
    },
    recordNumbers: [anchorSysId]
  };
};

/* ---------------------------------------------------------------------- *
 * sn.spm.project.prep — Project status / RAID prep (read)
 * ---------------------------------------------------------------------- */

ExecSPM.prototype.plan_project_prep = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var c = a.ctx, inp = a.inputs;
  var term = _echo(inp, 'project', ['project_number', 'name', 'number']) || '';
  if (!term) { return { focusedPayload: {}, missingFields: ['project'] }; }

  var gr = _findByNumber('pm_project', term) || _findByName('pm_project', term);
  if (!gr) { return { focusedPayload: { project: term }, error: 'Project "' + term + '" not found' }; }
  var projectSysId = _gv(gr, 'sys_id');
  var today = _datePart(c);
  var horizon = _addDays(c, 30);

  var milestones = [];
  try {
    var ms = _newGR('pm_planned_task');
    ms.addQuery('project', projectSysId);
    ms.addQuery('planned_end_date', '>=', today);
    ms.addQuery('planned_end_date', '<=', horizon);
    ms.orderBy('planned_end_date');
    ms.setLimit(10);
    ms.query();
    while (ms.next()) {
      milestones.push({ number: _gv(ms, 'number'), short_description: _gv(ms, 'short_description'), due: _gv(ms, 'planned_end_date'), state: _dv(ms, 'state') });
    }
  } catch (e) { /* */ }

  var raiders = [];
  var tables = [['pm_risk', 'risk'], ['pm_issue', 'issue']];
  for (var t = 0; t < tables.length; t++) {
    try {
      var g2 = _newGR(tables[t][0]);
      if (!g2) { continue; }
      g2.addQuery('project', projectSysId);
      g2.setLimit(15);
      g2.query();
      while (g2.next()) {
        raiders.push({ kind: tables[t][1], number: _gv(g2, 'number'), short_description: _gv(g2, 'short_description') || _gv(g2, 'name'), state: _dv(g2, 'state') || _gv(g2, 'state') });
      }
    } catch (e) { /* table not installed */ }
  }

  return {
    focusedPayload: {
      project: { sys_id: projectSysId, number: _gv(gr, 'number'), name: _gv(gr, 'name') },
      percent_complete: _gv(gr, 'percent_complete') || _gv(gr, 'percent_complete_work') || '',
      state: _dv(gr, 'state') || _gv(gr, 'state'),
      next_milestones: _cap(milestones, 10),
      raiders: _cap(raiders, 20),
      narrative: _gv(gr, 'narrative') || _gv(gr, 'description') || ''
    },
    recordNumbers: [projectSysId]
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExecSPM;
}
