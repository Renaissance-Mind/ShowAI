import { translator } from "../../i18n";
import messages from "../../i18n/messages/componentValidation";

export interface ValidationIssue {
  path: (string | number)[];
  rule:
    | { kind: "required"; property: string }
    | { kind: "additional" }
    | { kind: "type"; types: string[] }
    | { kind: "enum" }
    | { kind: "const" }
    | { kind: "limit"; comparison: ">=" | ">" | "<=" | "<"; limit: string }
    | { kind: "items"; bound: "min" | "max"; limit: string }
    | { kind: "length"; bound: "min" | "max"; limit: string }
    | { kind: "pattern" }
    | { kind: "format"; format: string }
    | { kind: "unique" }
    | { kind: "alternatives" }
    | { kind: "other"; message: string };
}

function pointer(value: string): (string | number)[] {
  return value
    .split("/")
    .slice(1)
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"))
    .map((segment) =>
      /^(0|[1-9]\d*)$/.test(segment) ? Number(segment) : segment,
    );
}

function rule(message: string): ValidationIssue["rule"] {
  let match: RegExpMatchArray | null;
  if ((match = message.match(/^must have required property '(.+)'$/)))
    return { kind: "required", property: match[1] };
  if (/^must NOT have additional properties$/.test(message))
    return { kind: "additional" };
  if (
    (match = message.match(
      /^must be ((?:string|number|integer|boolean|array|object|null)(?:,(?:string|number|integer|boolean|array|object|null))*)$/,
    ))
  )
    return { kind: "type", types: match[1].split(",") };
  if (/^must be equal to one of the allowed values$/.test(message))
    return { kind: "enum" };
  if (/^must be equal to constant$/.test(message)) return { kind: "const" };
  if ((match = message.match(/^must be (>=|>|<=|<) (-?[\d.e+-]+)$/)))
    return {
      kind: "limit",
      comparison: match[1] as ">=" | ">" | "<=" | "<",
      limit: match[2],
    };
  if ((match = message.match(/^must NOT have (fewer|more) than (\d+) items?$/)))
    return {
      kind: "items",
      bound: match[1] === "fewer" ? "min" : "max",
      limit: match[2],
    };
  if (
    (match = message.match(
      /^must NOT have (fewer|more) than (\d+) characters?$/,
    ))
  )
    return {
      kind: "length",
      bound: match[1] === "fewer" ? "min" : "max",
      limit: match[2],
    };
  if (/^must match pattern /.test(message)) return { kind: "pattern" };
  if ((match = message.match(/^must match format "(.+)"$/)))
    return { kind: "format", format: match[1] };
  if (/^must NOT have duplicate items/.test(message)) return { kind: "unique" };
  if (/^must match (exactly one|a) schema in (oneOf|anyOf)$/.test(message))
    return { kind: "alternatives" };
  return { kind: "other", message };
}

/**
 * Parses the runtime's joined ajv text: `<instancePath|missingProperty|data> <message>`
 * separated by `; `. Author-written relation messages fall through as `other`.
 */
export function parseValidationMessage(text: string): ValidationIssue[] {
  return text
    .split("; ")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const space = part.indexOf(" ");
      const head = space < 0 ? part : part.slice(0, space);
      const message = space < 0 ? "" : part.slice(space + 1);
      if (!message || !(head.startsWith("/") || /^must /.test(message)))
        return {
          path: [],
          rule: { kind: "other", message: part },
        } as ValidationIssue;
      const parsed = rule(message);
      const path = head.startsWith("/") ? pointer(head) : [];
      return { path, rule: parsed };
    });
}

export function isValidationMessage(text: string): boolean {
  return parseValidationMessage(text).some(
    (issue) => issue.rule.kind !== "other",
  );
}

type Translate = (
  key: string,
  params?: Record<string, string | number>,
) => string;
const defaultTranslate = translator(messages) as unknown as Translate;

export function readablePath(
  path: (string | number)[],
  t: Translate = defaultTranslate,
): string {
  return path
    .map((segment, index) =>
      typeof segment === "number"
        ? t("validation.pathItem", { index: segment + 1 })
        : index === 0
          ? segment
          : typeof path[index - 1] === "number"
            ? t("validation.pathFieldOfItem", { name: segment })
            : t("validation.pathField", { name: segment }),
    )
    .join("")
    .trim();
}

export function readableValidation(
  text: string,
  t: Translate = defaultTranslate,
): string[] {
  return parseValidationMessage(text).map(({ path, rule }) => {
    const where = readablePath(path, t);
    const target = where || t("validation.root");
    switch (rule.kind) {
      case "required":
        return where
          ? t("validation.required", { target: where, property: rule.property })
          : t("validation.requiredRoot", { property: rule.property });
      case "additional":
        return t("validation.additional", { target });
      case "type":
        return t("validation.type", {
          target,
          type: rule.types
            .map((type) => t(`validation.type.${type}`))
            .join(t("validation.or")),
        });
      case "enum":
        return t("validation.enum", { target });
      case "const":
        return t("validation.const", { target });
      case "limit":
        return t(
          {
            ">=": "validation.min",
            ">": "validation.exclusiveMin",
            "<=": "validation.max",
            "<": "validation.exclusiveMax",
          }[rule.comparison],
          { target, limit: rule.limit },
        );
      case "items":
        return t(
          rule.bound === "min" ? "validation.minItems" : "validation.maxItems",
          {
            target,
            count: Number(rule.limit),
          },
        );
      case "length":
        return t(
          rule.bound === "min"
            ? "validation.minLength"
            : "validation.maxLength",
          {
            target,
            count: Number(rule.limit),
          },
        );
      case "pattern":
        return t("validation.pattern", { target });
      case "format":
        return t("validation.format", { target, format: rule.format });
      case "unique":
        return t("validation.unique", { target });
      case "alternatives":
        return t("validation.alternatives", { target });
      default:
        return where
          ? t("validation.other", { target: where, message: rule.message })
          : rule.message;
    }
  });
}
