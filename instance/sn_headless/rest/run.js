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

  var requestId = pathParam(request, 'requestId');
  var run = new Audit().findByRequestId(requestId);
  if (!run) {
    jsonOut(response, 404, { error: 'no run for request_id ' + requestId });
    return;
  }
  jsonOut(response, 200, run);
})(request, response);
