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
    var table = body.table || '';
    if (!new AuthContext().canReadRaw(table)) {
      jsonOut(response, 200, { exists: false, error: 'raw access on ' + table + ' requires role' });
      return;
    }
    var payload = new RawExecutor().execute({
      table: table,
      query: body.query || '',
      fields: body.fields,
      limit: body.limit || 25,
      aggregate: body.aggregate || '',
      groupBy: body.groupBy || '',
      orderBy: body.orderBy || ''
    });
    jsonOut(response, 200, payload);
  } catch (e) {
    jsonOut(response, 200, { error: e.getMessage ? e.getMessage() : String(e) });
  }
})(request, response);
