export function parseBasicAuth(
  header?: string
): { user: string; pass: string } | null {
  if (!header) return null;

  const [scheme, encoded] = header.split(" ");
  if (!encoded || scheme.toLowerCase() !== "basic") return null;

  let decoded = "";
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch (error) {
    return null;
  }

  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) return null;

  return {
    user: decoded.slice(0, separatorIndex),
    pass: decoded.slice(separatorIndex + 1),
  };
}
