import crypto from "node:crypto";

const IV = Buffer.from("0102030405060708");
const PRESET_KEY = Buffer.from("0CoJUm6Qyw8W8jud");
const BASE62 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----`;

function aesEncrypt(buffer: Buffer, key: Buffer, iv: Buffer): string {
  const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
  return Buffer.concat([cipher.update(buffer), cipher.final()]).toString(
    "base64",
  );
}

function rsaEncrypt(buffer: Buffer, keyPem: string): string {
  // Pad buffer with leading zeroes to 128 bytes for 1024-bit RSA
  const padded = Buffer.alloc(128, 0);
  buffer.copy(padded, 128 - buffer.length);
  return crypto
    .publicEncrypt(
      {
        key: keyPem,
        padding: crypto.constants.RSA_NO_PADDING,
      },
      padded,
    )
    .toString("hex");
}

// NetEase WEAPI Encryption
export function weapiEncrypt(object: Record<string, unknown>): {
  params: string;
  encSecKey: string;
} {
  const text = Buffer.from(JSON.stringify(object), "utf8");
  let secretKeyStr = "";
  for (let i = 0; i < 16; i++) {
    secretKeyStr += BASE62.charAt(Math.floor(Math.random() * 62));
  }
  const secretKey = Buffer.from(secretKeyStr, "utf8");

  const firstAes = Buffer.from(aesEncrypt(text, PRESET_KEY, IV), "utf8");
  const params = aesEncrypt(firstAes, secretKey, IV);
  const reversedSecret = Buffer.from(
    secretKeyStr.split("").reverse().join(""),
    "utf8",
  );
  const encSecKey = rsaEncrypt(reversedSecret, RSA_PUBLIC_KEY);

  return { params, encSecKey };
}
