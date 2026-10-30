import { generateKeyPair, randomBytes, sign } from "node:crypto";
import { promisify } from "node:util";

// A self-signed X.509 v3 certificate written with node:crypto, so the LAN
// identity does not depend on an openssl binary (absent on Windows).

function element(tag: number, ...parts: Buffer[]) {
  const body = Buffer.concat(parts);
  const length: number[] = [];
  for (let rest = body.length; rest > 0; rest = Math.floor(rest / 256))
    length.unshift(rest % 256);
  const header =
    body.length < 0x80 ? [body.length] : [0x80 | length.length, ...length];
  return Buffer.concat([Buffer.from([tag, ...header]), body]);
}

const sequence = (...parts: Buffer[]) => element(0x30, ...parts);

function objectId(value: string) {
  const [first, second, ...rest] = value.split(".").map(Number);
  const bytes = [40 * first + second];
  for (const arc of rest) {
    const encoded = [arc & 0x7f];
    for (
      let high = Math.floor(arc / 128);
      high > 0;
      high = Math.floor(high / 128)
    )
      encoded.unshift(0x80 | (high & 0x7f));
    bytes.push(...encoded);
  }
  return element(0x06, Buffer.from(bytes));
}

/** RFC 5280: UTCTime through 2049, GeneralizedTime after. */
function time(date: Date) {
  const text = date.toISOString().replace(/[-:T]|\.\d+/g, "");
  return date.getUTCFullYear() < 2050
    ? element(0x17, Buffer.from(text.slice(2)))
    : element(0x18, Buffer.from(text));
}

function name(commonName: string) {
  return sequence(
    element(
      0x31,
      sequence(objectId("2.5.4.3"), element(0x0c, Buffer.from(commonName))),
    ),
  );
}

function pem(label: string, der: Buffer) {
  const lines = der.toString("base64").match(/.{1,64}/g)!;
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

/** An RSA-2048 key and a self-signed CA certificate for it, both as PEM. */
export async function selfSignedIdentity(
  commonName: string,
  days: number,
  now = new Date(),
) {
  const { publicKey, privateKey } = await promisify(generateKeyPair)("rsa", {
    modulusLength: 2048,
  });
  const algorithm = sequence(
    objectId("1.2.840.113549.1.1.11"),
    Buffer.from([0x05, 0x00]),
  );
  const serial = randomBytes(16);
  // Positive and minimally encoded.
  serial[0] = (serial[0] & 0x7f) | 0x40;
  const subject = name(commonName);
  const basicConstraints = sequence(
    objectId("2.5.29.19"),
    element(0x01, Buffer.from([0xff])),
    element(0x04, sequence(element(0x01, Buffer.from([0xff])))),
  );
  const certificate = sequence(
    element(0xa0, element(0x02, Buffer.from([2]))),
    element(0x02, serial),
    algorithm,
    subject,
    sequence(time(now), time(new Date(now.getTime() + days * 86_400_000))),
    subject,
    publicKey.export({ type: "spki", format: "der" }),
    element(0xa3, sequence(basicConstraints)),
  );
  const signature = sign("sha256", certificate, privateKey);
  return {
    key: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    cert: pem(
      "CERTIFICATE",
      sequence(
        certificate,
        algorithm,
        element(0x03, Buffer.from([0]), signature),
      ),
    ),
  };
}
