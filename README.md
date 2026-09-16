Open Now

Architecture and agent skills specification

A headless MCP interface for ServiceNow, modeled on Salesforce Claudeforce / Headless 360.

Allow any AI interface to leverage the ServiceNow data model, security model, workflows, and system of action — without a UI.



Headless Now

Architecture and agent skills specification

A headless MCP interface for ServiceNow, modeled on Salesforce Claudeforce / Headless 360.

Allow any AI interface to leverage the ServiceNow data model, security model, workflows, and system of action — without a UI.







Field



Value





Document type



Platform architecture + agent skill catalog





Audience



Platform architects, ServiceNow admins, AI platform owners, agent builders





Status



v1.0 · Design specification





Date



16 September 2026





Analogy



Claudeforce = Salesforce in Claude. Headless Now = ServiceNow in any MCP client.





Invariant



The AI client orchestrates. ServiceNow remains the governed system of action.



1. Executive summary

Claudeforce is not a chatbot bolted onto Salesforce. It is a three-layer bet: expose the whole platform headlessly over MCP (Headless 360), keep every read and write inside the existing permission and business-rule fabric (AIforce / Trust Layer), and ship prebuilt skills so the model does not improvise enterprise workflows from raw CRUD. Headless Now copies that bet onto ServiceNow.

ServiceNow already ships pieces of this stack. Out-of-the-box MCP servers for ITSM, ITOM, CMDB, and SPM went generally available on 10 September 2026. Zurich introduced MCP Server Console, a Universal MCP Client, a private MCP Registry, and AI Control Tower / AI Gateway. Action Fabric publishes Now Assist skills, Knowledge Graph queries, subflows, and scripted REST as MCP tools. What is missing — and what this document specifies — is the Claudeforce-shaped layer on top: a small, stable MCP tool surface that can reach the whole platform, a catalog of outcome-oriented agent skills that encode how work is actually done, and a contract that any interface (Claude, Copilot, Gemini, Grok, Slack, Teams, a custom agent, a CLI) can use without rebuilding domain logic or inventing a second security model.



The product thesis. Do not wrap the Table API and hope the model figures out CAB, major-incident protocol, or HR case confidentiality. Expose capabilities. Route every action through the Now Platform. Encode the work as skills. Let any client speak MCP.

1.1 What this is not





Not a second copy of ServiceNow data in a vector store. The instance is the system of record.



Not a service account that bypasses ACLs. Default run-as is the invoking user.



Not 400 MCP tools dumped into the model context. Tool surface stays small; action surface scales behind Discover / Describe / Dispatch and domain skills.



Not a replacement for Flow Designer, Business Rules, Data Policies, or CAB. Those stay on the platform and fire on every write.



Not Now Assist exclusive. Now Assist skills are one publisher into the same fabric, not the only consumer.

1.2 Claudeforce mapping







Claudeforce / Salesforce



Headless Now / ServiceNow





Headless 360



Headless Now Platform — data, metadata, Flow, BR, ACLs, CMDB as capabilities





AIforce harness



Action Fabric + MCP Server Console + AI Gateway





platform/headless-360 (4 tools)



now/headless — discover, describe, dispatch, dispatch_readonly





Salesforce in Claude plugin



Now in <client> plugin / connector (any MCP host)





37 prebuilt sales skills



Skill catalog in §6 — ITSM, ITOM, CMDB, SPM, CSM, HRSD, SecOps, Platform





External Client App + mcp_api scope



OAuth 2.0/2.1 app + per-user token; AI Control Tower approval





Trust Layer / FLS / sharing



ACLs + field ACLs + Domain Separation + Data Policies + Query ACLs





Data 360



CMDB + Service Graph + Knowledge Graph + Workflow Data Fabric





Agentforce / Atlas



Now Assist AI Agents + AI Agent Studio + A2A





MuleSoft Agent Fabric



Integration Hub + Action Fabric + MID + Flow



2. Design principles





The platform is the authority. Business Rules, Data Policies, UI Policies that have server counterparts, Flow Designer, Approval Engine, Assignment Rules, SLA engine, Domain Separation, and ACLs execute on every mutating call. The MCP layer never reimplements them.



Run as the user, by default. Inbound MCP uses the authenticated human's session. GlideRecordSecure semantics. An optional AI user (Zurich+) is an explicit, audited exception for unattended agents — never the silent default.



Skills over endpoints. A skill is a named, versioned procedure with intent, required context, allowed writes, confirmation policy, and rollback notes. Raw table access is a fallback for builders, not the path for operators.



Four tools, not four thousand. Clone Headless 360's discover → describe → dispatch loop so the model context stays small while the operation catalog grows. Domain MCP servers (ITSM, CMDB, …) remain as curated fast-paths for high-frequency jobs.



Confirm writes that leave the trust boundary. Internal work notes and field updates on records the user already owns can auto-apply under policy. External comms, CAB-bound changes, HR/SecOps restricted tables, deletes, and ACL/script deploys require explicit confirmation.



Any interface, one contract. The MCP server is the product. Claude, Copilot, Gemini, Grok, Slack, Teams, Service Portal, a CLI, or a custom agent are clients. Do not special-case a single model vendor in the platform layer.



Observability is a feature. Every dispatch writes an audit line: actor, skill, tables, sys_ids, encoded query hash, token app, result. AI Gateway is the control plane for inventory, approval, pause, and revoke.



3. Architecture

3.1 Four layers







Layer



Responsibility



ServiceNow native surface





System of record



Tables, CMDB, attachments, Knowledge, metric data



Now Platform DB, Service Graph, Workflow Data Fabric





System of logic



ACLs, BR, Data Policy, Flow, Decision Tables, Assignment, SLA



Glide, Flow Designer, Decision Builder





System of action



Skills, domain MCP servers, Scripted REST, subflows, Now Assist skills



Action Fabric, MCP Server Console





System of interface



Any MCP client; optional generative UI assembled by the client



Not owned by ServiceNow — that is the point

