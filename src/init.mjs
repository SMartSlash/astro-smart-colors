import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { loadSmartColorsConfig, resolveProjectUrl, DEFAULT_CONFIG_FILE } from "./load-config.mjs";

const PALETTE_TEMPLATE_URL = new URL("./templates/palette.css", import.meta.url);
const TUNING_TEMPLATE_URL = new URL("./templates/colors-tuning.css", import.meta.url);
const PALETTE_FILENAME = "palette.css";
const TUNING_FILENAME = "colors-tuning.css";
const OUTPUT_FILENAME = "colors.css";
const CONFIG_FILENAME = DEFAULT_CONFIG_FILE;
const DEFAULT_TOKEN_DIR = "src/styles/tokens";
const CANCEL_ANSWER = /^(?:n|no|cancel|quit|0)$/i;
const AFFIRMATIVE_ANSWER = /^(?:|y(?:es)?)$/i;

/**
 * Create the authored files a Smart Colors project starts from.
 *
 * The palette follows config.palette (an explicit --palette or --dir wins); the tuning defaults to
 * colors-tuning.css in the palette directory. A token directory other than src/styles/tokens, or an
 * explicit --palette outside it, also writes a plain smart-colors.config.mjs (no package import) so
 * build/check/audit resolve the layout without a toolchain. An existing or explicitly selected config
 * is never rewritten; a palette override that diverges from it is refused before any write. Nothing is
 * written when a target already exists or would overwrite a generated output. Prompting only happens
 * on an interactive terminal and only when no path option was supplied.
 */
