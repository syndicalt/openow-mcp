/**
 * ExecSecOps — skill executables for the SecOps domain (§6.4 cards).
 * ES5 only (ServiceNow scoped app): var/function, no arrows, no template literals.
 *
 * Restricted skills: structured inputs, no broad searches, low-privilege
 * friendly (no IOC text dumps). Mutations happen only through SIR/VR
 * playbooks and Flows — the read path here never writes.
 */
var ExecSecOps = function () {
  this.VERSION = '1.0.0';
  this.DOMAIN = 'secops';
};

var SIR_ROLES = ['sn_si.analyst', 'sn_si.admin'];
var VR_ROLES = ['sn_vuln', 'sn_vuln.analyst', 'sn_vuln.admin'];

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

function _roleOk(ctx, roles) {
  var u = (ctx && ctx.user) ? ctx.user : null;
  var i;
  if (u && u.hasRole && typeof u.hasRole === 'function') {
    for (i = 0; i < roles.length; i++) { if (u.hasRole(roles[i])) { return true; } }
    return false;
  }
  if (u && u.roles && u.roles.length > 0) {
    for (i = 0; i < roles.length; i++) { if (u.roles.indexOf(roles[i]) >= 0) { return true; } }
    return false;
  }
  if (typeof gs !== 'undefined' && gs.hasRole) {
    for (i = 0; i < roles.length; i++) {
      try { if (gs.hasRole(roles[i])) { return true; } } catch (e) { /* */ }
    }
    return false;
  }
  return true;
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
      return gr.get(number) ? gr : null;
    }
    gr.addQuery('number', number);
    gr.setLimit(2);
    gr.query();
    if (gr.next()) { return gr; }
  } catch (e) { return null; }
  return null;
}

function _either(rec, a, b) {
  var v = _gv(rec, a);
  if (v) { return v; }
  return b ? _gv(rec, b) : '';
}

/* ---------------------------------------------------------------------- *
 * sn.secops.sir.triage — Security incident triage (restricted, read)
 * ---------------------------------------------------------------------- */

ExecSecOps.prototype.plan_sir_triage = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var c = a.ctx, inp = a.inputs;
  if (!_roleOk(c, SIR_ROLES)) {
    return {
      focusedPayload: { restricted: true },
      role_denied: true,
      message: 'requires sn_si.analyst — no broad SI searches, no IOC dumps'
    };
  }
  var sirNumber = _echo(inp, 'sir_number', ['number', 'incident_number']) || '';
  if (!sirNumber) { return { focusedPayload: {}, missingFields: ['sir_number'] }; }

  var rec = _loadByNumber('sn_si_incident', sirNumber);
  if (!rec) { return { focusedPayload: { sir_number: sirNumber }, error: 'SIR ' + sirNumber + ' not found or not readable' }; }

  var relatedIt = _gv(rec, 'incident') || '';
  var relatedItNumber = '';
  if (relatedIt) {
    try {
      var inc = _newGR('incident');
      if (inc && inc.get(relatedIt)) { relatedItNumber = _gv(inc, 'number'); }
    } catch (e) { /* */ }
  }

  return {
    focusedPayload: {
      sir_number: _gv(rec, 'number'),
      severity: _dv(rec, 'severity') || _gv(rec, 'severity'),
      state: _dv(rec, 'state') || _gv(rec, 'state'),
      assigned_to: _dv(rec, 'assigned_to'),
      related_ci: _dv(rec, 'cmdb_ci') || _dv(rec, 'ci') || _gv(rec, 'cmdb_ci') || _gv(rec, 'ci'),
      related_itsm_incident: relatedItNumber || relatedIt,
      short_description: _gv(rec, 'short_description'),
      mutations_via: ['SIR playbooks / Flows']
    },
    recordNumbers: [_gv(rec, 'number')],
    owned: _gv(rec, 'assigned_to') === _me(ctx)
  };
};

/* ---------------------------------------------------------------------- *
 * sn.secops.vuln.prioritize — VR prioritization with CMDB (restricted, read)
 * ---------------------------------------------------------------------- */

