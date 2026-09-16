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
    var skillId = pathParam(request, 'skillId');
    var doc = new SkillRuntime().loadDoc(skillId);
    if (!doc) {
      jsonOut(response, 200, { doc: null, available: false, reason: 'unknown skill ' + skillId });
      return;
    }
    jsonOut(response, 200, { doc: doc, available: true });
  } catch (e) {
    jsonOut(response, 200, {
      doc: null,
      available: false,
      reason: e.getMessage ? e.getMessage() : String(e)
    });
  }
})(request, response);
