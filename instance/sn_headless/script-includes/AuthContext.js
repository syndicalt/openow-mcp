var AuthContext = (function () {
  /**
   * Identity for a dispatch: the invoking user, run-as-the-user only (spec §4.1).
   * No impersonation, no service accounts on the interactive path.
   */
  function AuthContext() {}

  AuthContext.prototype.currentUser = function () {
    var u = gs.getUser();
    var sysId = u.getID ? u.getID() : (u.getID || '');
    var title = '';
    var department = '';
    try {
      var rec = u.getRecord ? u.getRecord() : null;
      if (rec) {
        title = rec.getValue('title') || rec.getDisplayValue('title') || '';
        department = rec.getDisplayValue('department') || rec.getValue('department') || '';
      }
    } catch (eT) { title = title; }
    if (!title) {
      try {
        var gr = new GlideRecordSecure('sys_user');
        if (gr.get(sysId)) {
          title = gr.getValue('title') || '';
          if (!department) {
            department = gr.getDisplayValue('department') || gr.getValue('department') || '';
          }
        }
      } catch (eU) { /* ACL-honest: missing title stays empty */ }
    }
    return {
      sys_id: sysId,
      name: u.getName ? u.getName() : '',
      title: title,
      department: department,
      roles: this.roles()
    };
  };

  AuthContext.prototype.userId = function () {
    var u = gs.getUser();
    return u.getID ? u.getID() : '';
  };

  AuthContext.prototype.hasRoleAny = function (roles) {
    if (!roles || roles.length === 0) { return true; }
    for (var i = 0; i < roles.length; i++) {
      if (this.hasRole(roles[i])) { return true; }
    }
    return false;
  };

  AuthContext.prototype.hasRoleAll = function (roles) {
    if (!roles || roles.length === 0) { return true; }
    for (var i = 0; i < roles.length; i++) {
      if (!this.hasRole(roles[i])) { return false; }
    }
    return true;
  };

  AuthContext.prototype.hasRole = function (role) {
    try {
      return gs.hasRole(role);
    } catch (e) {
      return false;
    }
  };

  AuthContext.prototype.roles = function () {
    // Best effort: collect direct roles from sys_user_has_role.
    var out = [];
    try {
      var gr = new GlideRecordSecure('sys_user_has_role');
      gr.addQuery('user', this.userId());
      gr.addQuery('sys_user_role', '!=', '');
      gr.setLimit(200);
      gr.query();
      while (gr.next()) {
        var name = gr.getValue('sys_user_role.role.name') || gr.getValue('sys_user_role') || '';
        if (name && out.indexOf(name) < 0) { out.push(name); }
      }
    } catch (e) {
      // table or access unavailable -> role list empty; hasRole remains source of truth
    }
    return out;
  };

  /** HR/SecOps raw table access gate (spec §4.3): never user raw queries without roles. */
  AuthContext.prototype.canReadRaw = function (table) {
    if (table === 'hr_case') { return this.hasRoleAny(['sn_hr_core.case_writer', 'hr_admin']); }
    if (table === 'sn_si_incident') { return this.hasRoleAny(['sn_si.analyst', 'sn_si.admin']); }
    if (table === 'sn_vuln_vulnerable_item') { return this.hasRoleAny(['sn_vuln', 'sn_vuln.admin']); }
    return true;
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = AuthContext; }
  return AuthContext;
})();
