(function process(request, response) {
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
    var body = raw ? JSON.parse(raw) : {};
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
