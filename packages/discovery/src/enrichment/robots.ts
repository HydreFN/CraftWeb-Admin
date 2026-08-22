/**
 * Parser robots.txt minimal et prudent (§2.9) : on respecte les groupes
 * `User-agent: *` et ceux visant notre agent. En cas de doute (fichier
 * illisible), on considère le chemin autorisé uniquement si robots.txt
 * est absent (404) ; une erreur réseau → on s'abstient.
 */

export interface RobotsRules {
  disallow: string[];
  allow: string[];
}

export function parseRobots(content: string, userAgentToken = "prospectionia"): RobotsRules {
  const lines = content.split(/\r?\n/);
  const rules: RobotsRules = { disallow: [], allow: [] };
  let applies = false;
  let sawAnyAgent = false;

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1]!.toLowerCase();
    const value = m[2]!.trim();

    if (field === "user-agent") {
      const agent = value.toLowerCase();
      // Nouveau groupe : réinitialise l'applicabilité au premier user-agent
      // rencontré après des règles.
      if (sawAnyAgent && (rules.disallow.length > 0 || rules.allow.length > 0)) {
        // les groupes s'accumulent : on garde les règles déjà applicables
      }
      applies = agent === "*" || userAgentToken.includes(agent) || agent.includes(userAgentToken);
      sawAnyAgent = true;
    } else if (applies && field === "disallow" && value) {
      rules.disallow.push(value);
    } else if (applies && field === "allow" && value) {
      rules.allow.push(value);
    }
  }
  return rules;
}

/** true si le chemin est autorisé (longest-match, allow prime à longueur égale ou supérieure). */
export function isPathAllowed(rules: RobotsRules, path: string): boolean {
  const matchLen = (patterns: string[]) =>
    patterns.reduce((best, p) => (path.startsWith(p) && p.length > best ? p.length : best), 0);
  const d = matchLen(rules.disallow);
  const a = matchLen(rules.allow);
  if (d === 0) return true;
  return a >= d;
}