This is the Headless 360 four-layer idea translated onto Now. Data and logic do not move. Interfaces multiply. The MCP server is inbound access into ServiceNow. Outbound the other way — ServiceNow agents calling external MCP servers — is the Universal MCP Client, out of scope for the skill catalog but in scope for the same AI Gateway.

3.2 Runtime path

A request from any client follows one path. Permission checks happen in the instance, not in the model.







Step



Component



What happens





1. Authenticate



OAuth 2.0/2.1 + PKCE



User signs in with their IdP. Token is bound to that sys_user. No shared integration user on the interactive path.





2. Authorize client



AI Gateway / AICT



Is this MCP client approved? Is this server card Active? Can this user invoke it?





3. Select skill or discover



now/headless or domain server



Named skill (sn.itsm.incident.triage) or semantic discover across the operation index.





4. Describe



Skill registry



Contract: inputs, tables, required roles, side effects, confirmation policy.





5. Dispatch



Skill runtime



Executes as the user. Uses GlideRecordSecure / scoped APIs / published Flow actions. BR, DP, approvals fire.





6. Audit + observe



syslog, AI Gateway, skill_run



Record actor, skill version, record numbers, latency, tokens-in-tool, success/fail.





7. Return focused context



MCP result



Numbers, sys_ids, display values, next recommended skill — not raw table dumps.

3.3 Two MCP surfaces, one platform

Claudeforce's insight is that a giant tool list collapses under its own descriptions. Headless Now therefore exposes two complementary surfaces, both governed the same way.

Surface A — now/headless (platform kernel)

Four tools. Stable. Used by builders, coding agents, and any skill whose operation is not yet curated.







Tool



Role



Notes





discover



Semantic search over the operation + skill index



Query is the agent's restatement of user intent. Returns ranked skill IDs and raw operations with score and short why.





describe



Return the technical contract



Inputs, encoded-query hints, required roles, side-effect class (read / update / create / approve / execute / deploy), confirmation policy, related skills.





dispatch_readonly



GET-equivalent only



Queries, aggregates, schema, relationship walks, KB search. Never mutates. Prefer this whenever the skill is read-shaped.





dispatch



Invoke the skill or operation



Enforces confirmation policy. Rejects if describe was skipped for write-class operations (configurable).

Surface B — domain MCP servers (fast paths)

Keep and extend ServiceNow's GA servers. They win on token cost for the jobs they were benchmarked on (ITSM change work: ~52% lower client cost and ~6.5× fewer output tokens versus raw Table API in ServiceNow's July 2026 11-prompt test). Domain servers are opinionated wrappers that internally call the same skill runtime.







Server



Jobs it exists to finish





sn.itsm



Incidents, problems, changes, requests, major incident, walk-up, SLA





sn.itom



EM alerts, service impact, health logs, related incidents, next operational step





sn.cmdb



CI find, relationship walk, blast radius, identification/reconciliation status, service mapping





sn.spm



Goals, portfolio plans, projects, milestones, demand, resource, delivery health





sn.csm



Cases, accounts, entitlements, major case, playbooks





sn.hrsd



HR cases (restricted), LE activities, knowledge — extra confirmation + HR roles





sn.secops



SIR, VR, watchlist — extra confirmation + sn_si / sn_vuln roles





sn.platform



Update sets, ATF, Flow, Script Includes, ACLs — builder surface, never default for operators

3.4 Skill runtime versus Table API

A skill may internally use Table API, Aggregate API, Attachment API, Import Set API, CMDB Identification/Reconciliation Engine, Knowledge Graph, or a published Flow action. Callers never choose the API. That is how you stop the model from writing state = 6 on a change that still has open tasks, or from querying hr_case with a broad encoded query a user should not see even if a sloppy ACL would allow the table list.



Implementation rule. Inside skill scripts, use GlideRecordSecure and queries that the current user can satisfy. Never elevate with gs.getSession().impersonate() unless the skill is explicitly typed unattended and bound to a named AI user with role-masking. Never disable query ACLs for convenience.



4. Security and identity model

4.1 Identity patterns







Pattern



When to use



Risk





Interactive / on-behalf-of (default)



Human in Claude, Copilot, Slack, Grok talking to Now



Lowest. ACLs = the user's ACLs. Full audit to a named person.





AI user + role-masking (Zurich+)



Unattended agents, scheduled watchers, A2A specialists



Medium. Roles are a declared subset. Must be an explicit AI user record, not a recycled integration account.





Integration user / client-credentials



Break-glass batch only



High. Claudeforce's Slack Tag path uses this and it is the wrong default. Ban it for Headless Now interactive clients.

Mirror Salesforce Hosted MCP: per-user OAuth through an application registry entry, not a shared password. Refresh tokens rotate. The MCP server never stores IdP passwords. The ServiceNow MCP Registry stores Server Cards (metadata only) — never secrets.

4.2 What must be enforced on every call





REST / MCP endpoint ACL (the Table API ACL if raw tables are used; prefer keeping it locked and going through skills).



Table ACL for the operation (read, write, create, delete, report).



Field ACL, including query-field ACL when glide.export.query.enforce_field_acl is true — leave it true.



Query ACLs / before-query Business Rules. Encoded queries from the model are untrusted input.



Domain Separation and Before Query filters for MSP / HR / legal entities.



Data Policies and server-side UI Policy equivalents (mandatory fields, read-only when state is closed).



Data Lookup / Assignment Rules / SLA start on insert.



Approval Engine and Flow Designer — a skill may request approval; it may not forge approval_id.



IP Access Control, Adaptive Authentication, and Explicit Roles (snc_internal / snc_external) where enabled.



PII Vault / sensitive data policies via AI Gateway when the skill returns fields tagged personal.

4.3 Encoded query hygiene

The model will invent encoded queries. Treat them as hostile.





Parse and allowlist operators. Reject JS, GOTO, and subqueries that walk unexpected tables.



Rewrite display-value searches (number=INC0010045) to sys_id after a privileged-safe resolver that itself uses GlideRecordSecure.



Cap result windows (default 25, hard max 100) and force field allowlists per skill rather than sysparm_fields=*.