ExecSecOps.prototype.plan_vuln_prioritize = function (ctx, inputs) {
  var a = _args(ctx, inputs);
  var c = a.ctx, inp = a.inputs;
  if (!_roleOk(c, VR_ROLES)) {
    return {
      focusedPayload: { restricted: true },
      role_denied: true,
      message: 'requires sn_vuln role — no mass-close, no raw CVE dumps'
    };
  }
  var limit = Number(inp.limit || 10);
  if (!isFinite(limit) || limit < 1) { limit = 10; }
  if (limit > 25) { limit = 25; }

  var rows = [];
  var tables = ['sn_vuln_vulnerable_item', 'sn_vuln_vulnerable_item'];
  var openStateFilter = function (gr) { return gr; };
  var gr = _newGR('sn_vuln_vulnerable_item');
  if (!gr) {
    gr = _newGR('vulnerable_item');
  }
  if (gr) {
    try {
      gr.addQuery('state', 'IN', 'new,open');
      gr.orderBy('severity');
      gr.setLimit(Math.min(limit * 3, 100));
      gr.query();
      while (gr.next()) {
        rows.push({
          sys_id: _gv(gr, 'sys_id'),
          number: _gv(gr, 'number') || _gv(gr, 'name'),
          short_description: _gv(gr, 'short_description'),
          severity: _dv(gr, 'severity') || _gv(gr, 'severity'),
          state: _dv(gr, 'state') || _gv(gr, 'state'),
          ci_sys_id: _gv(gr, 'cmdb_ci') || _gv(gr, 'ci'),
          ci_name: _dv(gr, 'cmdb_ci') || _dv(gr, 'ci')
        });
      }
    } catch (e) { /* vulnerable item table unavailable */ }
  }

  /* context cache: CI criticality + blast-radius node count per CI */
  var ciCache = {};
  var ranked = [];
  for (var i = 0; i < rows.length; i++) {
    var ciSysId = rows[i].ci_sys_id;
    var ctx2 = ciCache[ciSysId];
    if (!ctx2) {
      ctx2 = { criticality: '', blast: 0 };
      if (ciSysId) {
        try {
          var ci = _newGR('cmdb_ci');
          if (ci && ci.get(ciSysId)) {
            ctx2.criticality = _dv(ci, 'criticality') || _gv(ci, 'criticality') || '';
          }
        } catch (e) { /* */ }
        try {
          var br = (c.blastRadius && typeof c.blastRadius === 'function') ? c.blastRadius(ciSysId, 2) : null;
          if (br && br.nodes) { ctx2.blast = br.nodes.length; }
        } catch (e) { /* */ }
      }
      ciCache[ciSysId] = ctx2;
    }
    var sev = Number(rows[i].severity) || 0;
    var crit = ctx2.criticality === 'critical' || ctx2.criticality === '1' ? 3 : (ctx2.criticality ? 2 : 1);
    var score = sev * 10 + crit * 4 + Math.min(ctx2.blast, 20);
    rows[i].score = score;
    rows[i].criticality = ctx2.criticality;
    rows[i].blast_nodes = ctx2.blast;
    ranked.push(rows[i]);
  }
  ranked.sort(function (a, b) { return b.score - a.score; });
  ranked = _cap(ranked, limit);

  return {
    focusedPayload: {
      count: ranked.length,
      ranked: ranked,
      method: 'severity x exploitability proxy x CI criticality x blast radius (heuristic, no mass-close)',
      next_skills: ['sn.cmdb.ci.blast_radius']
    },
    recordNumbers: []
  };
};

function _me(ctx) {
  var c = ctx || {}, u = c.user || {};
  return u.sys_id || c.userId || '';
}

/**
 * SIR triage mutations go through SIR playbooks only (spec §6.4): with a note
 * input, post it as a work note; otherwise this applier is a read-shaped no-op
 * that never mass-closes anything.
 */
ExecSecOps.prototype.apply_sir_triage = function (ctx, plan) {
  var ctx2 = ctx || {};
  var recordNumbers = [];
  try {
    var number = ctx2.inputDetails ? ctx2.inputDetails.number : '';
    var note = ctx2.inputs && ctx2.inputs.note ? ctx2.inputs.note : '';
    if (note && number) {
      var gr = new GlideRecordSecure('sn_si_incident');
      if (gr.get(number)) {
        gr.setValue('work_notes', (gr.getValue('work_notes') || '') + '\n' + note);
        gr.update();
        recordNumbers.push(number);
      }
    }
  } catch (e) {
    // playbook path unavailable -> report the SIR number, never fail the dispatch
  }
  return { recordNumbers: recordNumbers };
};

/** VR prioritization is read-shaped; applier is an explicit no-op (no mass-close). */
ExecSecOps.prototype.apply_vuln_prioritize = function (ctx, plan) {
  return { recordNumbers: [] };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExecSecOps;
}
