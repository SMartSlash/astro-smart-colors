import { fitToSrgb } from "./color-math.mjs";

const OKLCH_VALUE_PATTERN = /^oklch\(\s*([^\s()/]+)\s+([^\s()/]+)\s+([^\s()/]+)(?:\s*\/\s*([^\s()]+))?\s*\)$/i;
const NUMBER_WITH_UNIT_PATTERN = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)$/i;

const ROLE_ANNOTATION_PATTERN = /\/\*\s*@role\s+(bg|ink|content|action|fill|decorative)\s*\*\//i;
const TOKEN_DECLARATION_PER_LINE = /--([a-z0-9-]+)\s*:\s*(oklch\([^;]*\))\s*;/gi;

const PROPERTY_BLOCK_PATTERN = /@property\s+(--[a-z0-9-]+)\s*\{([^}]*)\}/gi;
const PROPERTY_INITIAL_VALUE = /initial-value:\s*(oklch\([^;]*\))\s*;/i;
const PROPERTY_ROLE = /role:\s*(bg|ink|content|action|fill|decorative)\s*;/i;

const VALID_ROLES = new Set(["bg", "ink", "content", "action", "fill", "decorative"]);
const DEFAULT_ROLE = "content";

export function parsePalette(css) {
  return parsePaletteWithDiagnostics(css).tokens;
}

export function parsePaletteWithDiagnostics(css) {
  const hasPropertyBlocks = /@property\s+--/i.test(css);
  if (hasPropertyBlocks) return parsePropertyBlocks(css);
  return parseRootBlock(css);
}

function parsePropertyBlocks(css) {
  const tokens = {};
  const annotatedRoles = {};
  const errors = [];

  let blockMatch;
  while ((blockMatch = PROPERTY_BLOCK_PATTERN.exec(css))) {
    const [, propName, body] = blockMatch;
    const name = tokenKey(propName);

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

    const roleMatch = PROPERTY_ROLE.exec(body);
    if (roleMatch) {
      annotatedRoles[name] = roleMatch[1].toLowerCase();
    } else {
      annotatedRoles[name] = DEFAULT_ROLE;
    }
  }

  return { tokens, errors, annotatedRoles };
}

function parseRootBlock(css) {
  const tokens = {};
  const annotatedRoles = {};
  const errors = [];
  let pendingRole = null;
  const lines = css.split("\n");

  for (const line of lines) {
    const roleMatch = ROLE_ANNOTATION_PATTERN.exec(line);
    if (roleMatch) {
      pendingRole = roleMatch[1].toLowerCase();
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

      if (pendingRole) {
        annotatedRoles[name] = pendingRole;
        pendingRole = null;
      }
    }
  }

  return { tokens, errors, annotatedRoles };
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
