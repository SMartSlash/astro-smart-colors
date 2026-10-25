import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateColorTokens } from "./colors/generate-colors.mjs";
import { DEFAULT_CONFIG_FILE, loadSmartColorsConfig, resolveProjectUrl } from "./colors/load-config.mjs";

export default function smartColors(options = {}) {
  const configFile = options.configFile;
  const inlineConfig = { ...options };
  delete inlineConfig.configFile;

  return {
    name: "smart-colors",
    hooks: {
      "astro:config:setup": async ({ config: astroConfig, command, addWatchFile, updateConfig, logger }) => {
        const root = astroConfig.root;
        const smartConfig = await loadSmartColorsConfig({ root, configFile, inlineConfig });
        await runGenerator({ root, configFile, inlineConfig, config: smartConfig, command, logger });

        addWatchFile(resolveProjectUrl(root, smartConfig.palette));
        addWatchFile(resolveProjectUrl(root, configFile ?? DEFAULT_CONFIG_FILE));

        updateConfig({
          vite: {
            plugins: [smartColorsVitePlugin({ root, configFile, inlineConfig, logger })],
          },
        });
      },
    },
  };
}

async function runGenerator({ root, configFile, inlineConfig, config, command, logger }) {
  // Keep the exhaustive advisory search out of the dev watcher; the CLI provides it. The caller's
  // already-loaded config is reused, so setup imports the config file once.
  const report = await generateColorTokens({ root, configFile, inlineConfig, config, suggest: false });

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
  let disposed = false;
  let removeWatchListeners;

  return {
    name: "smart-colors:vite-watch",
    async configureServer(server) {
      if (disposed) return;
      let smartConfig = await loadSmartColorsConfig({ root, configFile, inlineConfig });
      if (disposed) return;
      let watchFiles = getWatchFiles(root, configFile, smartConfig);
      server.watcher.add([...watchFiles]);

      const scheduleRegeneration = (changedPath) => {
        if (disposed) return;
        const absolutePath = path.resolve(changedPath);
        if (!watchFiles.has(absolutePath)) return;

        clearTimeout(regenerationTimer);
        regenerationTimer = setTimeout(() => {
          regenerationTimer = undefined;
          if (disposed) return;
          pending = pending
            .then(async () => {
              if (disposed) return;
              const nextConfig = await loadSmartColorsConfig({ root, configFile, inlineConfig });
              if (disposed) return;
              smartConfig = nextConfig;
              watchFiles = getWatchFiles(root, configFile, smartConfig);
              server.watcher.add([...watchFiles]);

              const report = await generateColorTokens({ root, configFile, inlineConfig, config: smartConfig, suggest: false });
              if (disposed) return;

              for (const warning of report.warnings) {
                logger.warn(warning);
              }

              if (report.changed) {
                logger.info("Regenerated Smart Colors outputs.");
                server.ws.send({ type: "full-reload" });
              }
            })
            .catch((error) => {
              if (!disposed) logger.error(error instanceof Error ? error.message : String(error));
            });
        }, 50);
      };

      const watchEvents = ["add", "change", "unlink"];
      for (const event of watchEvents) {
        server.watcher.on(event, scheduleRegeneration);
      }
      removeWatchListeners = () => {
        for (const event of watchEvents) server.watcher.off(event, scheduleRegeneration);
      };
    },
    async closeBundle() {
      disposed = true;
      clearTimeout(regenerationTimer);
      regenerationTimer = undefined;
      removeWatchListeners?.();
      removeWatchListeners = undefined;
      // Vite awaits this hook; already-started writes must settle before close completes.
      await pending;
    },
  };
}

function getWatchFiles(root, configFile, smartConfig) {
  return new Set([
    fileURLToPath(resolveProjectUrl(root, smartConfig.palette)),
    fileURLToPath(resolveProjectUrl(root, configFile ?? DEFAULT_CONFIG_FILE)),
  ].map((filePath) => path.resolve(filePath)));
}