export async function initSmartColors({
  root = process.cwd(),
  configFile,
  dir,
  palette,
  tuning,
  yes = false,
  stdin = process.stdin,
  stdout = process.stdout,
} = {}) {
  if (dir !== undefined && palette !== undefined) {
    throw new Error("Cannot combine --dir with --palette. Use --dir to choose a folder, or --palette for an explicit file path.");
  }

  const config = await loadSmartColorsConfig({ root, configFile });
  const explicitConfig = configFile !== undefined;
  const configPalettePath = normalizeProjectPath(config.palette);
  const configExists = explicitConfig || await pathExists(fileURLToPath(resolveProjectUrl(root, configFile ?? DEFAULT_CONFIG_FILE)));

  const explicitDir = dir === undefined ? undefined : normalizeDirectory(dir);
  let palettePath = normalizeProjectPath(explicitDir === undefined
    ? (palette ?? configPalettePath)
    : path.posix.join(explicitDir, PALETTE_FILENAME));
  let tuningPath = tuning == null
    ? path.posix.join(path.posix.dirname(palettePath), TUNING_FILENAME)
    : normalizeProjectPath(tuning);

  const interactive = !yes && dir === undefined && palette === undefined && tuning === undefined && stdin.isTTY && stdout.isTTY;

  if (interactive) {
    const answers = await promptForProject({
      root,
      configFile,
      stdin,
      stdout,
      defaultPalettePath: configPalettePath,
      defaultTuningPath: path.posix.join(path.posix.dirname(configPalettePath), TUNING_FILENAME),
    });
    if (!answers.confirmed) return { written: false, files: [palettePath, tuningPath] };
    palettePath = answers.palettePath;
    tuningPath = answers.tuningPath;
  }

  const paletteFile = fileURLToPath(resolveProjectUrl(root, palettePath));
  const tuningFile = fileURLToPath(resolveProjectUrl(root, tuningPath));

  if (paletteFile === tuningFile) {
    throw new Error(`palette and tuning must be different files; both resolve to ${palettePath}.`);
  }

  // R12: an existing or explicitly selected config is never rewritten. Any effective palette that
  // diverges from it — an explicit --palette/--dir or an interactive choice — cannot be reconciled
  // without editing the user's config, so refuse before any write instead of a false success.
  const paletteDiverges = !sameResolvedPath(root, palettePath, configPalettePath);
  if ((explicitConfig || configExists) && paletteDiverges) {
    throw new Error(`Refusing to write palette ${palettePath}: the selected config (${configFile ?? DEFAULT_CONFIG_FILE}) resolves palette to ${configPalettePath}. build would read ${configPalettePath}, so this choice would not take effect. Update the config or drop the override. Nothing was written.`);
  }

  const paletteDir = path.posix.dirname(palettePath);
  // A new config is written whenever the effective palette differs from the default config.palette
  // (same directory but a different file name included), so build never reads the wrong palette.
  const generatedConfig = !explicitConfig && !configExists && paletteDiverges;
  const outputPath = generatedConfig ? path.posix.join(paletteDir, OUTPUT_FILENAME) : normalizeProjectPath(config.output);
  const effectiveConfigFile = explicitConfig ? configFile : (generatedConfig ? CONFIG_FILENAME : DEFAULT_CONFIG_FILE);

  const configContent = generatedConfig ? configFileTemplate(palettePath, outputPath) : null;
  const configFileAbsolute = fileURLToPath(resolveProjectUrl(root, CONFIG_FILENAME));
  const targets = [
    { label: "palette", value: palettePath, file: paletteFile },
    { label: "tuning", value: tuningPath, file: tuningFile },
    ...(configContent === null ? [] : [{ label: "config", value: CONFIG_FILENAME, file: configFileAbsolute }]),
  ];

  // The motion output is protected even while motion is disabled, matching the report writer:
  // enabling motion later must not collide with a file authored now.
  const generatedOutputs = [
    { label: "config.output", value: outputPath },
    { label: "config.motion.output", value: config.motion?.output },
  ]
    .filter((output) => typeof output.value === "string" && output.value.length > 0)
    .map((output) => ({ ...output, file: fileURLToPath(resolveProjectUrl(root, output.value)) }));

  for (const target of targets) {
    const collision = generatedOutputs.find((output) => output.file === target.file);
    if (collision) {
      throw new Error(`Refusing to write ${target.label} ${target.value}: it collides with the generated ${collision.label} (${collision.value}). Choose a different path.`);
    }
  }

  const existing = await findExisting(targets.map((target) => ({ label: target.value, file: target.file })));

  if (existing.length) {
    const noun = existing.length === 1 ? "file" : "files";
    throw new Error(`Refusing to overwrite existing ${noun}: ${existing.map((entry) => entry.label).join(", ")}. Nothing was written.`);
  }

  // Guidance instead of a silent false success: a tuning outside the palette directory is not the
  // file build resolves (resolveTuningFile follows the palette directory), so it would never be read.
  const { buildTuningPath, warnings } = await tuningGuidance({ root, paletteDir, tuningPath });

  const [paletteTemplate, tuningTemplate] = await Promise.all([
    readFile(PALETTE_TEMPLATE_URL, "utf8"),
    readFile(TUNING_TEMPLATE_URL, "utf8"),
  ]);

  await writeAtomically(paletteFile, paletteTemplate);
  await writeAtomically(tuningFile, tuningTemplate);
  if (configContent !== null) await writeAtomically(configFileAbsolute, configContent);

  // `files` keeps its historical meaning; `generation` adds the effective paths a CLI needs to build
  // the next command (--root/--config) and `warnings` carries guidance for the caller to display.
  return {
    written: true,
    files: targets.map((target) => target.value),
    generation: { palettePath, tuningPath, outputPath, configFile: effectiveConfigFile, buildTuningPath },
    warnings,
  };
}