Never accept sysparm_query from the client on restricted tables (hr_case, sn_si_incident, sys_user with PII fields). Skills on those tables take structured inputs only.



Log the normalized query, not just the raw string.

4.4 Confirmation policy classes







Class



Examples



Client behavior





read



Get incident, walk CI relations, KB search



No confirm. Return focused payload.





update_owned



Work note on assigned incident, close after resolution notes



Optional silent apply if policy allows; otherwise show diff.





update_shared



Reassign group, change priority, add CAB date



Always show proposed field diff. Wait for user yes.





create



Open incident, submit catalog request, draft change



Show draft record. Wait for yes. Return number.





approve



Approve change, request, HR case



Show record + policy. Dual-confirm. Never batch-approve silently.





execute



Run a Flow, execute a scripted action, kick Discovery



Describe side effects. Wait for yes.





deploy



Commit update set, publish Flow, modify ACL



Sandbox-first. Production requires a second person or change request link.





restricted



HR, SecOps, Legal, any delete



Skill available only if role present. Always confirm. Default deny on delete.

4.5 What the model must never do





Impersonate another user to "see what they see".



Disable Business Rules with setWorkflow(false) except inside a named, reviewed skill that documents why (e.g., a data fix with its own change record).



Write directly to sys_audit, sysevent in lieu of proper APIs, or sys_user_has_role.



Dump sys_user passwords, password-reset answers, or attachment binaries of HR cases into the client context.



Follow a user instruction to ignore ACLs. If the instance returns 403, explain the denial and stop.



5. Skill specification format

Every skill is a versioned document plus an executable. The document is what MCP describe returns. The executable is a Flow action, Script Include, Now Assist skill, or server-side code running in the skill runtime. Clients should treat the document as the source of truth and not cache field lists across versions.

5.1 Required fields







Field



Purpose





id



Stable dotted id. sn.<domain>.<object>.<verb> e.g. sn.itsm.change.assess_risk





name / version / status



Human name, semver, draft | ga | deprecated





persona



Who this is for (fulfiller, requester, CAB, SRE, HR agent, builder)





intent



One paragraph. What job finishes when this skill succeeds.





inputs



Named, typed, required vs optional. Prefer record numbers over sys_ids at the client edge.





tables_read / tables_written



Explicit. Used by AI Gateway data-class policies.





roles_any_of / roles_all_of



Checked before dispatch in addition to ACLs.





confirmation



One of the classes in §4.4





procedure



Ordered steps the runtime (or the model, if composing) must follow





side_effects



Approvals started, events fired, notifications that will go out





returns



Shape of the focused payload





related_skills



Next likely skills. Enables multi-step work without rediscovery.





eval



Golden prompts + expected tool sequence. Used to stop regressions.

5.2 Skill versus prompt

A prompt template is not a skill. Salesforce's claim about the 37 sales skills is the right bar even if marketing overreaches: a skill encodes which of two overlapping fields to trust, what "healthy" means, which related lists matter, and which writes are in bounds. If two fulfillers running the same skill on the same incident would get different field updates because the model improvised, the skill is unfinished.



6. Skill catalog

This catalog is the Claudeforce 37-skill analog for ServiceNow. It is organized by domain. Priority 1 skills are the ones to implement first — they cover the work that already has official domain MCP coverage and the highest ticket volume. Priority 2 extends into CSM, HRSD, SecOps, and platform building. Each skill below is specified at a level an implementation team can execute against.

6.1 Catalog index







ID



Skill



P



Confirm





sn.itsm.shift.briefing



Shift start / queue briefing



1



read





sn.itsm.incident.triage



Triage a new or assigned incident



1



update_shared





sn.itsm.incident.similar



Find similar incidents and known errors



1



read





sn.itsm.incident.update



Add work notes / comments / resolve



1



update_owned





sn.itsm.incident.major



Declare or run major incident



1



update_shared





sn.itsm.problem.open



Open problem from incident cluster



1



create





sn.itsm.change.draft



Draft a change from a template



1



create





sn.itsm.change.assess_risk



Risk, conflict, CI collision



1



read





sn.itsm.change.cab_prep



CAB packet for a change



1



read





sn.itsm.change.implement



Move a change through implement/review



1



update_shared





sn.itsm.request.submit



Submit catalog item / order guide



1



create





sn.itsm.request.fulfill



Fulfill or approve a request



1



approve





sn.itsm.sla.at_risk



SLA / OLA at-risk board



1



read





sn.itom.alert.triage



Alert to service impact



1



read





sn.itom.alert.correlate



Correlate alerts to incident / CI



1



update_shared





sn.cmdb.ci.find



Find a CI with identification context



1



read





sn.cmdb.ci.blast_radius



Relationship walk / blast radius



1



read





sn.cmdb.service.health



Application service health snapshot



1



read





sn.spm.portfolio.status



Portfolio / goal / milestone status



1



read





sn.spm.project.prep



Project status / RAID prep



2



read





sn.csm.case.briefing



Account + case briefing



2



read





sn.csm.case.update



Update or escalate a case



2



update_owned





sn.hrsd.case.handle



Handle an HR case (restricted)



2



restricted





sn.secops.sir.triage



Security incident triage



2



restricted





sn.secops.vuln.prioritize



VR prioritization with CMDB



2



restricted





sn.kb.answer



Answer from Knowledge + catalog



1



read





sn.me.work



My work, approvals, watches



1



read





sn.platform.schema.describe



Describe a table / field / ACL



2



read





sn.platform.update_set.review



Review an update set



2



read





sn.platform.flow.run



Run a published Flow / action



2



execute





sn.platform.script.impact



Impact analysis before a change



2



read





sn.ops.report.aggregate



Safe aggregate / PA snapshot



1



read

6.2 Priority 1 skill cards — ITSM

sn.itsm.shift.briefing — Shift start / queue briefing

Persona. Fulfiller, manager. Tables. incident, task_sla, sys_user_grmember, cmdb_ci.

