export function componentActivationIssue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return "target must be an object";
  if (Object.keys(value).some((key) => !["type", "scope", "id"].includes(key)))
    return "target accepts only type, scope and id";
  for (const key of ["type", "scope", "id"])
    if (
      typeof value[key] !== "string" ||
      !value[key].trim() ||
      Array.from(value[key]).length > 200
    )
      return `${key} must be non-empty text up to 200 characters`;
  return undefined;
}
