import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { loadSmartColorsConfig, resolveProjectUrl } from "./load-config.mjs";

const PALETTE_TEMPLATE_URL = new URL("./templates/palette.css", import.meta.url);
const TUNING_TEMPLATE_URL = new URL("./templates/colors-tuning.css", import.meta.url);
const PALETTE_FILENAME = "palette.css";
const TUNING_FILENAME = "colors-tuning.css";
const OUTPUT_FILENAME = "colors.css";
const CONFIG_FILENAME = "smart-colors.config.mjs";
const DEFAULT_TOKEN_DIR = "src/styles/tokens";
const CANCEL_ANSWER = /^(?:n|no|cancel|quit|0)$/i;
const AFFIRMATIVE_ANSWER = /^(?:|y(?:es)?)$/i;

/**
 * Create the authored files a Smart Colors project starts from.
 *
 * The palette path follows config.palette (an explicit --palette or --dir wins);
 * the tuning panel defaults to colors-tuning.css in the palette directory.
 * Choosing a token directory other than src/styles/tokens also writes
 * smart-colors.config.mjs so build/check/audit resolve the custom layout.
 * Nothing is written when a target already exists or would overwrite a
 * generated output. Prompting only happens on an interactive terminal and only
 * when no path option was supplied.
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
  const explicitDir = dir === undefined ? undefined : normalizeDirectory(dir);
  let palettePath = normalizeProjectPath(explicitDir === undefined
    ? (palette ?? config.palette)
    : path.posix.join(explicitDir, PALETTE_FILENAME));
  let tuningPath = tuning == null
    ? path.posix.join(path.posix.dirname(palettePath), TUNING_FILENAME)
    : normalizeProjectPath(tuning);
  let chosenDir = explicitDir;

  const interactive = !yes && dir === undefined && palette === undefined && tuning === undefined && stdin.isTTY && stdout.isTTY;

  if (interactive) {
    const answers = await promptForProject({ root, configFile, stdin, stdout, defaultDir: path.posix.dirname(palettePath) });
    if (!answers.confirmed) return { written: false, files: [palettePath, tuningPath] };
    palettePath = answers.palettePath;
    tuningPath = answers.tuningPath;
    chosenDir = answers.chosenDir;
  }

  const paletteFile = fileURLToPath(resolveProjectUrl(root, palettePath));
  const tuningFile = fileURLToPath(resolveProjectUrl(root, tuningPath));

  if (paletteFile === tuningFile) {
    throw new Error(`palette and tuning must be different files; both resolve to ${palettePath}.`);
  }

  const configContent = await planConfigFile({ root, configFile, chosenDir });
  const targets = [
    { label: "palette", value: palettePath, file: paletteFile },
    { label: "tuning", value: tuningPath, file: tuningFile },
    ...(configContent === null ? [] : [{ label: "config", value: CONFIG_FILENAME, file: fileURLToPath(resolveProjectUrl(root, CONFIG_FILENAME)) }]),
  ];

  const generatedOutputs = [
    { label: "config.output", value: config.output },
    ...(config.motion?.enabled !== false && config.motion?.output
      ? [{ label: "config.motion.output", value: config.motion.output }]
      : []),
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

  const [paletteTemplate, tuningTemplate] = await Promise.all([
    readFile(PALETTE_TEMPLATE_URL, "utf8"),
    readFile(TUNING_TEMPLATE_URL, "utf8"),
  ]);

  await writeAtomically(paletteFile, paletteTemplate);
  await writeAtomically(tuningFile, tuningTemplate);
  if (configContent !== null) await writeAtomically(targets.at(-1).file, configContent);

  return { written: true, files: targets.map((target) => target.value) };
}

async function promptForProject({ root, configFile, stdin, stdout, defaultDir }) {
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
    const directoryLine = await ask(`[smart-colors] Configurazione iniziale\n\n  In quale cartella vuoi inserire i file dei token?\n  Cartella [${defaultDir}]: `);
    if (directoryLine === null) return { confirmed: false };
    const directoryAnswer = directoryLine.trim();
    if (CANCEL_ANSWER.test(directoryAnswer)) return { confirmed: false };

    const affirmative = AFFIRMATIVE_ANSWER.test(directoryAnswer);
    const chosenDir = affirmative ? defaultDir : normalizeDirectory(directoryAnswer);
    const palettePath = path.posix.join(chosenDir, PALETTE_FILENAME);
    const tuningPath = path.posix.join(chosenDir, TUNING_FILENAME);
    const createConfig = chosenDir !== DEFAULT_TOKEN_DIR
      && configFile === undefined
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
    return { confirmed, chosenDir, palettePath, tuningPath };
  } finally {
    readline.close();
  }
}

async function planConfigFile({ root, configFile, chosenDir }) {
  if (chosenDir === undefined || chosenDir === DEFAULT_TOKEN_DIR || configFile !== undefined) return null;
  if (await pathExists(fileURLToPath(resolveProjectUrl(root, CONFIG_FILENAME)))) return null;

  return [
    'import { defineSmartColorsConfig } from "@smartslash/astro-smart-colors/config";',
    "",
    "export default defineSmartColorsConfig({",
    `  palette: ${JSON.stringify(path.posix.join(chosenDir, PALETTE_FILENAME))},`,
    `  output: ${JSON.stringify(path.posix.join(chosenDir, OUTPUT_FILENAME))},`,
    "});",
    "",
  ].join("\n");
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