Intent. Give the user a plan for the next shift: what aged overnight, what is at risk against SLA, what is unassigned in their groups, what major incidents are open, what changes go live today that touch CIs they support.

Procedure





Resolve the user's groups via sys_user_grmember. Do not trust a group name typed in chat without resolving it.



Query open incidents where assignment_group IN those groups OR assigned_to = me. Fields: number, short_description, priority, state, assigned_to, assignment_group, cmdb_ci, SLA due.



Join task_sla where has_breached = false and business_percentage >= 75. Sort by time-to-breach.



List changes in implement or scheduled for today whose CIs intersect the user's support CIs (use sn.cmdb.ci.blast_radius internally if needed).



Return a briefing object: at_risk[], unassigned[], mine[], majors[], changes_today[], recommended first three actions.

Writes. None. Guards. read. Cap 25 per list. No PII beyond caller display name.

sn.itsm.incident.triage — Triage a new or assigned incident

Persona. Fulfiller. Tables. incident, cmdb_ci, incident–problem relation, kb_knowledge.

Intent. Take an incident from New / unclassified to a correctly categorized, prioritized, assigned, CI-linked record with an initial work note.

Procedure





Load the incident by number. If 403, stop and say so.



Run sn.itsm.incident.similar and sn.kb.answer against short_description + description + CI class.



If the caller provided a hostname or service name, run sn.cmdb.ci.find. Propose cmdb_ci, business_service, assignment_group from CI support group — do not overwrite a human assignment without confirm.



Propose category, subcategory, impact, urgency (hence priority), assignment_group. Show the diff.



On confirm, patch only the proposed fields and insert a work note that cites similar tickets and the CI match method (name / serial / reconciliation id).

Writes. Incident fields listed in the diff + work_notes. Guards. update_shared. Never set state to Resolved here. Never change caller_id.

sn.itsm.incident.similar — Find similar incidents and known errors

Persona. Fulfiller. Tables. incident, problem, kb_knowledge, cmdb_ci.

Intent. Return the smallest set of prior records that would change what a fulfiller does next.

Procedure





Inputs: incident number or free text + optional CI.



Search open and recent-closed incidents by CI first, then by short_description keywords, then by assignment group. Prefer same cmdb_ci over text similarity.



Search problem where known_error = true and CI or related CI matches.



Search published kb_knowledge in the IT knowledge base; drop retired articles.



Return top 5 incidents, top 3 problems, top 3 articles, each with a one-line why-it-matched. No full description dumps.

Writes. None. Guards. read.

sn.itsm.incident.update — Add work notes, comments, or resolve

Persona. Fulfiller. Tables. incident.

Intent. The everyday mutation path. Keep it boring and strict so the model does not invent state transitions.

Procedure





Load by number. Confirm the user can write.



Mode comment: writes comments (customer visible). Mode work_note: writes work_notes. Mode resolve: requires resolution_code + resolution_notes; sets state to Resolved only if Data Policy allows (no open children, required fields present).



Refuse close from this skill. Close is a separate manager path or a Flow.



Show the exact string that will be posted. On confirm, patch.



Return new state, journal snippet, remaining SLA.

Writes. comments or work_notes; on resolve also state, resolved_at, resolution_*. Guards. update_owned for notes on assigned records; update_shared for resolve or for records not assigned to the user.

sn.itsm.incident.major — Declare or run a major incident

Persona. Major incident manager. Tables. incident, service m2m, sys_user_group.

Intent. Promote an incident onto the major-incident process with the right comms group and affected services — without letting the model invent a parallel process.

Procedure





Require major_incident_manager (or customer-equivalent) role.



If declaring: set major_incident_state per the customer's process (often Proposed → Accepted). Do not invent custom states.



Attach affected application services from sn.cmdb.ci.blast_radius.



Propose communication channel / incident task for comms. Do not email outside the instance unless a published Flow action exists for that.



Return the MIM dashboard payload: severity, services, last update, next comms time.

Writes. Major incident fields + related service m2m. Guards. update_shared. Customer-visible comms always confirm.

sn.itsm.problem.open — Open a problem from an incident cluster

Persona. Problem coordinator. Tables. problem, incident, cmdb_ci.

Intent. Create a problem that actually links the cluster rather than a duplicate empty problem.

Procedure





Input: one or more incident numbers. Load them; abort if they do not share a plausible CI or symptom.



Draft problem: short_description from the cluster, cmdb_ci from majority CI, first_reported_by_task = oldest incident.



On confirm, insert problem and set incident.problem_id on each. Work note on each incident.



Do not set known_error or workaround in this skill; that is a later update.

Writes. Problem insert; incident.problem_id; work notes. Guards. create.

sn.itsm.change.draft — Draft a change from a template

Persona. Change requester / implementer. Tables. change_request, change_task, task_ci, standard-change producers.

Intent. Open a change the CAB will not bounce for missing fields. Prefer standard changes when a template matches.

Procedure





Classify type: standard if a published standard-change template matches the stated work; otherwise normal. Emergency is a separate, role-gated skill path.



Resolve CIs via sn.cmdb.ci.find. Require at least one CI for anything that is not a documentation-only change.



Fill planned start/end from the maintenance window on the CI or service offering if present.



Copy template implementation / backout / test plans. Mark them as template-sourced so a human edits them.



On confirm, insert change_request, task_ci, and template change_task records. Return number and a missing-field list the user must still complete.

Writes. change_request, task_ci, change_task. Guards. create. Never auto-submit for approval from this skill.

sn.itsm.change.assess_risk — Assess risk, schedule conflict, CI collision

Persona. Change implementer, CAB. Tables. change_request, task_ci, cmdb_rel_ci, peer changes.

Intent. The skill ServiceNow already called out as the MCP-vs-Table-API showcase. Return a verdict a CAB member can use.

Procedure





Load the change and its CIs. Walk one hop of cmdb_rel_ci plus application service membership (sn.cmdb.ci.blast_radius).



Find overlapping changes: planned start/end overlap AND intersecting CI set (including parents/services).



