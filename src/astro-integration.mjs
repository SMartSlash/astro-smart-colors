import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateColorTokens } from "./generate-colors.mjs";
import { DEFAULT_CONFIG_FILE, loadSmartColorsConfig, resolveProjectUrl } from "./load-config.mjs";

export default function smartColors(options = {}) {
  const configFile = options.configFile ?? DEFAULT_CONFIG_FILE;
  const inlineConfig = { ...options };
  delete inlineConfig.configFile;

  return {
    name: "smart-colors",
    hooks: {
      "astro:config:setup": async ({ config: astroConfig, command, addWatchFile, updateConfig, logger }) => {
        const root = astroConfig.root;
        const smartConfig = await loadSmartColorsConfig({ root, configFile, inlineConfig });
        await runGenerator({ root, configFile, inlineConfig, command, logger });

        addWatchFile(resolveProjectUrl(root, smartConfig.palette));
        addWatchFile(resolveProjectUrl(root, configFile));

        updateConfig({
          vite: {
            plugins: [smartColorsVitePlugin({ root, configFile, inlineConfig, logger })],
          },
        });
      },
    },
  };
}

async function runGenerator({ root, configFile, inlineConfig, command, logger }) {
  const report = await generateColorTokens({ root, configFile, inlineConfig });

  for (const warning of report.warnings) {
    logger.warn(warning);
  }

  if (report.changed) {
    logger.info(command === "build" ? "Generated semantic color tokens before build." : "Generated semantic color tokens.");
  }

  for (const error of report.errors) {
    logger.error(error);
  }

  if (report.errors.length) {
    throw new Error("Smart color generation failed.");
  }
}

function smartColorsVitePlugin({ root, configFile, inlineConfig, logger }) {
  let pending = Promise.resolve();
  let regenerationTimer;

  return {
    name: "smart-colors:vite-watch",
    async configureServer(server) {
      let smartConfig = await loadSmartColorsConfig({ root, configFile, inlineConfig });
      let watchFiles = getWatchFiles(root, configFile, smartConfig);
      server.watcher.add([...watchFiles]);

      const scheduleRegeneration = (changedPath) => {
        const absolutePath = path.resolve(changedPath);
        if (!watchFiles.has(absolutePath)) return;

        clearTimeout(regenerationTimer);
        regenerationTimer = setTimeout(() => {
          pending = pending
            .then(async () => {
              smartConfig = await loadSmartColorsConfig({ root, configFile, inlineConfig });
              watchFiles = getWatchFiles(root, configFile, smartConfig);
              server.watcher.add([...watchFiles]);

              const report = await generateColorTokens({ root, configFile, inlineConfig, config: smartConfig });

              for (const warning of report.warnings) {
                logger.warn(warning);
              }

              if (report.changed) {
                logger.info("Regenerated Smart Colors outputs.");
                server.ws.send({ type: "full-reload" });
              }
            })
            .catch((error) => {
              logger.error(error instanceof Error ? error.message : String(error));
            });
        }, 50);
      };

      for (const event of ["add", "change", "unlink"]) {
        server.watcher.on(event, scheduleRegeneration);
      }

      return () => clearTimeout(regenerationTimer);
    },
  };
}

function getWatchFiles(root, configFile, smartConfig) {
  return new Set([
    fileURLToPath(resolveProjectUrl(root, smartConfig.palette)),
    fileURLToPath(resolveProjectUrl(root, configFile)),
  ].map((filePath) => path.resolve(filePath)));
}
