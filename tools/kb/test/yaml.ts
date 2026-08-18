type YamlValue =
  null | boolean | number | string | YamlValue[] | { [key: string]: YamlValue };

function scalar(value: string): YamlValue {
  const trimmed = value.trim();
  if (trimmed === "null") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseSimpleYaml(content: string): Record<string, YamlValue> {
  const root: Record<string, YamlValue> = {};
  const stack: Array<{ indent: number; value: Record<string, YamlValue> }> = [
    { indent: -1, value: root },
  ];

  for (const raw of content.replaceAll("\r\n", "\n").split("\n")) {
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    const match = /^([^:]+):(?:\s*(.*))?$/.exec(raw.trim());
    if (!match) throw new Error(`Unsupported YAML line in test helper: ${raw}`);
    while (stack.at(-1)!.indent >= indent) stack.pop();
    const parent = stack.at(-1)!.value;
    const key = match[1]!.trim();
    const rest = match[2] ?? "";
    if (rest === "") {
      const child: Record<string, YamlValue> = {};
      parent[key] = child;
      stack.push({ indent, value: child });
    } else {
      parent[key] = scalar(rest);
    }
  }
  return root;
}

export function updateMigrationPlan(content: string): string {
  let updated = content.replace(
    "agents_approved: false",
    "agents_approved: true",
  );
  updated = updated.replaceAll("disposition: null", "disposition: preserve");
  updated = updated.replaceAll("resolved: false", "resolved: true");
  return updated;
}
