(function process(request, response) {
  function firstParam(map, key) {
    if (!map) { return ''; }
    var v;
    try {
      if (typeof map.get === 'function') { v = map.get(key); }
    } catch (e) { v = undefined; }
    if (v === undefined || v === null) {
      try { v = map[key]; } catch (e2) { v = undefined; }
    }
    if (v && typeof v.size === 'number' && typeof v.get === 'function') {
      v = v.size() > 0 ? v.get(0) : '';
    }
    if (Object.prototype.toString.call(v) === '[object Array]') { v = v[0]; }
    if (v === undefined || v === null) { return ''; }
    return String(v);
  }
  try {
    var q = firstParam(request.queryParams, 'q');
    var limit = parseInt(firstParam(request.queryParams, 'limit') || '10', 10) || 10;
    var results = new SkillRuntime().discover(q, limit);
    response.setStatus(200);
    response.setContentType('application/json');
    response.setBody(JSON.stringify({ results: results.results }));
  } catch (e) {
    response.setStatus(200);
    response.setContentType('application/json');
    response.setBody(JSON.stringify({ results: [], error: e.getMessage ? e.getMessage() : String(e) }));
  }
})(request, response);
