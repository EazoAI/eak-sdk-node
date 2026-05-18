import { createHmac } from "node:crypto";

type Headers = Record<string, string>;
type Params = Record<string, unknown>;

function filter(value: unknown): string {
  return String(value).replace(/[\t\n\r\f]/g, " ");
}

function canonicalizedHeaders(headers: Headers): string {
  return Object.keys(headers)
    .filter((key) => key.startsWith("x-authing-") || key === "date")
    .sort()
    .map((key) => `${key}:${filter(headers[key]).trim()}\n`)
    .join("");
}

function canonicalizedResource(pathname: string, params: Params): string {
  const keys = Object.keys(params).sort();
  if (!keys.length) return pathname;
  const query = keys.map((key) => {
    const value = params[key];
    return `${key}=${typeof value === "object" && value !== null ? JSON.stringify(value) : value}`;
  });
  return `${pathname}?${query.join("&")}`;
}

export function buildStringToSign(
  method: string,
  pathname: string,
  headers: Headers,
  params: Params,
): string {
  return `${method.toUpperCase()}\n${canonicalizedHeaders(headers)}${canonicalizedResource(
    pathname,
    params,
  )}`;
}

export function buildSignature(secretKey: string, stringToSign: string): string {
  return createHmac("sha1", secretKey).update(stringToSign, "utf8").digest("base64");
}

export function buildAuthorization(accessKey: string, secretKey: string, stringToSign: string): string {
  return `authing ${accessKey}:${buildSignature(secretKey, stringToSign)}`;
}
