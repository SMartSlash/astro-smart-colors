import { lstat, opendir, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG_FILE, resolveProjectUrl } from "./load-config.mjs";

export async function validateOutputPaths({ root, config, configFile = DEFAULT_CONFIG_FILE }) {
  const sources = [
    { label: "config.palette", value: config.palette },
    { label: "configFile", value: configFile },
  ];
  const outputs = [
    { label: "config.output", value: config.output },
    ...(config.motion?.enabled ? [{ label: "config.motion.output", value: config.motion.output }] : []),
  ];
  const resolved = await Promise.all([...sources, ...outputs].map(async (entry) => {
    try {
      const filePath = fileURLToPath(resolveProjectUrl(root, entry.value));
      return { ...entry, ...await canonicalPath(filePath) };
    } catch (cause) {
      throw new Error(`Smart Colors output path validation failed: cannot resolve ${entry.label} (${entry.value}): ${cause.message}`, { cause });
    }
  }));

  const caseSensitivity = new Map();
  const probeDirectory = (directory) => {
    if (!caseSensitivity.has(directory)) caseSensitivity.set(directory, directoryCaseSensitivity(directory));
    return caseSensitivity.get(directory);
  };

  for (let index = sources.length; index < resolved.length; index += 1) {
    const output = resolved[index];
    for (const other of resolved.slice(0, index)) {
      if (output.canonical === other.canonical) {
        throw new Error(`Smart Colors output path collision: ${output.label} (${output.value}) collides with ${other.label} (${other.value}); both resolve to ${output.canonical}. Choose distinct output paths.`);
      }
      // NFC is a comparison key only, never a rewritten filesystem path. Unicode
      // equivalence varies by filesystem and cannot be proven for future names
      // with read-only probes: reject canonical equivalents conservatively,
      // even where they could be distinct. Do not fold compatibility characters.
      const normalizedOutput = output.canonical.normalize("NFC");
      const normalizedOther = other.canonical.normalize("NFC");
      if (normalizedOutput === normalizedOther) {
        throw new Error(`Smart Colors output path collision: ${output.label} (${output.value}) and ${other.label} (${other.value}) match after Unicode NFC normalization (${output.canonical} / ${other.canonical}); filesystem Unicode normalization varies; conservatively rejecting a potential collision even on filesystems that preserve distinct spellings. Choose output paths that differ beyond Unicode normalization.`);
      }
      if (normalizedOutput.toLowerCase().normalize("NFC") === normalizedOther.toLowerCase().normalize("NFC")) {
        const sensitivity = await Promise.all([probeDirectory(output.directory), probeDirectory(other.directory)]);
        if (sensitivity.every((value) => value === true)) continue;
        const reason = sensitivity.includes(false)
          ? "a case-insensitive directory was detected"
          : "case sensitivity could not be proven; conservatively rejecting a potential collision";
        throw new Error(`Smart Colors output path collision: ${output.label} (${output.value}) and ${other.label} (${other.value}) match after case folding and Unicode NFC normalization (${output.canonical} / ${other.canonical}); ${reason}. Choose output paths that differ beyond letter case.`);
      }
    }
  }
}

async function canonicalPath(filePath, symlinkDepth = 0) {
  if (symlinkDepth > 40) throw new Error(`Too many symbolic links while resolving ${filePath}`);
  let current = filePath;
  const missing = [];

  // Resolve the nearest existing ancestor without creating output directories.
  for (;;) {
    try {
      const existing = await realpath(current);
      return { canonical: path.join(existing, ...missing), directory: missing.length ? existing : path.dirname(existing) };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    let entry;
    try {
      entry = await lstat(current);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    // A dangling link can still alias a not-yet-created output.
    if (entry?.isSymbolicLink()) {
      const target = path.resolve(path.dirname(current), await readlink(current));
      const resolved = await canonicalPath(target, symlinkDepth + 1);
      return { ...resolved, canonical: path.join(resolved.canonical, ...missing) };
    }

    const parent = path.dirname(current);
    if (parent === current) throw new Error(`No existing ancestor for ${filePath}`);
    missing.unshift(path.basename(current));
    current = parent;
  }
}

async function directoryCaseSensitivity(directory) {
  // Probe only existing names, never create files. Bound the scan to 32 entries
  // in this directory; no recursion or inference from the OS/parent volume.
  // Empty/unreadable/ambiguous directories remain unknown: case-folded pairs
  // are rejected unless both nearest existing ancestors prove case-sensitive.
  try {
    const entries = await opendir(directory, { bufferSize: 16 });
    let inspected = 0;
    for await (const entry of entries) {
      if (inspected++ >= 32) break;
      const flipped = entry.name.replace(/[a-zA-Z]/, (letter) => letter === letter.toLowerCase() ? letter.toUpperCase() : letter.toLowerCase());
      if (flipped === entry.name) continue;
      let original;
      try {
        original = await lstat(path.join(directory, entry.name), { bigint: true });
      } catch {
        continue;
      }
      try {
        const alternate = await lstat(path.join(directory, flipped), { bigint: true });
        if (original.ino === 0n || alternate.ino === 0n) continue;
        return original.dev !== alternate.dev || original.ino !== alternate.ino;
      } catch (error) {
        if (error.code === "ENOENT") return true;
      }
    }
  } catch {
    // A failed read-only probe cannot establish that differently cased paths are safe.
  }
  return null;
}
