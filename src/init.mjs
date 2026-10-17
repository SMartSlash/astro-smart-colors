import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { loadSmartColorsConfig, resolveProjectUrl } from "./load-config.mjs";

const PALETTE_TEMPLATE_URL = new URL("./templates/palette.css", import.meta.url);
const TUNING_TEMPLATE_URL = new URL("./templates/colors-tuning.css", import.meta.url);
const TUNING_FILENAME = "colors-tuning.css";

/**
 * Create the two authored files a Smart Colors project starts from.
 *
 * The palette path follows config.palette (an explicit --palette wins); the
 * tuning panel defaults to colors-tuning.css in the palette directory. Nothing
 * is written when either target already exists or would overwrite a generated
 * output. Prompting only happens on an interactive terminal and only when
 * neither path was supplied explicitly.
 */
export async function initSmartColors({
  root = process.cwd(),
  configFile,
  palette,
  tuning,
  yes = false,
  stdin = process.stdin,
  stdout = process.stdout,
} = {}) {
  const config = await loadSmartColorsConfig({ root, configFile });
  const palettePath = normalizeProjectPath(palette ?? config.palette);
  const tuningPath = tuning == null
    ? path.posix.join(path.posix.dirname(palettePath), TUNING_FILENAME)
    : normalizeProjectPath(tuning);

  const paletteFile = fileURLToPath(resolveProjectUrl(root, palettePath));
  const tuningFile = fileURLToPath(resolveProjectUrl(root, tuningPath));

  if (paletteFile === tuningFile) {
    throw new Error(`palette and tuning must be different files; both resolve to ${palettePath}.`);
  }

  const generatedOutputs = [
    { label: "config.output", value: config.output },
    ...(config.motion?.enabled !== false && config.motion?.output
      ? [{ label: "config.motion.output", value: config.motion.output }]
      : []),
  ]
    .filter((output) => typeof output.value === "string" && output.value.length > 0)
    .map((output) => ({ ...output, file: fileURLToPath(resolveProjectUrl(root, output.value)) }));

  for (const target of [
    { label: "palette", value: palettePath, file: paletteFile },
    { label: "tuning", value: tuningPath, file: tuningFile },
  ]) {
    const collision = generatedOutputs.find((output) => output.file === target.file);
    if (collision) {
      throw new Error(`Refusing to write ${target.label} ${target.value}: it collides with the generated ${collision.label} (${collision.value}). Choose a different path.`);
    }
  }

  const existing = await findExisting([
    { label: palettePath, file: paletteFile },
    { label: tuningPath, file: tuningFile },
  ]);

  if (existing.length) {
    const noun = existing.length === 1 ? "file" : "files";
    throw new Error(`Refusing to overwrite existing ${noun}: ${existing.map((entry) => entry.label).join(", ")}. Nothing was written.`);
  }

  const explicit = palette !== undefined || tuning !== undefined;
  const canPrompt = !yes && !explicit && stdin.isTTY && stdout.isTTY;

  if (canPrompt) {
    const accepted = await confirm(stdin, stdout, palettePath, tuningPath);
    if (!accepted) return { written: false, files: [palettePath, tuningPath] };
  }

  const [paletteTemplate, tuningTemplate] = await Promise.all([
    readFile(PALETTE_TEMPLATE_URL, "utf8"),
    readFile(TUNING_TEMPLATE_URL, "utf8"),
  ]);

  await writeAtomically(paletteFile, paletteTemplate);
  await writeAtomically(tuningFile, tuningTemplate);

  return { written: true, files: [palettePath, tuningPath] };
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

async function confirm(stdin, stdout, palettePath, tuningPath) {
  const question = `Smart Colors will create:\n  palette  ${palettePath}\n  tuning   ${tuningPath}\nCreate these files? [Y/n] `;
  const readline = createInterface({ input: stdin, output: stdout });

  try {
    const answer = await readline.question(question);
    return /^(?:|y(?:es)?)$/i.test(answer.trim());
  } finally {
    readline.close();
  }
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