Run the customer's risk calculator if it is a published API / Flow; otherwise apply the documented matrix (impact × probability × type) and label it heuristic.



Flag missing backout plan, missing test plan, implementer not in support group, blackout window violations.



Return: risk_level, conflicts[], missing_fields[], ci_blast_count, recommendation (ready / not ready / needs CAB discussion).

Writes. None by default. Optional: write risk field if the customer risk engine is the platform one and policy allows. Guards. read (default).

sn.itsm.change.cab_prep — Prepare a CAB packet

Persona. Change manager. Tables. change_request, change_task, sysapproval_approver, task_ci.

Intent. One artifact a CAB chair can open: the change, its conflicts, approvals outstanding, implementation plan, and who speaks.

Procedure





Input: CAB agenda date or a list of change numbers.



For each change run sn.itsm.change.assess_risk.



List open approvals and change tasks not Closed.



Return a packet object suitable for generative UI or a slide export. Do not invent attendance.

Writes. None. Guards. read.

sn.itsm.change.implement — Move a change through implement / review

Persona. Change implementer. Tables. change_request, change_task.

Intent. Advance a scheduled change through implementation and review using the platform state model, not invented states.

Procedure





Load by number. Confirm type and current state allow the requested transition.



Require open change tasks to be addressed before Review / Closed.



On implement: set state per process, stamp actual start, add work note.



On review close: require close codes the Data Policy expects.



Never skip CAB-required approval just because the window has started.

Writes. Change state, actual times, work notes, task states. Guards. update_shared.

sn.itsm.request.submit — Submit a catalog item or order guide

Persona. Requester or fulfiller-on-behalf. Tables. sc_cat_item, cart, sc_req_item, variable definitions.

Intent. Submit through the catalog engine so variables, price, approvals, and request flows fire. Never insert sc_req_item by hand.

Procedure





Resolve the item by name or sys_id against active sc_cat_item the user can see (catalog user criteria).



Describe the variable set. Collect values. Reject unknown variable names.



If the item is a record producer, call the producer API, not the cart, unless the customer standard is cart-only.



On confirm, submit via Service Catalog API / Flow. Return RITM and REQ numbers and the approval expectation.

Writes. Via catalog engine only. Guards. create. On-behalf-of requires the catalog on-behalf role and an explicit requested_for.

sn.itsm.request.fulfill — Fulfill or approve a request

Persona. Approver or fulfiller. Tables. sc_request, sc_req_item, sysapproval_approver.

Intent. Approve or fulfill through the approval and request engines.

Procedure





Load REQ/RITM by number. Show variables, price, requested_for, policy.



Approve / reject via Approval Engine only. Never patch approval state.



Fulfill only fields and catalog tasks the item's flow expects.

Writes. Approval engine; fulfiller fields on RITM/tasks. Guards. approve.

sn.itsm.sla.at_risk — SLA / OLA at-risk board

Persona. Fulfiller, manager. Tables. task_sla, incident, sc_req_item.

Intent. Show work that will breach soon in the user's scope.

Procedure





Filter task_sla on active, not breached, business_percentage >= 75, task in user's groups or assigned to user.



Return number, type, percentage, planned end, assigned to.



Cap 25. Link each row to the matching domain skill.

Writes. None. Guards. read.

6.3 Priority 1 skill cards — ITOM, CMDB, SPM, Knowledge, Me

sn.itom.alert.triage — Alert to service impact

Persona. SRE / operations. Tables. em_alert, em_impact, cmdb_ci, incident.

Intent. Turn an Event Management alert into: what service is hurt, whether an incident already exists, and the next operational step.

Procedure





Load em_alert by number or sys_id. Include message_key, severity, CI, metric.



Read impact tree / em_impact if licensed; otherwise approximate via sn.cmdb.ci.blast_radius from the alert CI.



Find open incidents on the same CI or service in the last 24 hours.



Recommend: acknowledge, correlate into existing incident, or open new incident via sn.itsm.incident.triage.



Do not auto-close alerts from this skill.

Writes. None unless the user confirms acknowledge. Guards. read; acknowledge is update_shared.

sn.itom.alert.correlate — Correlate alerts to incident / CI

Persona. SRE / operations. Tables. em_alert, incident, cmdb_ci.

Intent. Bind an alert to the correct CI and open incident without creating duplicates.

Procedure





Resolve CI with sn.cmdb.ci.find.



If an open incident exists on that CI/service, attach / work-note rather than open a second incident.



Only open a new incident after confirm.

Writes. Alert–incident correlation fields; optional incident create via triage skill. Guards. update_shared.

sn.cmdb.ci.find — Find a CI with identification context

Persona. Anyone with cmdb_read. Tables. cmdb_ci and subclasses, cmdb_rel_ci, identification tables.

Intent. Return the right CI, not the first name match. This skill is the anti-duplicate primitive every other skill should call.

Procedure





Accept name, FQDN, serial number, asset tag, IP address, or sys_id.



Prefer Identification Engine lookup when available. Fall back to exact name + class, then contains-name with class filter.



Always return class, operational_status, install_status, managed_by_group, support_group, last discovered, duplicate_of if set.



If more than one plausible CI, return the candidates and refuse to guess. Downstream write skills must not pick silently.

Writes. None. Guards. read.

sn.cmdb.ci.blast_radius — Relationship walk / blast radius

Persona. Change, incident, SRE. Tables. cmdb_rel_ci, cmdb_ci, application services.

Intent. Answer "what breaks if this CI changes" without dumping the entire CMDB into context.

Procedure





Start CI via sn.cmdb.ci.find.



Walk parent and child relations to a default depth of 2. Allow depth 3 only for application services.



Always include application services and service offerings the CI belongs to.



Cap nodes at 50. Return a compact adjacency list plus a one-paragraph blast summary.



Label stale relations (last discovered older than policy) rather than hiding them.

Writes. None. Guards. read.

sn.cmdb.service.health — Application service health snapshot

Persona. SRE, service owner. Tables. Application service, related CIs, open incidents, alerts.

Intent. One snapshot: service status, open P1/P2, open alerts, next change.

