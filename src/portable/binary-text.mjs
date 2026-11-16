export function encodeBinaryText(bytes) {
  const alphabet = Array.from({ length: 94 }, (_, index) =>
    String.fromCharCode(index + 33),
  )
    .filter((character) => ![34, 60, 92].includes(character.charCodeAt(0)))
    .join("");
  let buffer = 0,
    bits = 0,
    output = "";
  for (const byte of bytes) {
    buffer |= byte << bits;
    bits += 8;
    if (bits > 13) {
      let value = buffer & 8191;
      if (value > 88) {
        buffer >>>= 13;
        bits -= 13;
      } else {
        value = buffer & 16383;
        buffer >>>= 14;
        bits -= 14;
      }
      output += alphabet[value % 91] + alphabet[Math.floor(value / 91)];
    }
  }
  if (bits) {
    output += alphabet[buffer % 91];
    if (bits > 7 || buffer > 90) output += alphabet[Math.floor(buffer / 91)];
  }
  return output;
}
export function decodeBinaryText(text) {
  const alphabet = Array.from({ length: 94 }, (_, index) =>
    String.fromCharCode(index + 33),
  )
    .filter((character) => ![34, 60, 92].includes(character.charCodeAt(0)))
    .join("");
  let buffer = 0,
    bits = 0,
    value = -1;
  const output = [];
  for (const character of text) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error("Invalid binary transport character");
    if (value < 0) value = digit;
    else {
      value += digit * 91;
      buffer |= value << bits;
      bits += (value & 8191) > 88 ? 13 : 14;
      while (bits > 7) {
        output.push(buffer & 255);
        buffer >>>= 8;
        bits -= 8;
      }
      value = -1;
    }
  }
  if (value >= 0) output.push((buffer | (value << bits)) & 255);
  return Uint8Array.from(output);
}
