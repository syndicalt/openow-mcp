var SkillRuntime = (function () {
  /**
   * The skill runtime (spec §3.2 steps 3–7, §8.2): load contract, validate
   * inputs, gate roles, run planner/applier, enforce confirmation, audit.
   * Executes as the user (glide-record-secure semantics); BR/DP/flows fire in
   * the instance. The kernel is a client of this class via Scripted REST.
   */
  function SkillRuntime() {}

  var RAW_TABLES = ['incident', 'problem', 'change_request', 'cmdb_ci', 'kb_knowledge', 'hr_case', 'sn_si_incident'];
  var EXEC_DOMAINS = {
    'itsm': 'ExecITSM', 'itom': 'ExecITOM', 'cmdb': 'ExecCMDB', 'spm': 'ExecSPM',
    'csm': 'ExecCSM', 'hrsd': 'ExecHRSD', 'secops': 'ExecSecOps', 'platform': 'ExecPlatform',
    'kb': 'ExecKB', 'me': 'ExecMe', 'ops': 'ExecReport'
  };

  SkillRuntime.prototype.invoke = function (requestObj) {
    var started = new Date().getTime();
    requestObj = requestObj || {};
    var audit = new Audit();
    var gate = new ConfirmGate();
    var reqId = requestObj.requestId || ('req:' + new GlideSysId().getSysId());
    var storedRun = requestObj.requestId ? audit.findByRequestId(reqId) : null;
    var replay = storedRun && storedRun.outcome !== 'pending' ? gate.replay(storedRun) : null;
    if (replay) {
      return this.respond('ok_any', {
        outcome: replay.outcome,
        confirmation: 'read',
        auditId: replay.auditId,
        focusedPayload: replay.focusedPayload,
        message: replay.message || 'already handled',
        next: []
      });
    }

    var doc = this.loadDoc(requestObj.skillId);
    if (!doc) {
      return this.finish(audit, requestObj, started, {
        outcome: 'unsupported',
        confirmation: 'read',
        message: 'unknown skill ' + requestObj.skillId,
        tables: [], numbers: []
      }, {});
    }

    var validated = this.validateInputs(doc, requestObj.inputs || {});
    if (validated.error) {
      return this.finish(audit, requestObj, started, {
        outcome: 'error',
        confirmation: doc.confirmation,
        message: validated.error,
        missingFields: validated.missingFields,
        tables: doc.tablesRead, numbers: []
      }, {});
    }
    if (validated.missingFields.length > 0) {
      return this.finish(audit, requestObj, started, {
        outcome: 'error',
        confirmation: doc.confirmation,
        message: 'Missing required inputs',
        missingFields: validated.missingFields,
        tables: doc.tablesRead, numbers: []
      }, {});
    }

    var ac = new AuthContext();
    if (!this.rolesPass(ac, doc)) {
      var req = [];
      for (var i = 0; i < doc.rolesAnyOf.length; i++) { req.push(doc.rolesAnyOf[i]); }
      for (var j = 0; j < doc.rolesAllOf.length; j++) { req.push(doc.rolesAllOf[j]); }
      return this.finish(audit, requestObj, started, {
        outcome: 'denied',
        confirmation: doc.confirmation,
        message: 'Requires role(s): ' + req.join(', ') + ' — nothing was read or written',
        tables: doc.tablesRead, numbers: []
      }, {});
    }

    var exec = this.execFor(doc);
    if (!exec) {
      return this.finish(audit, requestObj, started, {
        outcome: 'unsupported',
        confirmation: doc.confirmation,
        message: 'executable ' + doc.executable.ref + ' not installed (feature/module missing?)',
        tables: doc.tablesRead, numbers: []
      }, {});
    }

    var ctx = this.makeCtx(doc);
    var planMethod = doc.executable.plan || this.methodName(doc.id, 'plan');
    if (typeof exec[planMethod] !== 'function') {
      return this.finish(audit, requestObj, started, {
        outcome: 'unsupported',
        confirmation: doc.confirmation,
        message: 'planner ' + planMethod + ' not implemented in ' + doc.executable.ref,
        tables: doc.tablesRead, numbers: []
      }, {});
    }
    var plan;
    try {
      plan = exec[planMethod](ctx, validated.values) || {};
    } catch (e) {
      return this.finish(audit, requestObj, started, {
        outcome: 'error',
        confirmation: doc.confirmation,
        message: e.getMessage ? e.getMessage() : String(e),
        tables: doc.tablesRead, numbers: []
      }, {});
    }
    if (plan.error) {
      return this.finish(audit, requestObj, started, {
        outcome: 'error',
        confirmation: doc.confirmation,
        message: plan.error,
        tables: doc.tablesRead, numbers: []
      }, { focusedPayload: plan.focusedPayload });
    }
    if (plan.missingFields && plan.missingFields.length > 0) {
      return this.finish(audit, requestObj, started, {
        outcome: 'error',
        confirmation: doc.confirmation,
        message: 'Missing required inputs',
        missingFields: plan.missingFields,
        tables: doc.tablesRead, numbers: []
      }, plan.focusedPayload || {});
    }

    var policy = doc.policy || {};
    var owned = plan.owned === true;
    var needConfirm = gate.shouldConfirm(doc.confirmation, requestObj, owned, policy);

    if (doc.confirmation === 'read' || !needConfirm) {
      if (doc.confirmation === 'read') {
        return this.finish(audit, requestObj, started, {
          outcome: 'ok',
          confirmation: 'read',
          tables: doc.tablesRead, numbers: plan.recordNumbers || []
        }, plan.focusedPayload || {});
      }
      return this.applyNow(audit, requestObj, started, doc, exec, plan, policy);
    }

    if (requestObj.confirm === true) {
      return this.applyNow(audit, requestObj, started, doc, exec, plan, policy);
    }

    return this.finish(audit, requestObj, started, {
      outcome: 'pending',
      confirmation: doc.confirmation,
      diff: plan.diff || [],
      draft: plan.draft || null,
      missingFields: plan.missingFields || [],
      tables: doc.tablesRead, numbers: []
    }, plan.focusedPayload || {}, doc);
  };

  SkillRuntime.prototype.applyNow = function (audit, requestObj, started, doc, exec, plan, policy) {
    var applyMethod = doc.executable.apply || this.methodName(doc.id, 'apply');
    var applied;
    try {
      applied = exec[applyMethod](this.makeCtx(doc), plan) || {};
    } catch (e) {
      return this.finish(audit, requestObj, started, {
        outcome: 'error',
        confirmation: doc.confirmation,
        message: e.getMessage ? e.getMessage() : String(e),
        tables: doc.tablesWritten, numbers: []
      }, plan.focusedPayload || {});
    }
    var numbers = applied.recordNumbers || plan.recordNumbers || [];
    var payload = {};
    var base = plan.focusedPayload || {};
    for (var k in base) { if (base.hasOwnProperty(k)) { payload[k] = base[k]; } }
    payload.record_numbers = numbers;
    return this.finish(audit, requestObj, started, {
      outcome: 'applied',
      confirmation: doc.confirmation,
      tables: doc.tablesWritten, numbers: numbers
    }, payload, doc);
  };

  SkillRuntime.prototype.rolesPass = function (ac, doc) {
    if (!ac.hasRoleAny(doc.rolesAnyOf)) { return false; }
    if (!ac.hasRoleAll(doc.rolesAllOf)) { return false; }
    return true;
  };

  SkillRuntime.prototype.finish = function (audit, requestObj, started, outcome, payload, doc) {
    var ms = new Date().getTime() - started;
    var run = {
      requestId: requestObj.requestId || ('req:' + new GlideSysId().getSysId()),
      skillId: requestObj.skillId || '',
      skillVersion: doc ? doc.version : '',
      clientApp: requestObj.clientApp || '',
      inputsHash: this.hashInputs(requestObj.inputs || {}),
      tablesTouched: outcome.tables || [],
      recordNumbers: outcome.numbers || [],
      outcome: outcome.outcome,
      error: outcome.message,
      latencyMs: ms,
      confirmed: outcome.outcome === 'applied',
      resultSummary: JSON.stringify(payload).slice(0, 4000)
    };
    var auditId = '';
    try {
      auditId = audit.write(run);
    } catch (e) {
      // audit is mandatory: a write failure is surfaced as an error outcome
      return {
        outcome: 'error',
        confirmation: outcome.confirmation || 'read',
        auditId: '',
        message: 'audit write failed: ' + (e.getMessage ? e.getMessage() : String(e)),
        error: 'audit write failed'
      };
    }
    var resp = {
      outcome: outcome.outcome,
      confirmation: outcome.confirmation || 'read',
      auditId: auditId,
      focusedPayload: payload || undefined,
      message: outcome.message || undefined,
      next: doc && doc.relatedSkills ? doc.relatedSkills : []
    };
    if (outcome.diff) { resp.diff = outcome.diff; }
    if (outcome.draft) { resp.draft = outcome.draft; }
    if (outcome.missingFields && outcome.missingFields.length > 0) { resp.missingFields = outcome.missingFields; }
    return resp;
  };

  SkillRuntime.prototype.respond = function (kind, resp) {
    return resp;
  };

  SkillRuntime.prototype.loadDoc = function (id) {
    if (!id) { return null; }
    var gr;
    try {
      gr = new GlideRecordSecure('sn_headless_skill');
      gr.addQuery('id', id);
      gr.addQuery('active', true);
      gr.setLimit(1);
      gr.query();
      if (!gr.next()) { return null; }
      return this.docFromRecord(gr);
    } catch (e) {
      return null;
    }
  };

  SkillRuntime.prototype.docFromRecord = function (gr) {
    var cls = gr.getValue('confirmation') || 'read';
    var doc = {
      id: gr.getValue('id'),
      name: gr.getValue('name'),
      version: gr.getValue('version') || '1.0.0',
      status: gr.getValue('status') || 'ga',
      persona: gr.getValue('persona') || '',
      intent: gr.getValue('intent') || '',
      inputs: this.parseJson(gr.getValue('inputs_json'), {}),
      tablesRead: this.split(gr.getValue('tables_read')),
      tablesWritten: this.split(gr.getValue('tables_written')),
      rolesAnyOf: this.split(gr.getValue('roles_any_of')),
      rolesAllOf: this.split(gr.getValue('roles_all_of')),
      confirmation: cls,
      procedure: this.splitLines(gr.getValue('procedure')),
      sideEffects: this.splitLines(gr.getValue('side_effects')),
      returns: this.parseJson(gr.getValue('returns_json'), []),
      relatedSkills: this.split(gr.getValue('related_skills')),
      executable: {
        type: gr.getValue('executable') || 'script_include',
        ref: gr.getValue('executable_ref') || ''
      },
      structuredInputs: gr.getValue('structured_inputs') === 'true' || gr.getValue('structured_inputs') === true,
      policy: this.policyFor(cls)
    };
    var full = this.parseJson(gr.getValue('doc_json'), null);
    if (full && full.executable) {
      doc.executable = full.executable;
      doc.policy = full.policy || doc.policy;
      doc.structuredInputs = full.structuredInputs === true;
      doc.relatedSkills = full.relatedSkills || doc.relatedSkills;
      doc.procedure = full.procedure || doc.procedure;
      doc.sideEffects = full.sideEffects || doc.sideEffects;
      doc.inputs = full.inputs || doc.inputs;
      doc.returns = full.returns || doc.returns;
      doc.priority = full.priority;
    } else {
      doc.executable.plan = this.methodName(doc.id, 'plan');
      doc.executable.apply = this.methodName(doc.id, 'apply');
    }
    return doc;
  };

  SkillRuntime.prototype.policyFor = function (cls) {
    if (cls === 'read') { return { requireDescribe: false }; }
    var p = { requireDescribe: true };
    if (cls === 'update_owned') { p.autoApply = true; }
    return p;
  };

  SkillRuntime.prototype.execFor = function (doc) {
    var ref = doc.executable.ref || EXEC_DOMAINS[doc.id.split('.')[1]] || '';
    var cls = null;
    try {
      cls = (typeof globalThis !== 'undefined') ? globalThis[ref] : null;
    } catch (e) {
      cls = null;
    }
    if (!cls && typeof window !== 'undefined') { cls = window[ref]; }
    if (!cls) { return null; }
    return new cls();
  };

  SkillRuntime.prototype.methodName = function (id, prefix) {
    var parts = id.split('.');
    return prefix + '_' + parts.slice(2).join('_');
  };

  SkillRuntime.prototype.makeCtx = function (doc) {
    var rr = new RecordResolver();
    var ac = new AuthContext();
    return {
      runtime: this,
      doc: doc,
      user: ac.currentUser(),
      userId: ac.userId(),
      resolveRecord: function (table, value) { return rr.resolveRecord(table, value); },
      findCi: function (input, classFilter) { return rr.findCi(input, classFilter); },
      blastRadius: function (sysId, depth) { return new BlastRadius().walk(sysId, depth); },
      now: function () { return new GlideDateTime(); }
    };
  };

  SkillRuntime.prototype.validateInputs = function (doc, inputs) {
    var spec = doc.inputs || {};
    // pass through all caller inputs (executables may accept documented keys the
    // registry spec does not list yet); validation only governs known spec keys
    var values = {};
    for (var k in inputs) {
      if (inputs.hasOwnProperty(k)) { values[k] = inputs[k]; }
    }
    var missing = [];
    for (var name in spec) {
      if (!spec.hasOwnProperty(name)) { continue; }
      var s = spec[name];
      var v = values[name];
      if (v === undefined || v === null || v === '') {
        if (s.default !== undefined && s.default !== null) {
          values[name] = s.default;
          continue;
        }
        if (s.required) { missing.push(name); }
        continue;
      }
      var err = this.typeError(name, s, v);
      if (err) { return { values: {}, missingFields: missing, error: err }; }
    }
    return { values: values, missingFields: missing, error: null };
  };

  SkillRuntime.prototype.typeError = function (name, spec, v) {
    switch (spec.type) {
      case 'int':
      case 'number':
        if (typeof v !== 'number' && !isFinite(Number(v))) { return name + ' must be a number'; }
        if (spec.min !== undefined && Number(v) < spec.min) { return name + ' must be >= ' + spec.min; }
        if (spec.max !== undefined && Number(v) > spec.max) { return name + ' must be <= ' + spec.max; }
        return null;
      case 'boolean':
        if (typeof v !== 'boolean' && v !== 'true' && v !== 'false') { return name + ' must be a boolean'; }
        return null;
      case 'enum':
        if (spec.enum && spec.enum.indexOf(String(v)) < 0) { return name + ' must be one of ' + spec.enum.join(', '); }
        return null;
      case 'array':
        if (!Array.isArray(v)) { return name + ' must be an array'; }
        return null;
      case 'object':
        if (typeof v !== 'object' || Array.isArray(v)) { return name + ' must be an object'; }
        return null;
      default:
        if (spec.maxLength && String(v).length > spec.maxLength) { return name + ' exceeds max length ' + spec.maxLength; }
        return null;
    }
  };

  SkillRuntime.prototype.discover = function (q, limit) {
    limit = limit || 10;
    if (limit > 25) { limit = 25; }
    var tokens = String(q || '').toLowerCase().split(/\s+/).filter(function (t) { return t.length > 1; });
    var scores = {};
    var kinds = {};
    var whys = {};
    var i;
    try {
      var idx = new GlideRecordSecure('sn_headless_index');
      if (tokens.length > 0) {
        idx.addQuery('term', 'IN', tokens.join(','));
      }
      idx.setLimit(400);
      idx.query();
      while (idx.next()) {
        var eid = idx.getValue('entity_id');
        var w = parseInt(idx.getValue('weight') || '1', 10) || 1;
        scores[eid] = (scores[eid] || 0) + w;
        kinds[eid] = idx.getValue('entity_type') === 'raw_op' ? 'raw_operation' : 'skill';
        whys[eid] = whys[eid] || ('discover index match on "' + q + '"');
      }
    } catch (e) {
      // index table empty/missing -> fall through to text scan
    }

    try {
      var skills = new GlideRecordSecure('sn_headless_skill');
      skills.addQuery('active', true);
      skills.setLimit(200);
      skills.query();
      while (skills.next()) {
        var id = skills.getValue('id');
        var hay = (id + ' ' + (skills.getValue('intent') || '') + ' ' + (skills.getValue('name') || '')).toLowerCase();
        var hits = 0;
        for (i = 0; i < tokens.length; i++) {
          if (hay.indexOf(tokens[i]) >= 0) { hits++; }
        }
        if (hits > 0 && hits > (scores[id] || 0)) {
          scores[id] = hits;
          kinds[id] = 'skill';
          whys[id] = whys[id] || ('intent keyword match on "' + q + '"');
        }
      }
    } catch (e) {
      // no skills table yet
    }

    var results = [];
    for (var rk in scores) {
      if (!scores.hasOwnProperty(rk)) { continue; }
      if (kinds[rk] === 'raw_operation') { continue; } // appended below with fixed reason
      results.push({ id: rk, kind: 'skill', score: scores[rk], why: whys[rk] || 'matched' });
    }
    results.sort(function (a, b) { return b.score - a.score; });
    results = results.slice(0, limit - RAW_TABLES.length < 0 ? limit : limit - RAW_TABLES.length);
    for (i = 0; i < RAW_TABLES.length; i++) {
      results.push({
        id: 'raw:' + RAW_TABLES[i],
        kind: 'raw_operation',
        score: 0.05,
        why: 'raw table fallback for ' + RAW_TABLES[i]
      });
    }
    // cap total
    return { results: results.slice(0, limit) };
  };

  SkillRuntime.prototype.hashInputs = function (inputs) {
    var canon = JSON.stringify(inputs);
    var h = 2166136261;
    for (var i = 0; i < canon.length; i++) {
      h ^= canon.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    var hex = h.toString(16);
    while (hex.length < 8) { hex = '0' + hex; }
    return hex;
  };

  SkillRuntime.prototype.parseJson = function (raw, fallback) {
    if (!raw) { return fallback; }
    try {
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  };

  SkillRuntime.prototype.split = function (raw) {
    if (!raw) { return []; }
    return String(raw).split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
  };

  SkillRuntime.prototype.splitLines = function (raw) {
    if (!raw) { return []; }
    return String(raw).split('\n').map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = SkillRuntime; }
  return SkillRuntime;
})();