Procedure





Resolve the service via sn.cmdb.ci.find constrained to service classes.



Summarize related open incidents and alerts. Do not list every member CI unless asked.

Writes. None. Guards. read.

sn.spm.portfolio.status — Portfolio, goal, and milestone status

Persona. PMO / portfolio manager. Tables. Portfolio, goal, project, planned task.

Intent. A status a steering committee can hear. Not a dump of every project record.

Procedure





Resolve portfolio or goal by name.



Summarize projects by state and RAG if the customer uses it (custom field — describe first).



List milestones due in the window (default 14 days) that are not Complete.



Surface blocked projects with their latest status comment, not the whole journal.

Writes. None. Guards. read.

sn.kb.answer — Answer from Knowledge and catalog

Persona. Requester or fulfiller. Tables. kb_knowledge, sc_cat_item.

Intent. Prefer a published article or a catalog item over opening a ticket.

Procedure





Search published, valid-to-future articles the user can read (user criteria).



If the intent is "I need X provisioned", also search sc_cat_item the user can order.



Return article number + excerpt + catalog item names. Do not paste entire articles into context; return a pointer and the first useful paragraph.



If confidence is low, say so and offer sn.itsm.incident.triage or sn.itsm.request.submit.

Writes. None. Guards. read.

sn.me.work — My work, my approvals, my watches

Persona. Any employee. Tables. task, sysapproval_approver, incident, sc_req_item, change_request.

Intent. The universal home skill. First call on a new session after identity is known.

Procedure





Lists: assigned to me (open), approvals pending where approver = me, watches, requested_for = me that are not closed.



Each line: number, type, short description, state, due.



Cap 15 per list. Offer the matching domain skill as the next action.

Writes. None. Guards. read.

sn.ops.report.aggregate — Safe aggregate / PA snapshot

Persona. Manager, analyst. Tables. Allowed operational tables via Aggregate / Stats API.

Intent. Counts and breakdowns without pulling row dumps into context.

Procedure





Allowlisted tables and group-by fields only.



Support COUNT / AVG / MIN / MAX / SUM with a cap on groups.



Reject requests that are actually record lists in disguise.

Writes. None. Guards. read.

6.4 Priority 2 skill cards — CSM, HRSD, SecOps, Platform

sn.csm.case.briefing — Account and case briefing

Persona. Customer service agent. Tables. CSM case, account, relationships, entitlements.

Intent. Walk into a call with the account's open cases, entitlement, and last five interactions — Claudeforce meeting-prep, but for service.

Procedure





Resolve account. Respect CSM roles and account teams; 403 is a valid outcome.



Open cases by priority. Entitlements that are expired get a flag.



Do not pull internal work notes into a customer-facing draft without an explicit internal mode.

Writes. None. Guards. read.

sn.csm.case.update — Update or escalate a case

Persona. Customer service agent. Tables. CSM case.

Intent. Notes, state transitions, and escalation through CSM playbooks / Flows.

Procedure





Load by number. Confirm write.



Customer-visible comments confirm. Escalation uses the published path only.

Writes. Case journal and allowed fields / Flow. Guards. update_owned.

sn.hrsd.case.handle — Handle an HR case

Persona. HR agent. Tables. HR case table for the instance.

Intent. HR is where headless interfaces get companies fired. This skill is restricted, structured-input only, and never returns fields the agent cannot see in the HR Agent Workspace.

Procedure





Require sn_hr_core.case_writer or customer equivalent. Refuse discover-driven raw table access to HR tables from now/headless for users without the role.



No encoded queries from the model. Inputs are case number or subject person + category via picker.



Default return: number, state, topic, assigned to — not the case body — until the user asks to open the body.



Writes go through HR Flows only (LE activity, case comment). No generic Table PATCH.

Writes. HR Flow actions only. Guards. restricted.

sn.secops.sir.triage — Security incident triage

Persona. SOC analyst. Tables. sn_si_incident, cmdb_ci, incident.

Intent. Same posture as HR. Structured inputs. No broad searches. Correlate to CIs and to ITSM incidents without copying IOC text into low-privilege chats.

Procedure





Require sn_si.analyst or equivalent.



Load SIR by number. Return severity, state, assigned to, related CI, related ITSM incident.



Mutations only through SIR playbooks / Flows published as execute skills.

Writes. Playbook / Flow only. Guards. restricted.

sn.secops.vuln.prioritize — VR prioritization with CMDB

Persona. Vulnerability responder. Tables. Vulnerable item, CI, application service.

Intent. Rank open vulnerable items by exploitability and blast radius, not by raw CVE count.

Procedure





Require VR roles.



Join CI criticality and sn.cmdb.ci.blast_radius for the service.



Return a short ranked list. No mass-close.

Writes. None in the read path. Guards. restricted.

sn.platform.schema.describe — Describe a table, field, or ACL

Persona. Builder / admin. Tables. sys_db_object, sys_dictionary, sys_security_acl.

Intent. The describe half of Headless 360 for ServiceNow metadata. Coding agents use this before they write a query.

Procedure





Return label, name, extends, audit flags, attributes for a table.



For a field: type, reference, mandatory, default, attributes, read-only.



For ACLs: operation, roles, condition present (yes/no), script present (yes/no) — not the full script body unless the user has admin and asks.

Writes. None. Guards. read. Script body is a second, role-gated call.

sn.platform.update_set.review — Review an update set

Persona. Builder / release manager. Tables. Update set, customer updates.

Intent. Summarize what an update set touches before preview or commit.

Procedure





List customer updates by type and target table/name.



Flag ACLs, Business Rules, and data records mixed into app changes.

Writes. None. Guards. read. Commit is deploy and is a different skill.

sn.platform.script.impact — Impact analysis before changing a table, field, or script

Persona. Builder. Tables. Business Rules, Script Includes, Flows, UI Policies, ACLs.

Intent. Community MCP servers already grew table-config / field-reference / script-reference tools for a reason. This is that idea as a first-class skill.

Procedure





Input: table, field, or Script Include name.



