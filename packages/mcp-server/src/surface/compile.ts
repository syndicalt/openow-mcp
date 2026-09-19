import type {
  OperatorIdentity,
  Question,
  SurfaceArchetype,
  SurfaceSpec,
  UiComponent,
} from "@open-now/contracts";
import { SurfaceArchetypeSchema } from "@open-now/contracts";
import type { JudgmentClient } from "../judgment/client.js";
import { SURFACE_CLASSIFY_PACK, SURFACE_DENSITY_QUESTION } from "../judgment/packs.js";
import { UI_COMPONENT_CATALOG, type UiComponentDef } from "./catalog.js";

const KEEP_NOUL = 0.42;
const REGION_CAPS: Record<UiComponent["region"], number> = {
  header: 2,
  main: 4,
  rail: 3,
  overlay: 1,
};

export interface CompileSurfaceInput {
  identity: OperatorIdentity;
  /** sn.me.work focused payload, when the home canvas is compiling. */
  work?: Record<string, unknown>;
  /** Skill ids this operator can see (discover / ACL). Never invent past this set. */
  availableSkills?: string[];
  /** Optional moment intent (the discover query). */
  intent?: string;
}

export interface Classification {
  archetype: SurfaceArchetype;
  confidence: number;
  density: number;
  probabilities: Record<string, number>;
}

/**
 * Pull operator identity out of an sn.me.work payload (instance snake_case)
 * or a camelCase kernel object.
 */
export function identityFrom(payload: unknown): OperatorIdentity | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const rec = payload as Record<string, unknown>;
  const raw = rec.identity && typeof rec.identity === "object" ? (rec.identity as Record<string, unknown>) : rec;
  const userId = String(raw.userId ?? raw.user_id ?? "");
  const name = String(raw.name ?? "");
  const title = String(raw.title ?? "");
  if (!userId && !name && !title) return undefined;
  const roles = Array.isArray(raw.roles) ? raw.roles.map(String) : [];
  return {
    userId,
    name,
    title,
    department: raw.department != null ? String(raw.department) : undefined,
    roles,
  };
}

/** Jev Choice: title / department / roles → NowOS surface archetype. */
export async function classifyOperator(
  judgment: JudgmentClient,
  identity: OperatorIdentity,
  intent = "",
): Promise<Classification> {
  const result = await judgment.evaluate({
    model: "jev-latest",
    state: {
      title: identity.title,
      name: identity.name,
      department: identity.department ?? "",
      roles: identity.roles,
      intent,
    },
    questions: {
      archetype: SURFACE_CLASSIFY_PACK.questions.archetype ?? {
        type: "choice",
        instructions: "Which NowOS work surface matches this operator?",
        criteria: { employee: "anyone" },
      },
      density: SURFACE_DENSITY_QUESTION,
    },
  });
  const choice = result.answers["archetype"];
  const densityAns = result.answers["density"];
  const raw = choice?.type === "choice" ? choice.choice : "employee";
  const parsed = SurfaceArchetypeSchema.safeParse(raw);
  return {
    archetype: parsed.success ? parsed.data : "employee",
    confidence: choice?.type === "choice" ? choice.confidence : 0,
    density: densityAns?.type === "score" ? densityAns.score : 1,
    probabilities: choice?.type === "choice" ? choice.probabilities : {},
  };
}

/**
 * Compile an ACL-honest canvas. Classification (Choice) then component
 * judgment (Noul per candidate). Judgment never writes and never adds a
 * skill that was not already available.
 */
