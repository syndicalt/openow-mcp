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
    var body = {};
    if (raw && raw.length > 0) { body = JSON.parse(raw); }
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
