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
  function readJsonBody(request) {
    var b = request.body;
    if (b == null) { return {}; }
    if (typeof b === 'string') { return b ? JSON.parse(b) : {}; }
    var data = b.data;
    if (typeof data === 'string') { return data ? JSON.parse(data) : {}; }
    if (data && typeof data === 'object') { return data; }
    return typeof b === 'object' ? b : {};
  }

  try {
    var body = readJsonBody(request);
    var req = {
      skillId: body.skillId || pathParam(request, 'skillId'),
      inputs: body.inputs || {},
      clientApp: body.clientApp || '',
      requestId: body.requestId || '',
      dryRun: body.dryRun === true,
      confirm: body.confirm === true
    };
    var resp = new SkillRuntime().invoke(req);
    jsonOut(response, 200, resp);
  } catch (e) {
    jsonOut(response, 200, {
      outcome: 'error',
      confirmation: 'read',
      auditId: '',
      error: e.getMessage ? e.getMessage() : String(e)
    });
  }
})(request, response);
