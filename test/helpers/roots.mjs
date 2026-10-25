/**
 * Package and reference-site roots for the test suite.
 *
 * `PACKAGE_ROOT` is the package checkout itself. `SITE_ROOT` is the reference site's checkout:
 * it comes from `SMART_COLORS_SITE_ROOT` or, only as a convenience for the explicit site group,
 * from the monorepo-shaped sibling of this package. Default groups never import the site file, so a
 * flat clone needs neither the sibling checkout nor its token inputs.
 */
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HELPER_DIR = path.dirname(fileURLToPath(import.meta.url));
export const TEST_DIR = path.resolve(HELPER_DIR, "..");
export const PACKAGE_ROOT = path.resolve(TEST_DIR, "..");

const SIBLING_SITE_ROOT = path.resolve(PACKAGE_ROOT, "../..");
export const SITE_ROOT = process.env.SMART_COLORS_SITE_ROOT
  ? path.resolve(process.env.SMART_COLORS_SITE_ROOT)
  : SIBLING_SITE_ROOT;

export const SITE_INPUTS = Object.freeze([
  "smart-colors.config.mjs",
  "src/styles/tokens/palette.css",
  "src/styles/tokens/colors.css",
  "src/styles/tokens/colors-tuning.css",
]);

/**
 * Fail before a site proof starts when the reference inputs are missing. This is a preflight, not a
 * skip: an explicit site command must not report success without the files it claims to verify.
 */
export async function assertSiteRoot(root = SITE_ROOT) {
  for (const relative of SITE_INPUTS) {
    try {
      await access(path.join(root, relative));
    } catch {
      throw new Error(
        `Smart Colors site root unavailable at ${root}: missing ${relative}. ` +
        "Set SMART_COLORS_SITE_ROOT to the reference site checkout; the site group does not fall back to a partial root.",
      );
    }
  }
  return root;
}
