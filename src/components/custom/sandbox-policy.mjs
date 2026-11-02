// Only local, opaque srcdoc readers may nest inside a component. HTTPS, file,
// data and blob frames remain blocked; descendants inherit the offline policy.
// Components show online images, video and audio; they still cannot send
// requests (connect-src) or open other frames.
export const componentSandboxPolicy =
  "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob: https:; media-src data: blob: https:; font-src data:; connect-src 'none'; object-src 'none'; frame-src about:; base-uri 'none'; form-action 'none'";

/**
 * The policy of a desktop workbench frame, which also loads local files the
 * host granted for the component from `showai-media:`.
 */
export function componentSandboxPolicyFor(localMediaSource) {
  if (!localMediaSource) return componentSandboxPolicy;
  if (localMediaSource !== "showai-media:")
    throw new Error(`Unsupported local media source: ${localMediaSource}`);
  return componentSandboxPolicy
    .replace("img-src data: blob: https:", `img-src data: blob: https: ${localMediaSource}`)
    .replace("media-src data: blob: https:", `media-src data: blob: https: ${localMediaSource}`);
}

/**
 * A compiled package carries the policy it was compiled with. The host's
 * policy, placed before the package, is the boundary; the package's own
 * policies come out so a component compiled earlier gets the current
 * sources (online media, granted local files) too.
 */
export function withoutPackagePolicies(html) {
  return html.replace(
    /<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi,
    "",
  );
}
