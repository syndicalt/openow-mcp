(function process(request, response) {
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
      op: body.op || '',
      args: body.args || {},
      clientApp: body.clientApp || '',
      requestId: body.requestId || '',
      dryRun: body.dryRun === true,
      confirm: body.confirm === true
    };
    var resp = new ToolkitService().invoke(req);
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