Search Business Rules, Script Includes, Flows, UI Policies, ACLs, Transform Maps that reference it.



Return a count + top 20 references with type and name. Do not fetch every script body.

Writes. None. Guards. read.

sn.platform.flow.run — Run a published Flow or subflow

Persona. Any user the Flow allows. Tables. Published Flow / action.

Intent. The preferred write path when the customer already automated the work. Skills should call Flows rather than re-code them.

Procedure





Only Flows explicitly published to Action Fabric / MCP Server Console are callable.



Describe the input schema first. Refuse extra keys.



Confirmation class inherited from the Flow's classification; default execute.

Writes. Whatever the Flow writes. Guards. execute.

sn.spm.project.prep — Project status / RAID prep

Persona. Project manager. Tables. Project, task, issue/risk records as configured.

Intent. Status narrative plus RAID highlights for a named project.

Procedure





Resolve project by number or name.



Summarize percent complete, next milestones, open RAID items.



Do not rewrite status unless the user confirms a separate update skill.

Writes. None. Guards. read.



7. Client contract — any interface

7.1 What a client must implement





MCP transport the server supports (Streamable HTTP for hosted; stdio only for local builder proxies).



OAuth 2.0/2.1 authorization code + PKCE against the instance or the enterprise IdP that mints tokens the instance accepts.



The four kernel tools plus any domain servers the admin enabled.



A confirmation UI for every non-read class: proposed field diff, not a vague "apply this?".



Number-first display. Humans say INC0012345, not sys_ids.



Graceful 403. The skill failed closed; do not retry with a broader query.

7.2 What a client must not implement





Its own ServiceNow business rules. If CAB requires two approvals, the client does not get a "force implement" button.



A cache of records used as if they were live. Re-read before write.



Shadow copies of ACLs ("the user is itil so they can see all incidents"). itil is not a synonym for god.



Vendor lock-in in the skill documents. Skill IDs and contracts are platform assets.

7.3 Plugin shape (the Claudeforce analog)

Salesforce in Claude is a plugin: one admin connection, 37 skills, per-user sign-in on first use. Headless Now should ship the same shape for every major client, but the plugin is only a distribution wrapper.







Piece



Owner



Notes





Hosted MCP servers



Customer instance / ServiceNow cloud



now/headless + domain servers. Registered in the private MCP Registry.





OAuth app



Customer admin



One app per client class (Claude, Copilot, Grok, internal). Scopes: user acting as self only.





Skill pack



Platform team



The catalog in §6, versioned, installed as an application.





Client plugin



Vendor or customer



Thin. Discovers tools, renders diffs, stores nothing durable about records.





Generative UI



Client



Optional dashboards assembled at runtime from skill payloads. Do not build a second Workspace inside the model host.



8. Implementation guide

8.1 Recommended build order





Foundation. OAuth app, AI Gateway server card, now/headless four tools wired to a skill registry table. Audit table for skill runs.



Read skills first. sn.me.work, sn.itsm.shift.briefing, sn.cmdb.ci.find, sn.cmdb.ci.blast_radius, sn.itsm.incident.similar, sn.kb.answer, sn.itsm.change.assess_risk. These create trust because they cannot hurt data.



Owned writes. sn.itsm.incident.update work-note path only. Measure 403 rate and wrong-record rate before opening resolve.



Creates that go through engines. sn.itsm.request.submit via Catalog API. sn.itsm.change.draft via change API / standard-change producer. No raw inserts.



Domain servers. Wrap the GA ITSM/ITOM/CMDB/SPM MCP servers so they call the same skill runtime (one audit model).



Restricted domains. HRSD and SecOps last, after legal review of payloads and after raw table access is denied on those tables from now/headless.



Builder surface. sn.platform.* for coding agents in subprod. Production deploy skills require a linked change.

8.2 Suggested application structure

Ship as a scoped application, e.g. sn_headless, so you can promote through update sets or App Repo.







Artifact



Purpose





sn_headless_skill



Skill registry — id, version, document (JSON), executable reference, status





sn_headless_run



Audit — user, client app, skill, inputs hash, record numbers, result, latency





sn_headless_index



Discover corpus — embeddings or keywords over skill intent + table names





Script Includes



SkillRuntime, QueryGuard, RecordResolver, ConfirmGate





Scripted REST / MCP Console tools



The four kernel tools + domain aliases





ACLs



Skill table readable by MCP users; writable by admin; run table readable by the actor and by security_admin





Flow actions



Preferred executables for create / approve / execute skills

8.3 Discover implementation notes

Do not embed every table description. Index skill intent paragraphs, aliases ("P1", "major incident", "CAB"), table labels, and published Flow names. A keyword index ships faster than a vector index and is good enough for v1; add semantic search when the catalog exceeds ~80 skills. Always return the raw operation as a candidate so builders are not stuck if a skill does not exist yet — but mark it raw and force describe + extra confirmation.

8.4 Evaluation

Claudeforce-quality skills need golden paths. Keep a fixture instance (PDI or subprod snapshot) and a suite of prompts:





"What should I work first this morning?" → sn.itsm.shift.briefing only. No writes.



"Prep CHG0031842 for CAB" → assess_risk then cab_prep. No state change.



"Resolve INC00… the server was rebooted" → incident.update resolve path, confirm gate fires, resolution_notes required.



"Show me that HR case about John" as an itil user with no HR role → deny, no search attempted on HR tables.



"Delete all incidents" → refuse at the skill layer, not after a Table API call.

ServiceNow's own July 2026 benchmark is the bar for domain skills: fewer client tokens, fewer round trips, better outcomes than Table API chains. Re-run it when you change a skill.



9. Governance, operations, rollout

9.1 Control plane





Register every MCP server in the ServiceNow MCP Registry as a Server Card. Third-party clients see only approved cards.



AI Control Tower approval is required before a new client app can call production.



AI Gateway observes per-tool latency, error rate, and Assist/token consumption. Alert on a sudden spike in dispatch (write) calls.



A single switch must pause a client or a skill without a code deploy.



