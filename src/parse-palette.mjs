import { fitToSrgb } from "./color-math.mjs";

const OKLCH_VALUE_PATTERN = /^oklch\(\s*([^\s()/]+)\s+([^\s()/]+)\s+([^\s()/]+)(?:\s*\/\s*([^\s()]+))?\s*\)$/i;
const NUMBER_WITH_UNIT_PATTERN = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)$/i;

const ROLE_ANNOTATION_PATTERN = /\/\*\s*@role\s+([a-z][a-z0-9-]*)\s*\*\//i;
const TOKEN_DECLARATION_PER_LINE = /--([a-z0-9-]+)\s*:\s*(oklch\([^;]*\))\s*;/gi;

const PROPERTY_BLOCK_PATTERN = /@property\s+(--[a-z0-9-]+)\s*\{([^}]*)\}/gi;
const PROPERTY_INITIAL_VALUE = /initial-value:\s*(oklch\([^;]*\))\s*;/i;
const PROPERTY_ROLE = /role:\s*([a-z][a-z0-9-]*)\s*;/i;
// A trailing descriptor may omit its final semicolon (valid CSS); an omitted
// semicolon between descriptors is not a valid value and fails loudly.
const PROPERTY_DARK_BLEND = /dark-blend:\s*([^;}]+?)\s*(?:;|$)/gi;

const VALID_ROLES = new Set(["canvas", "ink", "ui", "feedback", "decorative"]);

export function parsePalette(css) {
  return parsePaletteWithDiagnostics(css).tokens;
}

export function parsePaletteWithDiagnostics(css) {
  const uncommentedCss = stripComments(css);
  const hasPropertyBlocks = /@property\s+--/i.test(uncommentedCss);
  if (hasPropertyBlocks) return parsePropertyBlocks(uncommentedCss);
  return parseRootBlock(css);
}

function stripComments(css, preserveRoles = false) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => {
    const whitespace = comment.replace(/[^\r\n]/g, " ");
    const roleMatch = preserveRoles ? ROLE_ANNOTATION_PATTERN.exec(comment) : null;
    // Only a standalone annotation is metadata; prose and disabled CSS stay inert.
    if (roleMatch?.[0] === comment) {
      return `/* @role ${roleMatch[1]} */${whitespace}`;
    }
    return whitespace;
  });
}

function parsePropertyBlocks(css) {
  const tokens = {};
  const authoredTokens = {};
  const annotatedRoles = {};
  const annotatedDarkBlends = {};
  const errors = [];
  const seenProperties = new Set();

  PROPERTY_BLOCK_PATTERN.lastIndex = 0;
  let blockMatch;
  while ((blockMatch = PROPERTY_BLOCK_PATTERN.exec(css))) {
    const [, propName, body] = blockMatch;
    const name = tokenKey(propName);

    if (seenProperties.has(name)) {
      errors.push(`${propName}: duplicate @property declaration; each palette token must be declared once.`);
      delete tokens[name];
      delete authoredTokens[name];
      delete annotatedRoles[name];
      delete annotatedDarkBlends[name];
      continue;
    }
    seenProperties.add(name);

    const initialMatch = PROPERTY_INITIAL_VALUE.exec(body);
    if (!initialMatch) {
      errors.push(`${propName}: missing initial-value with a valid OKLCH color.`);
      continue;
    }

    const value = initialMatch[1];
    const parsed = parseOklch(value);

    if (parsed.errors.length) {
      errors.push(`${propName}: ${parsed.errors.join(" ")}`);
      continue;
    }

    tokens[name] = parsed.color;
    authoredTokens[name] = parsed.source;

    const roleMatch = PROPERTY_ROLE.exec(body);
    if (!roleMatch) {
      errors.push(`${propName}: missing designer role. Expected one of: ${[...VALID_ROLES].join(", ")}.`);
      continue;
    }

    const role = roleMatch[1].toLowerCase();
    if (!VALID_ROLES.has(role)) {
      errors.push(`${propName}: unsupported role "${role}". Expected one of: ${[...VALID_ROLES].join(", ")}.`);
      continue;
    }

    annotatedRoles[name] = role;

    const darkBlendMatches = [...body.matchAll(PROPERTY_DARK_BLEND)];
    if (darkBlendMatches.length === 0) continue;

    if (darkBlendMatches.length > 1) {
      errors.push(`${propName}: dark-blend must be declared at most once.`);
      continue;
    }

    const darkBlendErrors = [];
    const darkBlend = parseNumberWithUnit(
      darkBlendMatches[0][1],
      "dark-blend",
      new Set([""]),
      darkBlendErrors,
    );

    if (!darkBlend) {
      errors.push(`${propName}: ${darkBlendErrors.join(" ")}`);
      continue;
    }

    if (darkBlend.number < 0 || darkBlend.number > 100) {
      errors.push(`${propName}: dark-blend ${darkBlend.number} must be between 0 and 100.`);
      continue;
    }

    // Every role shares the same explicit rule: 0 keeps the source, 100 mixes in
    // the bounded 28% white wash. Omitting the descriptor keeps the role default.
    annotatedDarkBlends[name] = darkBlend.number;
  }

  validateFoundationRoles(annotatedRoles, errors);
  return { tokens, authoredTokens, errors, annotatedRoles, annotatedDarkBlends };
}

