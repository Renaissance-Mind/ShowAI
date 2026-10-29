const {
  chmodSync,
  closeSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { delimiter, join } = require("node:path");
const { signAsync } = require("@electron/osx-sign");

// Only Mach-O code needs its own signature. Every other file in the bundle (.pak, fonts, wasm,
// pdfjs cmaps, …) is sealed by the enclosing bundle's CodeResources, so a change to it still
// breaks the signature. osx-sign would otherwise sign every non-text file, each with its own
// timestamp request.
function isMachO(path) {
  const header = Buffer.alloc(8);
  const fd = openSync(path, "r");
  const length = readSync(fd, header, 0, 8, 0);
  closeSync(fd);
  if (length < 8) return false;
  const magic = header.readUInt32BE(0);
  if ([0xcffaedfe, 0xcefaedfe, 0xfeedfacf, 0xfeedface].includes(magic))
    return true;
  // Universal binaries; a Java class shares the magic but has its class version (>= 45) here.
  return (
    (magic === 0xcafebabe || magic === 0xcafebabf) &&
    header.readUInt32BE(4) < 30
  );
}

// Apple's timestamp server drops requests now and then; codesign then fails with "A timestamp was
// expected but was not found" and the whole package would start over. Retry that file instead.
const RETRYING_CODESIGN = `#!/bin/bash
for attempt in 1 2 3 4 5 6; do
  output=$(/usr/bin/codesign "$@" 2>&1); status=$?
  if [ $status -eq 0 ] || ! grep -q "timestamp" <<<"$output"; then
    [ -n "$output" ] && printf '%s\\n' "$output" >&2
    exit $status
  fi
  echo "codesign: timestamp unavailable, retrying \${@: -1}" >&2
  sleep $((attempt * 2))
done
printf '%s\\n' "$output" >&2
exit $status
`;

module.exports = async function signMac(options) {
  const ignore = options.ignore;
  const bin = mkdtempSync(join(tmpdir(), "showai-codesign-"));
  writeFileSync(join(bin, "codesign"), RETRYING_CODESIGN);
  chmodSync(join(bin, "codesign"), 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${bin}${delimiter}${path}`;
  try {
    await signAsync({
      ...options,
      ignore: (file) =>
        ignore(file) || (!statSync(file).isDirectory() && !isMachO(file)),
    });
  } finally {
    process.env.PATH = path;
    rmSync(bin, { recursive: true, force: true });
  }
};

module.exports.isMachO = isMachO;
