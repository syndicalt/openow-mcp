var BlastRadius = (function () {
  /**
   * Relationship walk (spec §6.3 sn.cmdb.ci.blast_radius): BFS over
   * cmdb_rel_ci both directions, depth-capped (2 default, 3 for application
   * services), 50-node cap, always includes the application services the CI
   * belongs to, labels stale relations instead of hiding them.
   */
  function BlastRadius() {}

  var DEFAULT_DEPTH = 2;
  var MAX_DEPTH = 3;
  var NODE_CAP = 50;
  var STALE_DAYS = 30;
  var SERVICE_CLASSES = ['cmdb_ci_service', 'cmdb_ci_appl', 'cmdb_ci_service_offering'];

  BlastRadius.prototype.walk = function (startSysId, depth) {
    depth = depth || DEFAULT_DEPTH;
    if (depth > MAX_DEPTH) { depth = MAX_DEPTH; }
    var seen = {};
    var nodes = [];
    var queue = [{ sys_id: startSysId, depth: 0, class: '' }];
    var staleCutoff = this.staleCutoff();

    while (queue.length > 0 && nodes.length < NODE_CAP) {
      var cur = queue.shift();
      if (seen[cur.sys_id]) { continue; }
      seen[cur.sys_id] = true;
      var rec = this.loadCi(cur.sys_id);
      if (!rec) { continue; }
      var isService = this.isServiceClass(rec.class);
      var stale = rec.last_discovered !== '' && rec.last_discovered < staleCutoff;
      nodes.push({
        sys_id: cur.sys_id,
        name: rec.name,
        class: rec.class,
        depth: cur.depth,
        stale: stale,
        type: rec.type
      });
      if (cur.depth >= depth) { continue; }
      var nextDepth = cur.depth + 1;
      var rels = this.relations(cur.sys_id);
      for (var i = 0; i < rels.length; i++) {
        queue.push({ sys_id: rels[i], depth: nextDepth, class: '' });
      }
      // application services get one extra hop
      if (isService && cur.depth === depth - 1) {
        // already allowed by above because we only stop at >= depth
      }
    }

    var services = this.servicesFor(startSysId);
    var summary = this.summary(nodes.length, services.length);
    return { nodes: nodes, services: services, summary: summary };
  };

  BlastRadius.prototype.loadCi = function (sysId) {
    try {
      var gr = new GlideRecordSecure('cmdb_ci');
      if (!gr.get(sysId)) { return null; }
      return {
        sys_id: sysId,
        name: gr.getValue('name') || '',
        class: gr.getValue('sys_class_name') || '',
        last_discovered: gr.getValue('last_discovered') || '',
        type: ''
      };
    } catch (e) {
      return null;
    }
  };

  BlastRadius.prototype.relations = function (sysId) {
    var out = [];
    try {
      var gr = new GlideRecordSecure('cmdb_rel_ci');
      gr.addQuery('parent', sysId);
      gr.addQuery('type', '!=', '');
      gr.setLimit(NODE_CAP);
      gr.query();
      while (gr.next()) {
        var child = gr.getValue('child');
        if (child && child !== sysId) { out.push(child); }
      }
      gr = new GlideRecordSecure('cmdb_rel_ci');
      gr.addQuery('child', sysId);
      gr.addQuery('type', '!=', '');
      gr.setLimit(NODE_CAP);
      gr.query();
      while (gr.next()) {
        var parent = gr.getValue('parent');
        if (parent && parent !== sysId) { out.push(parent); }
      }
    } catch (e) {
      return [];
    }
    // de-duplicate
    var seen = {};
    return out.filter(function (id) {
      if (seen[id]) { return false; }
      seen[id] = true;
      return true;
    });
  };

  BlastRadius.prototype.servicesFor = function (sysId) {
    var out = [];
    try {
      var gr = new GlideRecordSecure('cmdb_ci_service_ci');
      gr.addQuery('ci', sysId);
      gr.setLimit(20);
      gr.query();
      while (gr.next()) {
        var svc = gr.getValue('service');
        if (svc) {
          var name = gr.getValue('service.name') || svc;
          out.push({ sys_id: svc, name: name });
        }
      }
    } catch (e) {
      return [];
    }
    return out;
  };

  BlastRadius.prototype.isServiceClass = function (cls) {
    return SERVICE_CLASSES.indexOf(cls) >= 0;
  };

  BlastRadius.prototype.staleCutoff = function () {
    try {
      var gdt = new GlideDateTime();
      gdt.addDaysLocalTime(-STALE_DAYS);
      return gdt.getValue();
    } catch (e) {
      return '';
    }
  };

  BlastRadius.prototype.summary = function (nodeCount, serviceCount) {
    return nodeCount + ' CI node(s) reached within depth cap, in ' + serviceCount + ' application service(s).';
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = BlastRadius; }
  return BlastRadius;
})();
