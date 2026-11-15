export const componentSandboxPolicy =
  "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob: https:; media-src data: blob: https:; font-src data:; connect-src 'none'; object-src 'none'; frame-src about:; base-uri 'none'; form-action 'none'";

export function componentSandboxPolicyFor(localMediaSource) {
  if (!localMediaSource) return componentSandboxPolicy;
  if (localMediaSource !== "showai-media:")
    throw new Error(`Unsupported local media source: ${localMediaSource}`);
  return componentSandboxPolicy
    .replace("img-src data: blob: https:", `img-src data: blob: https: ${localMediaSource}`)
    .replace("media-src data: blob: https:", `media-src data: blob: https: ${localMediaSource}`);
}

export function withoutPackagePolicies(html) {
  return html.replace(
    /<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi,
    "",
  );
}