async function promptForProject({ root, configFile, stdin, stdout, defaultPalettePath, defaultTuningPath }) {
  const readline = createInterface({ input: stdin, output: stdout });
  const bufferedLines = [];
  let closed = false;
  let resolveLine = null;

  readline.on("line", (line) => {
    if (resolveLine) {
      const resolve = resolveLine;
      resolveLine = null;
      resolve(line);
    } else {
      bufferedLines.push(line);
    }
  });
  readline.on("close", () => {
    closed = true;
    if (resolveLine) {
      const resolve = resolveLine;
      resolveLine = null;
      resolve(null);
    }
  });

  const ask = async (question) => {
    stdout.write(question);
    if (bufferedLines.length) return bufferedLines.shift();
    if (closed) return null;
    return await new Promise((resolve) => { resolveLine = resolve; });
  };

  try {
    const directoryLine = await ask(`[smart-colors] Configurazione iniziale\n\n  In quale cartella vuoi inserire i file dei token?\n  Cartella [${path.posix.dirname(defaultPalettePath)}]: `);
    if (directoryLine === null) return { confirmed: false };
    const directoryAnswer = directoryLine.trim();
    if (CANCEL_ANSWER.test(directoryAnswer)) return { confirmed: false };

    const affirmative = AFFIRMATIVE_ANSWER.test(directoryAnswer);
    const chosenDir = affirmative ? path.posix.dirname(defaultPalettePath) : normalizeDirectory(directoryAnswer);
    const palettePath = affirmative ? defaultPalettePath : path.posix.join(chosenDir, PALETTE_FILENAME);
    const tuningPath = affirmative ? defaultTuningPath : path.posix.join(chosenDir, TUNING_FILENAME);
    const createConfig = configFile === undefined
      && !sameResolvedPath(root, palettePath, defaultPalettePath)
      && !await pathExists(fileURLToPath(resolveProjectUrl(root, CONFIG_FILENAME)));

    const confirmation = await ask([
      "  File da creare:",
      `    • palette  ${palettePath}`,
      `    • tuning   ${tuningPath}`,
      ...(createConfig ? [`    • config   ${CONFIG_FILENAME}`] : []),
      "  Creare questi file? [Y/n] ",
    ].join("\n"));

    // End of input right after an affirmative first answer means the user
    // accepted the folder; a single answered line must never create "n/".
    const confirmed = confirmation === null ? affirmative : AFFIRMATIVE_ANSWER.test(confirmation.trim());
    return { confirmed, palettePath, tuningPath };
  } finally {
    readline.close();
  }
}

// A plain object keeps the generated config self-contained: no runtime import of the package, so an
// external fixture with no node_modules can build. The loader's normalizer already handles the
// plain-object shape and the string-shorthand identity form, so defineSmartColorsConfig is not needed.
function configFileTemplate(palettePath, outputPath) {
  return [
    "export default {",
    `  palette: ${JSON.stringify(palettePath)},`,
    `  output: ${JSON.stringify(outputPath)},`,
    "};",
    "",
  ].join("\n");
}

// build resolves tuning by following the palette directory (resolveTuningFile). Report the resolved
// location when the authored tuning would never be read, without rewriting any other file.
async function tuningGuidance({ root, paletteDir, tuningPath }) {
  const defaultTuningPath = path.posix.join(DEFAULT_TOKEN_DIR, TUNING_FILENAME);
  const candidateTuning = path.posix.join(paletteDir, TUNING_FILENAME);
  const defaultTuningExists = await pathExists(fileURLToPath(resolveProjectUrl(root, defaultTuningPath)));
  const buildTuningPath = candidateTuning !== defaultTuningPath && !defaultTuningExists ? candidateTuning : defaultTuningPath;
  const warnings = sameResolvedPath(root, tuningPath, buildTuningPath) ? [] : [
    `Il tuning ${tuningPath} non verrà letto da build: smart-colors risolve il tuning in ${buildTuningPath} (segue la cartella della palette). Tieni il file di tuning accanto alla palette, oppure puntalo a ${buildTuningPath}.`,
  ];
  return { buildTuningPath, warnings };
}

async function findExisting(entries) {
  const states = await Promise.all(entries.map(async (entry) => ({ ...entry, exists: await pathExists(entry.file) })));
  return states.filter((entry) => entry.exists);
}

async function pathExists(file) {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function normalizeDirectory(value) {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "");
  return normalized === "" ? "." : normalized;
}

function normalizeProjectPath(value) {
  return value.replaceAll("\\", "/");
}

// Compare project paths after filesystem resolution so `./design` and `design` are the same path and
// no false divergence/refusal is introduced.
function sameResolvedPath(root, a, b) {
  return resolveProjectUrl(root, a).href === resolveProjectUrl(root, b).href;
}

async function writeAtomically(file, contents) {
  const directory = path.dirname(file);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
  );

  await mkdir(directory, { recursive: true });

  try {
    await writeFile(temporaryPath, contents, "utf8");
    await rename(temporaryPath, file);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}
