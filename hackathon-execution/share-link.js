function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  if (typeof btoa === "function") return btoa(binary);
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(base64) {
  if (typeof atob === "function") {
    const binary = atob(base64);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

function toBase64Url(base64) {
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(base64url) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  return base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
}

export function encodeRestrictionForUrl(restriction) {
  const json = JSON.stringify(restriction);
  const bytes = new TextEncoder().encode(json);
  return toBase64Url(bytesToBase64(bytes));
}

export function decodeRestrictionFromUrl(payload) {
  if (!payload || typeof payload !== "string") return null;
  try {
    const bytes = base64ToBytes(fromBase64Url(payload));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    return null;
  }
}

export function restrictionToShareUrl(baseUrl, restriction) {
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}data=${encodeURIComponent(encodeRestrictionForUrl(restriction))}`;
}
