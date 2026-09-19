(function process(request, response) {
  function jsonOut(resp, status, body) {
    resp.setStatus(status);
    resp.setContentType('application/json');
    resp.setBody(JSON.stringify(body));
  }
  function indexFor(doc) {
    var terms = [];
    var add = function (text) {
      if (!text) { return; }
      var parts = String(text).toLowerCase().split(/[^a-z0-9]+/);
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].length > 1 && terms.indexOf(parts[i]) < 0) { terms.push(parts[i]); }
      }
    };
    add(doc.id);
    add(doc.name);
    add(doc.intent);
    add((doc.tablesRead || []).join(' '));
    return terms;
  }

  if (!gs.hasRole('admin')) {
    jsonOut(response, 403, { error: 'import requires admin' });
    return;
  }

  try {
    var body = (function readJsonBody(request) {
      var b = request.body;
      if (b == null) { return {}; }
      if (typeof b === 'string') { return b ? JSON.parse(b) : {}; }
      var data = b.data;
      if (typeof data === 'string') { return data ? JSON.parse(data) : {}; }
      if (data && typeof data === 'object') { return data; }
      return typeof b === 'object' ? b : {};
    })(request);
    var skills = body.skills || [];
    var imported = 0;
    var failed = [];
    var runtime = new SkillRuntime();
    for (var i = 0; i < skills.length; i++) {
      var doc = skills[i];
      if (!doc || !doc.id) {
        failed.push({ id: String(doc && doc.id), error: 'missing id' });
        continue;
      }
      try {
        var gr = new GlideRecordSecure('sn_headless_skill');
        gr.addQuery('id', doc.id);
        gr.query();
        var exists = gr.next();
        if (!exists) {
          gr.initialize();
          gr.setValue('id', doc.id);
        }
        gr.setValue('name', doc.name || doc.id);
        gr.setValue('version', doc.version || '1.0.0');
        gr.setValue('status', doc.status || 'ga');
        gr.setValue('persona', doc.persona || '');
        gr.setValue('intent', doc.intent || '');
        gr.setValue('inputs_json', JSON.stringify(doc.inputs || {}));
        gr.setValue('tables_read', (doc.tablesRead || []).join(','));
        gr.setValue('tables_written', (doc.tablesWritten || []).join(','));
        gr.setValue('roles_any_of', (doc.rolesAnyOf || []).join(','));
        gr.setValue('roles_all_of', (doc.rolesAllOf || []).join(','));
        gr.setValue('confirmation', doc.confirmation || 'read');
        gr.setValue('procedure', (doc.procedure || []).join('\n'));
        gr.setValue('side_effects', (doc.sideEffects || []).join('\n'));
        gr.setValue('returns_json', JSON.stringify(doc.returns || []));
        gr.setValue('related_skills', (doc.relatedSkills || []).join(','));
        gr.setValue('executable', doc.executable ? doc.executable.type : 'script_include');
        gr.setValue('executable_ref', doc.executable ? doc.executable.ref : '');
        gr.setValue('doc_json', JSON.stringify(doc));
        gr.setValue('active', true);
        gr.setValue('doc_version', doc.version || '1.0.0');
        if (exists) { gr.update(); } else { gr.insert(); }

        // index rebuild for this entity
        var idx = new GlideRecordSecure('sn_headless_index');
        idx.addQuery('entity_id', doc.id);
        idx.deleteMultiple();
        var terms = indexFor(doc);
        for (var t = 0; t < terms.length; t++) {
          var row = new GlideRecordSecure('sn_headless_index');
          row.initialize();
          row.setValue('entity_type', 'skill');
          row.setValue('entity_id', doc.id);
          row.setValue('term', terms[t]);
          row.setValue('weight', 1);
          row.insert();
        }
        imported++;
      } catch (e) {
        failed.push({ id: doc.id, error: e.getMessage ? e.getMessage() : String(e) });
      }
    }
    jsonOut(response, 200, { imported: imported, failed: failed, total: skills.length });
  } catch (e) {
    jsonOut(response, 400, {
      error: e.getMessage ? e.getMessage() : String(e)
    });
  }
})(request, response);