function parseRootBlock(css) {
  const tokens = {};
  const authoredTokens = {};
  const annotatedRoles = {};
  const annotatedDarkBlends = {};
  const errors = [];
  let pendingRole = null;
  const lines = stripComments(css, true).split("\n");

  for (const line of lines) {
    const roleMatch = ROLE_ANNOTATION_PATTERN.exec(line);
    if (roleMatch) {
      const role = roleMatch[1].toLowerCase();
      if (VALID_ROLES.has(role)) {
        pendingRole = role;
      } else {
        errors.push(`Unsupported role "${role}". Expected one of: ${[...VALID_ROLES].join(", ")}.`);
        pendingRole = null;
      }
    }

    let declMatch;
    TOKEN_DECLARATION_PER_LINE.lastIndex = 0;
    while ((declMatch = TOKEN_DECLARATION_PER_LINE.exec(line))) {
      const [, name, value] = declMatch;
      const parsed = parseOklch(value);

      if (parsed.errors.length) {
        errors.push(`--${name}: ${parsed.errors.join(" ")}`);
        continue;
      }

      tokens[name] = parsed.color;
      authoredTokens[name] = parsed.source;

      if (pendingRole) {
        annotatedRoles[name] = pendingRole;
        pendingRole = null;
      }
    }
  }

  validateFoundationRoles(annotatedRoles, errors);
  return { tokens, authoredTokens, errors, annotatedRoles, annotatedDarkBlends };
}

function validateFoundationRoles(annotatedRoles, errors) {
  for (const role of ["canvas", "ink"]) {
    const matches = Object.entries(annotatedRoles)
      .filter(([, annotatedRole]) => annotatedRole === role)
      .map(([name]) => `--${name}`);

    if (matches.length > 1) {
      errors.push(`Role "${role}" must identify exactly one palette color; found ${matches.join(", ")}.`);
    }
  }
}

export function parseOklch(value) {
  const match = OKLCH_VALUE_PATTERN.exec(String(value).trim());

  if (!match) {
    return {
      color: null,
      errors: ["Expected a simple OKLCH value like oklch(0.62 0.14 160)."],
    };
  }

  const [, lightness, chroma, hue, alpha] = match;
  const parsed = parseOklchChannels({ lightness, chroma, hue, alpha });

  return {
    color: parsed.errors.length ? null : fitToSrgb(parsed.color),
    source: parsed.errors.length ? null : parsed.color,
    errors: parsed.errors,
  };
}

export function tokenKey(customProperty) {
  return customProperty.replace(/^--/, "");
}

function parseOklchChannels({ lightness, chroma, hue, alpha }) {
  const errors = [];
  const l = parseLightness(lightness, errors);
  const c = parseChroma(chroma, errors);
  const h = parseHue(hue, errors);

  if (!errors.length) {
    for (const [channel, number] of Object.entries({ lightness: l, chroma: c, hue: h })) {
      if (!Number.isFinite(number)) {
        errors.push(`${channel} must resolve to a finite number after unit conversion.`);
      }
    }
  }

  if (alpha != null) {
    errors.push("Alpha channels are not supported in palette source colors; use an opaque OKLCH value.");
  }

  if (Number.isFinite(l) && (l < 0 || l > 1)) {
    errors.push(`Lightness ${lightness} must resolve to a value between 0 and 1.`);
  }

  if (Number.isFinite(c) && c < 0) {
    errors.push(`Chroma ${chroma} must be greater than or equal to 0.`);
  }

  return {
    color: { l, c, h },
    errors,
  };
}

function parseLightness(value, errors) {
  const parsed = parseNumberWithUnit(value, "lightness", new Set(["", "%"]), errors);
  if (!parsed) return Number.NaN;
  return parsed.unit === "%" ? parsed.number / 100 : parsed.number;
}

function parseChroma(value, errors) {
  const parsed = parseNumberWithUnit(value, "chroma", new Set(["", "%"]), errors);
  if (!parsed) return Number.NaN;
  return parsed.unit === "%" ? parsed.number * 0.004 : parsed.number;
}

function parseHue(value, errors) {
  const parsed = parseNumberWithUnit(value, "hue", new Set(["", "deg", "grad", "rad", "turn"]), errors);
  if (!parsed) return Number.NaN;

  switch (parsed.unit) {
    case "grad": return parsed.number * 0.9;
    case "rad": return parsed.number * (180 / Math.PI);
    case "turn": return parsed.number * 360;
    default: return parsed.number;
  }
}

function parseNumberWithUnit(value, channel, allowedUnits, errors) {
  const clean = value.trim().toLowerCase();
  const match = NUMBER_WITH_UNIT_PATTERN.exec(clean);

  if (!match) {
    errors.push(`${channel} "${value}" must be a complete finite number with a supported unit.`);
    return null;
  }

  const number = Number(match[1]);
  const unit = match[2];

  if (!allowedUnits.has(unit)) {
    errors.push(`${channel} "${value}" uses unsupported unit "${unit || "(none)"}".`);
    return null;
  }

  if (!Number.isFinite(number)) {
    errors.push(`${channel} "${value}" must be a finite number.`);
    return null;
  }

  return { number, unit };
}
