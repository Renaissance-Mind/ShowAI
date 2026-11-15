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

function isMachO(path) {
  const header = Buffer.alloc(8);
  const fd = openSync(path, "r");
  const length = readSync(fd, header, 0, 8, 0);
  closeSync(fd);
  if (length < 8) return false;
  const magic = header.readUInt32BE(0);
  if ([0xcffaedfe, 0xcefaedfe, 0xfeedfacf, 0xfeedface].includes(magic))
    return true;
  return (
    (magic === 0xcafebabe || magic === 0xcafebabf) &&
    header.readUInt32BE(4) < 30
  );
}

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