export async function compileSurface(
  judgment: JudgmentClient,
  input: CompileSurfaceInput,
): Promise<SurfaceSpec> {
  const classified = await classifyOperator(judgment, input.identity, input.intent ?? "");
  const candidates = UI_COMPONENT_CATALOG.filter((c) => eligible(c, classified.archetype, input));
  const judged = await judgeComponents(judgment, input, classified.archetype, candidates);
  const forced = forceKeep(input.work);
  const kept: UiComponent[] = [];
  for (const c of candidates) {
    const noul = c.always ? 1 : (judged[c.id] ?? 0);
    const keep = c.always || forced.has(c.id) || noul >= KEEP_NOUL;
    if (!keep) continue;
    kept.push({
      id: c.id,
      kind: c.kind,
      region: c.region,
      title: c.title,
      skillId: c.skillId,
      noul,
      why: c.always
        ? "identity chrome — always on"
        : forced.has(c.id)
          ? "instance returned rows for this queue"
          : `noul=${noul.toFixed(2)} for ${classified.archetype}`,
      props: propsFor(c, input),
    });
  }

  const capped = capByRegion(kept, classified.density);
  const skills = unique(capped.map((c) => c.skillId).filter((s): s is string => Boolean(s)));
  return {
    archetype: classified.archetype,
    confidence: classified.confidence,
    density: classified.density,
    identity: input.identity,
    components: capped,
    skills,
  };
}

async function judgeComponents(
  judgment: JudgmentClient,
  input: CompileSurfaceInput,
  archetype: SurfaceArchetype,
  candidates: UiComponentDef[],
): Promise<Record<string, number>> {
  const questions: Record<string, Question> = {};
  const toJudge = candidates.filter((c) => !c.always);
  if (toJudge.length === 0) return {};
  for (const c of toJudge) {
    questions[c.id] = {
      type: "noul",
      instructions: `Show the "${c.title}" component on this operator's NowOS canvas now.`,
      criteria: { true: c.when, false: c.unless },
    };
  }
  const result = await judgment.evaluate({
    model: "jev-latest",
    state: {
      title: input.identity.title,
      archetype,
      department: input.identity.department ?? "",
      intent: input.intent ?? "",
      work: summarizeWork(input.work),
    },
    questions,
  });
  const out: Record<string, number> = {};
  for (const c of toJudge) {
    const a = result.answers[c.id];
    out[c.id] = a?.type === "noul" ? a.noul : 0;
  }
  return out;
}

function eligible(c: UiComponentDef, archetype: SurfaceArchetype, input: CompileSurfaceInput): boolean {
  if (!c.always && !c.archetypes.includes(archetype)) return false;
  if (c.rolesAnyOf && c.rolesAnyOf.length > 0) {
    const roles = input.identity.roles;
    if (!roles.some((r) => c.rolesAnyOf!.includes(r))) return false;
  }
  if (c.skillId && input.availableSkills && !input.availableSkills.includes(c.skillId)) {
    return false;
  }
  return true;
}

function forceKeep(work?: Record<string, unknown>): Set<string> {
  const keep = new Set<string>();
  if (!work) return keep;
  if (len(work.assigned) > 0) keep.add("queue.assigned");
  if (len(work.approvals) > 0) keep.add("queue.approvals");
  return keep;
}

function propsFor(c: UiComponentDef, input: CompileSurfaceInput): Record<string, unknown> | undefined {
  if (!input.work) return undefined;
  if (c.id === "queue.assigned") return { rows: input.work.assigned ?? [] };
  if (c.id === "queue.approvals") return { rows: input.work.approvals ?? [] };
  if (c.id === "header.identity") {
    return { name: input.identity.name, title: input.identity.title };
  }
  return undefined;
}

function capByRegion(components: UiComponent[], density: number): UiComponent[] {
  const maxMain = density >= 1.5 ? REGION_CAPS.main : density >= 0.8 ? 3 : 2;
  const grouped = new Map<UiComponent["region"], UiComponent[]>();
  for (const c of components) {
    const list = grouped.get(c.region) ?? [];
    list.push(c);
    grouped.set(c.region, list);
  }
  const out: UiComponent[] = [];
  const order: UiComponent["region"][] = ["header", "main", "rail", "overlay"];
  for (const region of order) {
    const list = (grouped.get(region) ?? []).sort((a, b) => b.noul - a.noul);
    const cap = region === "main" ? maxMain : REGION_CAPS[region];
    out.push(...list.slice(0, cap));
  }
  return out;
}

function summarizeWork(work?: Record<string, unknown>): Record<string, number> {
  if (!work) return {};
  return {
    assigned: len(work.assigned),
    approvals: len(work.approvals),
    watches: len(work.watches),
    requested_for: len(work.requested_for),
  };
}

function len(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}