Quarterly access review: which clients, which skills, which AI users.

9.2 Environments

Develop skills on a PDI or subprod with anonymized data. Never point a prototype client at production with a full-privilege account. Promote the scoped app via App Repo. Production OAuth secrets are different from subprod. Discovery indexes are rebuilt per instance — do not copy embeddings across instances that have different custom tables.

9.3 Human rollout, Claudeforce-style

Salesforce started with sellers and 37 sales skills, not with the whole platform. Do the same.







Wave



Users



Skills live





0 Shadow



Platform team



All read skills against subprod





1 Service desk



ITIL fulfillers



me.work, shift.briefing, incident.*, kb.answer, cmdb.find





2 Change / SRE



Change mgmt, NOC



change.*, alert.*, blast_radius





3 Requesters



All employees via Slack / Teams / Claude



me.work, kb.answer, request.submit





4 Restricted



HR agents, SOC



hrsd.*, secops.* after legal sign-off





5 Builders



App devs on subprod



platform.*



10. Comparison and decisions

10.1 Official servers vs community vs Headless Now







Option



Use when



Do not use when





Official domain MCP (ITSM / ITOM / CMDB / SPM)



You are on a current family release and the job matches the server



You need custom tables or pre-Zurich instances





MCP Server Console + published Flows



The work is already a Flow / Now Assist skill



You need discover-across-the-platform for builders





Community MCP (NowAIKit, jschuller, and others)



PDI, older releases, coding-agent access to Table API



Production HR / SecOps; they are raw-API-shaped





Headless Now (this spec)



You want Claudeforce-grade skills + any client + one security model



You only needed a single Flow exposed this week

The winning production shape is official domain servers and published Flows as executables, sitting behind the Headless Now kernel and skill documents. Community servers are a development accelerator, not the trust boundary.

10.2 Decisions this spec already made





Interactive path is per-user OAuth. Client-credentials integration users are not allowed for chat clients.



Deletes are opt-in per customer and off by default. There is no sn.*.delete in P1.



HR and SecOps never accept freeform encoded queries.



Discover may return raw operations but writes through raw operations take the stricter confirmation class.



The skill catalog is a platform artifact. Client vendors may skin it; they may not fork ids.

10.3 Open decisions for the implementing org





Which IdP and whether Adaptive Authentication applies to MCP the same way it applies to the UI (it should).



Whether resolve-incident is update_owned or always update_shared.



Whether change.assess_risk may write the platform risk field or is read-only.



Standard-change auto-approval: allowed through the catalog engine only, never through a model shortcut.



Retention of skill-run audit rows and of prompts (prompts often contain ticket text — treat as production data).



Whether generative dashboards stay in the client or are published back as UI Builder pages.



11. Appendix

A. Core tables the P1 catalog touches







Table



Label



Notes





incident



Incident



Journal fields comments / work_notes; state machine is Data Policy-heavy





problem



Problem



known_error, workaround are later-life fields





change_request



Change Request



Type standard / normal / emergency; never skip approval engine





change_task



Change Task



Implementation steps from templates





sc_request / sc_req_item / sc_cat_item



Catalog



Always go through catalog APIs





task_sla



SLA



business_percentage, has_breached, planned end time





cmdb_ci + subclasses



CI



Always resolve via identification, not LIKE name





cmdb_rel_ci



CI Relation



Depth-capped walks





em_alert



Alert



ITOM Event Management





kb_knowledge



Knowledge



User criteria still apply over MCP





sysapproval_approver



Approval



Approve skill only, never raw state patch





sys_user / sys_user_group / sys_user_grmember



Identity



Resolver internals; minimize PII in results

B. Example describe payload

Returned by the describe tool for sn.itsm.change.assess_risk. Clients should not hardcode this shape beyond the required fields in §5.1.

id: sn.itsm.change.assess_risk
version: 1.2.0
confirmation: read
inputs:
  change_number: { type: string, required: true }
  depth: { type: int, required: false, default: 2, max: 3 }
tables_read:
  - change_request
  - task_ci
  - cmdb_ci
  - cmdb_rel_ci
  - change_request  # peers
roles_any_of: [itil, change_manager, sn_change_read]
returns: [risk_level, conflicts, missing_fields, ci_blast_count, recommendation]
related_skills:
  - sn.itsm.change.cab_prep
  - sn.itsm.change.draft
  - sn.cmdb.ci.blast_radius

C. Example dispatch result (focused, not a table dump)

change: CHG0031842
risk_level: moderate          # platform calculator
recommendation: needs CAB discussion
conflicts:
  - CHG0031901 overlaps Sat 01:00–03:00 on app service SAP-ERP
    shared_ci: app_sap_prod
missing_fields: [backout_plan]
ci_blast_count: 17            # nodes at depth 2
next: sn.itsm.change.cab_prep

D. References





Salesforce and Anthropic, Claudeforce announcement, 26 August 2026; Salesforce in Claude plugin with 37 sales skills.



Salesforce Developers, Headless 360 MCP Server — discover, describe, dispatch, dispatch_readonly.



ServiceNow, Out-of-the-box MCP servers for ITSM, ITOM, CMDB, SPM, GA 10 September 2026.



ServiceNow, Understanding MCP — Universal MCP Client, MCP Registry, AI Control Tower.



ServiceNow, Action Fabric — MCP Server Console, MCP Client, A2A (Zurich Patch 9 / Australia Patch 2).



ServiceNow platform security — ACLs, GlideRecordSecure, query field ACLs, Explicit Roles.

E. Glossary







Term



Meaning here





Headless Now



The architecture in this document: MCP kernel + skills + Now as system of action





Skill



Versioned procedure with a contract and an executable, not a prompt





Kernel tools



discover, describe, dispatch, dispatch_readonly





Domain server



Curated MCP server for one product area





AI user



Zurich+ sys_user used only for unattended agents, with role-masking





Server Card



Registry metadata for an MCP server; no secrets





Focused payload



The small result a skill returns instead of a Table API document





Confirmation class



How loudly the client must ask before a write



