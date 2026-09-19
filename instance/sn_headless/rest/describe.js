(function process(request, response) {
  function pathParam(req, key) {
    var ps = req.pathParams;
    if (!ps) { return ''; }
    var v;
    try {
      if (typeof ps.get === 'function') { v = ps.get(key); }
    } catch (e) { v = undefined; }
    if (v === undefined || v === null) {
      try { v = ps[key]; } catch (e2) { v = undefined; }
    }
    if (v && typeof v.size === 'number' && typeof v.get === 'function') {
      v = v.size() > 0 ? v.get(0) : '';
    }
    if (Object.prototype.toString.call(v) === '[object Array]') { v = v[0]; }
    if (v === undefined || v === null) { return ''; }
    return String(v);
  }
  function jsonOut(resp, status, body) {
    resp.setStatus(status);
    resp.setContentType('application/json');
    resp.setBody(JSON.stringify(body));
  }

  try {
    var skillId = pathParam(request, 'skillId');
    var doc = new SkillRuntime().loadDoc(skillId);
    if (!doc) {
      jsonOut(response, 200, { doc: null, available: false, reason: 'unknown skill ' + skillId });
      return;
    }
    jsonOut(response, 200, { doc: doc, available: true });
  } catch (e) {
    jsonOut(response, 200, {
      doc: null,
      available: false,
      reason: e.getMessage ? e.getMessage() : String(e)
    });
  }
})(request, response);
