var QueryGuard = (function () {
  /**
   * Encoded-query hygiene (spec §4.3): the model's queries are hostile.
   * Allowlisted operators, no JS/GOTO, field allowlists, capped windows,
   * normalized + hashed for audit. Returns a rejected reason instead of
   * letting a bad query reach GlideRecord.
   */
  function QueryGuard() {}

  var OPERATORS = ['NOT IN', 'STARTSWITH', 'ENDSWITH', 'CONTAINS', 'BETWEEN', 'IN', 'LIKE', '<=', '>=', '!=', '=', '<', '>'];
  var DEFAULT_LIMIT = 25;
  var MAX_LIMIT = 100;

  QueryGuard.prototype.parse = function (raw, opts) {
    opts = opts || {};
    var limit = parseInt(opts.limit, 10);
    if (isNaN(limit)) { limit = DEFAULT_LIMIT; }
    if (limit > MAX_LIMIT) { limit = MAX_LIMIT; }
    if (limit < 1) { limit = 1; }
    var allowlist = opts.fieldAllowlist || null;

    if (!raw) {
      return { query: '', hash: this.hash(''), limit: limit, rejected: null, normalized: '' };
    }
    raw = String(raw).trim();
    if (raw.indexOf('JS:') >= 0) {
      return this.reject(raw, limit, 'JS: expressions are not allowed in encoded queries');
    }
    if (raw.indexOf('GOTO') >= 0) {
      return this.reject(raw, limit, 'GOTO is not supported');
    }
    if (!this.balanced(raw)) {
      return this.reject(raw, limit, 'unbalanced parentheses');
    }

    var parts = raw.split('^');
    var normalized = [];
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (part.length === 0) { continue; }
      var parsed = this.parsePart(part, allowlist);
      if (parsed.rejected) {
        return this.reject(raw, limit, parsed.rejected);
      }
      normalized.push(parsed.normalized);
    }
    var query = normalized.join('^');
    return { query: query, hash: this.hash(query), limit: limit, rejected: null, normalized: query };
  };

  QueryGuard.prototype.parsePart = function (part, allowlist) {
    for (var i = 0; i < OPERATORS.length; i++) {
      var op = OPERATORS[i];
      var idx = part.indexOf(op);
      if (idx > 0) {
        var field = part.substring(0, idx).trim();
        var value = part.substring(idx + op.length).trim();
        if (field.length === 0) { return { rejected: 'empty field in query part "' + part + '"' }; }
        if (allowlist && !this.fieldAllowed(field, allowlist)) {
          return { rejected: 'field "' + field + '" not in allowlist' };
        }
        return { normalized: field + ' ' + op + ' ' + value };
      }
    }
    // bare "field=value" without operator marker handled above; plain field -> equality
    if (part.indexOf('=') > 0) {
      var eq = part.split('=');
      var f = eq[0].trim();
      var v = part.substring(part.indexOf('=') + 1).trim();
      if (allowlist && !this.fieldAllowed(f, allowlist)) {
        return { rejected: 'field "' + f + '" not in allowlist' };
      }
      return { normalized: f + '=' + v };
    }
    return { rejected: 'unparseable query part "' + part + '"' };
  };

  QueryGuard.prototype.fieldAllowed = function (field, allowlist) {
    for (var i = 0; i < allowlist.length; i++) {
      if (allowlist[i] === field) { return true; }
    }
    // always-safe identity fields
    if (field === 'sys_id' || field === 'number' || field === 'sys_created_on') { return true; }
    return false;
  };

  QueryGuard.prototype.balanced = function (raw) {
    var depth = 0;
    for (var i = 0; i < raw.length; i++) {
      if (raw.charAt(i) === '(') { depth++; }
      if (raw.charAt(i) === ')') { depth--; }
      if (depth < 0) { return false; }
    }
    return depth === 0;
  };

  QueryGuard.prototype.reject = function (raw, limit, message) {
    return { query: null, hash: this.hash(raw), limit: limit, rejected: message, normalized: raw };
  };

  /** FNV-1a 32-bit hex — deterministic audit hash, no crypto dependency. */
  QueryGuard.prototype.hash = function (s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    var hex = h.toString(16);
    while (hex.length < 8) { hex = '0' + hex; }
    return hex;
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = QueryGuard; }
  return QueryGuard;
})();
