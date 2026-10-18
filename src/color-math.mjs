import { createVerificationCore } from "./verification-core.mjs";

/**
 * Generator-facing facade of the shared numeric contract.
 *
 * The single implementation lives in `createVerificationCore()` so that the
 * generator and the verifier cannot drift apart, and so the core can be
 * serialized whole into an offline runtime. This module keeps the exact public
 * signatures the generator, the reports and the tests already consume; the
 * formulas, precision, gamut mapping and serialized output are unchanged.
 */
const { fitToSrgb, contrast, oklch, serializedColor, mixOklch, clamp } = createVerificationCore();

export { fitToSrgb, contrast, oklch, serializedColor, mixOklch, clamp };
