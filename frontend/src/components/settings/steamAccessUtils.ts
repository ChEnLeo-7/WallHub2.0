export function countSteamAccessHosts(hosts: string) {
  return String(hosts || '')
    .split(/\r?\n/)
    .reduce((count, rawLine) => {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith(';')) return count;
      const body = line.split(/\s+#|\s+;/, 1)[0].trim();
      const parts = body.split(/\s+/).filter(Boolean);
      return parts.length >= 2 ? count + parts.length - 1 : count;
    }, 0);
}
