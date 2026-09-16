(function process(request, response) {
  function pathParam(req, key) {
    var ps = req.pathParams;
    if (ps && ps.get) { return ps.get(key); }
    if (ps && typeof ps === 'object') { return ps[key]; }
    return ps && ps[key] ? ps[key] : '';
  }
  function jsonOut(resp, status, body) {
    resp.setStatus(status);
    resp.setContentType('application/json');
    resp.setBody(JSON.stringify(body));
  }

  try {
    var raw = '';
    if (typeof request.body === 'string') {
      raw = request.body;
    } else if (request.body && request.body.data) {
      raw = request.body.data;
    }
    var body = {};
    if (raw && raw.length > 0) { body = JSON.parse(raw); }
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
