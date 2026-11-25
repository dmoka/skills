const escape = (s: string) => s.replace(/&/g, "%26").replace(/=/g, "%3D");
const unescape = (s: string) => s.replace(/%3D/g, "=").replace(/%26/g, "&");

export function encodeParams(record: Record<string, string>): string {
  return Object.entries(record)
    .map(([k, v]) => `${escape(k)}=${escape(v)}`)
    .join("&");
}

export function decodeParams(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (text === "") return out;
  for (const pair of text.split("&")) {
    const i = pair.indexOf("=");
    out[unescape(pair.slice(0, i))] = unescape(pair.slice(i + 1));
  }
  return out;
}
