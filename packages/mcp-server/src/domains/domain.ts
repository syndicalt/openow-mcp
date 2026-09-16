import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SkillDoc } from "@open-now/contracts";
import { z } from "zod";
import type { Kernel, KernelResult } from "../kernel/kernel.js";

export interface DomainTool {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  handler: (args: Record<string, unknown>, sessionId: string) => Promise<KernelResult>;
}

export interface DomainToolset {
  domain: string;
  tools: DomainTool[];
}

/**
 * Domain-server surface (spec §3.3 Surface B): curated, opinionated tools that
 * wrap the same kernel/skill runtime — one audit model. Tool name = `<domain>_<slug>`
 * (slug = skill id minus `sn.<domain>.`, dots -> underscores).
 */
export function createDomainToolset(
  domain: string,
  docs: SkillDoc[],
  kernel: Kernel,
): DomainToolset {
  const prefix = `sn.${domain}.`;
  const mine = docs.filter((d) => d.id.startsWith(prefix));
  return {
    domain,
    tools: mine.map((doc) => {
      const slug = doc.id.slice(prefix.length).replace(/\./g, "_");
      return {
        name: `${domain}_${slug}`,
        description: `${doc.intent} [${doc.confirmation}]`,
        inputSchema: buildInputSchema(doc),
        handler: async (args, sessionId) =>
          kernel.dispatchTool("dispatch", { skillId: doc.id, inputs: args }, { sessionId }),
      };
    }),
  };
}

function buildInputSchema(doc: SkillDoc): z.ZodType {
  const shape: Record<string, z.ZodType> = {};
  for (const [name, spec] of Object.entries(doc.inputs)) {
    let s: z.ZodType;
    switch (spec.type) {
      case "int":
      case "number":
        s = z.number();
        break;
      case "boolean":
        s = z.boolean();
        break;
      case "array":
        s = z.array(z.unknown());
        break;
      case "object":
        s = z.record(z.string(), z.unknown());
        break;
      case "enum":
        s = spec.enum?.length
          ? z.enum(spec.enum as [string, ...string[]])
          : z.string();
        break;
      case "record_number":
      case "sys_id":
      default:
        s = z.string();
    }
    if (spec.description) s = s.describe(`${spec.description}${spec.enum?.length ? ` (${spec.enum.join("|")})` : ""}`);
    shape[name] = spec.required ? s : s.optional();
  }
  return z.object(shape);
}
