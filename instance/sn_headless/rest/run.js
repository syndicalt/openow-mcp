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

  var requestId = pathParam(request, 'requestId');
  var run = new Audit().findByRequestId(requestId);
  if (!run) {
    jsonOut(response, 404, { error: 'no run for request_id ' + requestId });
    return;
  }
  jsonOut(response, 200, run);
})(request, response);
