var ToolkitService = (function () {
  /**
   * The generated wide surface (spec §8.3, §10.2): metadata-driven table and
   * record operations behind the stable kernel tools. Zero hand-written
   * per-table glue; every op still runs through the trust boundary (requestId
   * idempotency, ConfirmGate, AuthContext raw-table gate, mandatory audit).
   *
   * Confirmation classes are fixed per op: read ops -> read;
   * record_create/attachment_add -> create; record_update -> update_shared;
   * record_delete -> restricted (always confirm, spec §4.4 "default deny on
   * delete").
   */
  function ToolkitService() {}

  function newSysId() {
    try {
      if (typeof gs !== 'undefined' && typeof gs.generateGUID === 'function') {
        return gs.generateGUID();
      }
    } catch (eG) {}
    try {
      if (typeof GlideSysId !== 'undefined') { return new GlideSysId().getSysId(); }
    } catch (eS) {}
    return String(new Date().getTime()) + '-' + Math.floor(Math.random() * 1e9);
  }

  var WRITE_CONFIRMATION = {
    record_create: 'create',
    record_update: 'update_shared',
    record_delete: 'restricted',
    attachment_add: 'create'
  };

  ToolkitService.prototype.invoke = function (reqObj) {
    reqObj = reqObj || {};
    var audit = new Audit();
    var gate = new ConfirmGate();
    var reqId = reqObj.requestId || ('tk:' + newSysId());
    var stored = reqObj.requestId ? audit.findByRequestId(reqId) : null;
    var replay = stored && stored.outcome !== 'pending' ? gate.replay(stored) : null;
    if (replay) {
      return {
        outcome: replay.outcome,
        confirmation: 'read',
        auditId: replay.auditId,
        focusedPayload: replay.focusedPayload,
        message: replay.message || 'already handled',
        next: []
      };
    }

    var started = new Date().getTime();
    var op = reqObj.op || '';
    var args = reqObj.args || {};

    if (!this.opSupported(op)) {
      return this.finish(audit, reqObj, started, {
        outcome: 'unsupported',
        confirmation: 'read',
        message: 'unknown toolkit op ' + op,
        tables: [], numbers: []
      }, {});
    }

    // restricted-table gate (spec §4.3): HR/SecOps never queried without roles
    var table = String(args.table || '');
    if (table && !new AuthContext().canReadRaw(table)) {
      return this.finish(audit, reqObj, started, {
        outcome: 'denied',
        confirmation: 'read',
        message: 'Requires role for raw access to ' + table,
        tables: [table], numbers: []
      }, {});
    }

    var confirmation = WRITE_CONFIRMATION[op] || 'read';
    var plan = this.run(op, args, { confirmation: confirmation, reqObj: reqObj });
    if (plan.error) {
      return this.finish(audit, reqObj, started, {
        outcome: 'error',
        confirmation: confirmation,
        message: plan.error,
        tables: [table], numbers: []
      }, {});
    }
    if (plan.denied) {
      return this.finish(audit, reqObj, started, {
        outcome: 'denied',
        confirmation: 'read',
        message: plan.message || 'denied',
        tables: [table], numbers: []
      }, {});
    }

    if (confirmation === 'read') {
      return this.finish(audit, reqObj, started, {
        outcome: 'ok',
        confirmation: 'read',
        tables: [table], numbers: plan.recordNumbers || []
      }, plan.payload || {});
    }

    if (reqObj.confirm !== true) {
      var pending = {
        outcome: 'pending',
        confirmation: confirmation,
        diff: plan.diff || [],
        draft: plan.draft || null,
        tables: [table], numbers: []
      };
      if (plan.payload) { pending.focusedPayload = plan.payload; }
      return this.finish(audit, reqObj, started, pending, plan.payload || {}, null);
    }

    var applied = this.apply(op, args);
    if (applied.error) {
      return this.finish(audit, reqObj, started, {
        outcome: 'error',
        confirmation: confirmation,
        message: applied.error,
        tables: [table], numbers: []
      }, {});
    }
    return this.finish(audit, reqObj, started, {
      outcome: 'applied',
      confirmation: confirmation,
      tables: [table], numbers: applied.recordNumbers || []
    }, applied.payload || {}, null);
  };

  ToolkitService.prototype.run = function (op, args) {
    switch (op) {
      case 'table_list': return this.planTableList(args);
      case 'table_schema': return this.planTableSchema(args);
      case 'record_get': return this.planRecordGet(args);
      case 'record_create': return this.planRecordCreate(args);
      case 'record_update': return this.planRecordUpdate(args);
      case 'record_delete': return this.planRecordDelete(args);
      case 'aggregate_report': return this.planAggregate(args);
      case 'run_script': return this.planRunScript(args);
      case 'attachment_list': return this.planAttachmentList(args);
      case 'attachment_add': return this.planAttachmentAdd(args);
      default: return { error: 'unknown op ' + op };
    }
  };

  ToolkitService.prototype.apply = function (op, args) {
    switch (op) {
      case 'record_create': return this.applyRecordCreate(args);
      case 'record_update': return this.applyRecordUpdate(args);
      case 'record_delete': return this.applyRecordDelete(args);
      case 'attachment_add': return this.applyAttachmentAdd(args);
      default: return { recordNumbers: [], payload: {} };
    }
  };

  ToolkitService.prototype.opSupported = function (op) {
    return this.run
      ? ['table_list', 'table_schema', 'record_get', 'record_create', 'record_update', 'record_delete', 'aggregate_report', 'run_script', 'attachment_list', 'attachment_add'].indexOf(op) >= 0
      : false;
  };

  /* ---------------- planners (no side effects) ---------------- */

  ToolkitService.prototype.planTableList = function (args) {
    var tables = [];
    try {
      var gr = new GlideRecordSecure('sys_db_object');
      var pattern = args.pattern || '';
      if (pattern) { gr.addQuery('name', 'CONTAINS', pattern); }
      gr.orderBy('name');
      gr.setLimit(args.limit > 0 ? Math.min(args.limit, 500) : 200);
      gr.query();
      while (gr.next()) {
        tables.push({
          name: gr.getValue('name'),
          label: gr.getValue('label') || gr.getValue('name'),
          extends: gr.getValue('super_class') || ''
        });
      }
    } catch (e) {
      return { error: e.getMessage ? e.getMessage() : String(e) };
    }
    return { payload: { count: tables.length, tables: tables } };
  };

  ToolkitService.prototype.planTableSchema = function (args) {
    var table = args.table || '';
    if (!table) { return { error: 'table is required' }; }
    if (!this.tableExists(table)) { return { error: 'table ' + table + ' not found' }; }
    var fields = [];
    try {
      var gr = new GlideRecordSecure('sys_dictionary');
      gr.addQuery('name', table);
      gr.addQuery('active', true);
      gr.orderBy('order');
      gr.setLimit(200);
      gr.query();
      while (gr.next()) {
        fields.push(this.fieldDef(gr));
      }
    } catch (e) {
      return { error: e.getMessage ? e.getMessage() : String(e) };
    }
    return { payload: { table: table, fields: fields } };
  };

  ToolkitService.prototype.fieldDef = function (gr) {
    var name = gr.getValue('name');
    var column = gr.getValue('element');
    return {
      name: column || name,
      label: gr.getValue('label') || column || name,
      type: gr.getValue('type') || '',
      max_length: parseInt(gr.getValue('max_length') || '0', 10) || undefined,
      reference: gr.getValue('reference') || undefined,
      mandatory: gr.getValue('mandatory') === 'true',
      read_only: gr.getValue('read_only') === 'true' || gr.getValue('readonly') === 'true',
      attributes: gr.getValue('attributes') || undefined
    };
  };

  ToolkitService.prototype.planRecordGet = function (args) {
    var resolved = this.resolve(args);
    if (resolved.error) { return { error: resolved.error }; }
    var fields = this.schemaFields(resolved.table);
    var record = { sys_id: resolved.sys_id, number: resolved.number };
    try {
      var gr = new GlideRecordSecure(resolved.table);
      if (gr.get(resolved.sys_id)) {
        var count = 0;
        for (var i = 0; i < fields.length && count < 80; i++) {
          var v = gr.getValue(fields[i]);
          if (v !== null && v !== '') {
            record[fields[i]] = v;
            count++;
          }
        }
        // guarantee the identity field is present even if filtered out
        record.number = record.number || gr.getValue('number') || resolved.number;
      }
    } catch (e) {
      return { error: e.getMessage ? e.getMessage() : String(e) };
    }
    return { payload: { table: resolved.table, record: record } };
  };

  ToolkitService.prototype.planRecordCreate = function (args) {
    var table = args.table || '';
    if (!table) { return { error: 'table is required' }; }
    if (!this.tableExists(table)) { return { error: 'table ' + table + ' not found' }; }
    var values = args.values || {};
    var draft = new ConfirmGate().buildDraft('Create ' + table + ' record', values);
    return { payload: { table: table }, draft: draft, recordNumbers: [] };
  };

  ToolkitService.prototype.planRecordUpdate = function (args) {
    var resolved = this.resolve(args);
    if (resolved.error) { return { error: resolved.error }; }
    var values = args.values || {};
    var diff = [];
    try {
      var gr = new GlideRecordSecure(resolved.table);
      gr.get(resolved.sys_id);
      diff = new ConfirmGate().buildDiff(gr, values);
    } catch (e) {
      return { error: e.getMessage ? e.getMessage() : String(e) };
    }
    if (diff.length === 0) {
      return { payload: { table: resolved.table, record: resolved.number, unchanged: true }, diff: [] };
    }
    return { payload: { table: resolved.table, record: resolved.number }, diff: diff, recordNumbers: [resolved.number] };
  };

  ToolkitService.prototype.planRecordDelete = function (args) {
    var resolved = this.resolve(args);
    if (resolved.error) { return { error: resolved.error }; }
    var draft = new ConfirmGate().buildDraft('Delete ' + resolved.table + ' ' + resolved.number, {});
    return { payload: { table: resolved.table, record: resolved.number }, draft: draft };
  };

  ToolkitService.prototype.planAggregate = function (args) {
    var executor = new RawExecutor();
    var payload = executor.execute({
      table: args.table || '',
      query: args.query || '',
      fields: args.fields,
      limit: args.limit || 200,
      aggregate: args.aggregate || '',
      groupBy: args.groupBy || ''
    });
    if (payload.error) { return { error: payload.error }; }
    if (payload.unsupported) { return { error: payload.error || 'aggregate not supported for ' + args.table }; }
    return { payload: payload };
  };

  ToolkitService.prototype.planRunScript = function (args) {
    var script = args.script || '';
    if (!script.trim()) { return { error: 'script is required' }; }
    var out = null;
    var error = null;
    try {
      var result = (0, eval)(script);
      if (result === undefined || result === null) {
        out = 'undefined';
      } else if (typeof result === 'object') {
        out = JSON.stringify(result);
      } else {
        out = String(result);
      }
    } catch (e) {
      error = e.getMessage ? e.getMessage() : String(e);
    }
    if (error) { return { error: 'script failed: ' + error }; }
    return { payload: { result: out.slice(0, 4000) } };
  };

  ToolkitService.prototype.planAttachmentList = function (args) {
    var resolved = this.resolve(args);
    if (resolved.error) { return { error: resolved.error }; }
    var attachments = [];
    try {
      var gr = new GlideRecordSecure('sys_attachment');
      gr.addQuery('table_name', resolved.table);
      gr.addQuery('table_sys_id', resolved.sys_id);
      gr.orderBy('file_name');
      gr.setLimit(50);
      gr.query();
      while (gr.next()) {
        attachments.push({
          sys_id: gr.getValue('sys_id'),
          file_name: gr.getValue('file_name'),
          content_type: gr.getValue('content_type') || '',
          size_bytes: parseInt(gr.getValue('size_bytes') || '0', 10) || 0
        });
      }
    } catch (e) {
      return { error: e.getMessage ? e.getMessage() : String(e) };
    }
    return { payload: { table: resolved.table, record: resolved.number, attachments: attachments } };
  };

  ToolkitService.prototype.planAttachmentAdd = function (args) {
    var resolved = this.resolve(args);
    if (resolved.error) { return { error: resolved.error }; }
    if (!args.file_name) { return { error: 'file_name is required' }; }
    var values = {
      table: resolved.table,
      record: resolved.number,
      file_name: args.file_name,
      content_type: args.content_type || 'application/octet-stream',
      size_bytes: args.content ? String(args.content).length : 0
    };
    var draft = new ConfirmGate().buildDraft('Attach ' + args.file_name + ' to ' + resolved.number, values);
    return { payload: { table: resolved.table, record: resolved.number }, draft: draft };
  };

  /* ---------------- appliers (real writes) ---------------- */

  ToolkitService.prototype.applyRecordCreate = function (args) {
    try {
      var gr = new GlideRecordSecure(args.table);
      gr.initialize();
      this.setValues(gr, args.values || {});
      var sysId = gr.insert();
      var number = gr.getValue('number') || sysId;
      return { recordNumbers: [number], payload: { table: args.table, record: number, sys_id: sysId } };
    } catch (e) {
      return { error: e.getMessage ? e.getMessage() : String(e) };
    }
  };

  ToolkitService.prototype.applyRecordUpdate = function (args) {
    var resolved = this.resolve(args);
    if (resolved.error) { return { error: resolved.error }; }
    try {
      var gr = new GlideRecordSecure(resolved.table);
      if (!gr.get(resolved.sys_id)) { return { error: resolved.table + ' ' + resolved.number + ' not found' }; }
      this.setValues(gr, args.values || {});
      gr.update();
      return { recordNumbers: [resolved.number], payload: { table: resolved.table, record: resolved.number } };
    } catch (e) {
      return { error: e.getMessage ? e.getMessage() : String(e) };
    }
  };

  ToolkitService.prototype.applyRecordDelete = function (args) {
    var resolved = this.resolve(args);
    if (resolved.error) { return { error: resolved.error }; }
    try {
      var gr = new GlideRecordSecure(resolved.table);
      if (gr.get(resolved.sys_id)) { gr.deleteRecord(); }
      return { recordNumbers: [resolved.number], payload: { table: resolved.table, record: resolved.number, deleted: true } };
    } catch (e) {
      return { error: e.getMessage ? e.getMessage() : String(e) };
    }
  };

  ToolkitService.prototype.applyAttachmentAdd = function (args) {
    var resolved = this.resolve(args);
    if (resolved.error) { return { error: resolved.error }; }
    try {
      var gr = new GlideRecordSecure('sys_attachment');
      gr.initialize();
      gr.setValue('table_name', resolved.table);
      gr.setValue('table_sys_id', resolved.sys_id);
      gr.setValue('file_name', args.file_name);
      gr.setValue('content_type', args.content_type || 'application/octet-stream');
      gr.setValue('size_bytes', args.content ? String(args.content).length : 0);
      var sysId = gr.insert();
      return { recordNumbers: [resolved.number], payload: { table: resolved.table, record: resolved.number, attachment_sys_id: sysId, file_name: args.file_name } };
    } catch (e) {
      return { error: e.getMessage ? e.getMessage() : String(e) };
    }
  };

  /* ---------------- helpers ---------------- */

  ToolkitService.prototype.setValues = function (gr, values) {
    for (var k in values) {
      if (!values.hasOwnProperty(k)) { continue; }
      if (k === 'sys_id' || k === 'sys_created_on') { continue; }
      gr.setValue(k, values[k]);
    }
  };

  ToolkitService.prototype.resolve = function (args) {
    var table = args.table || '';
    if (!table) { return { error: 'table is required' }; }
    var key = args.sys_id || args.number || args.record || '';
    var resolved = new RecordResolver().resolveRecord(table, key);
    if (!resolved) { return { error: table + ' ' + key + ' not found or not readable' }; }
    return { table: table, sys_id: resolved.sys_id, number: resolved.number };
  };

  ToolkitService.prototype.tableExists = function (table) {
    try {
      var gr = new GlideRecordSecure('sys_db_object');
      gr.addQuery('name', table);
      gr.setLimit(1);
      gr.query();
      return gr.next();
    } catch (e) {
      return true;
    }
  };

  ToolkitService.prototype.schemaFields = function (table) {
    var out = [];
    try {
      var gr = new GlideRecordSecure('sys_dictionary');
      gr.addQuery('name', table);
      gr.addQuery('active', true);
      gr.setLimit(120);
      gr.query();
      while (gr.next()) {
        var col = gr.getValue('element');
        if (col) { out.push(col); }
      }
    } catch (e) {
      return [];
    }
    return out;
  };

  ToolkitService.prototype.finish = function (audit, requestObj, started, outcome, payload, doc) {
    return new SkillRuntime().finish(audit, requestObj, started, outcome, payload, doc);
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = ToolkitService; }
  return ToolkitService;
})();
