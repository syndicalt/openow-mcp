(function process(request, response) {
  try {
    var q = request.queryParams && request.queryParams.get ? request.queryParams.get('q') : '';
    var limit = parseInt((request.queryParams && request.queryParams.get ? request.queryParams.get('limit') : '10') || '10', 10) || 10;
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
