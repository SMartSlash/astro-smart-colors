import { styleText } from "node:util";

const COLOR = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);

export function paint(text, ...formats) {
  return COLOR && formats.length ? styleText(formats, text) : text;
}

export const badge = () => paint("[smart-colors]", "bold", "cyan");
export const title = (text) => `${paint("●", "cyan")} ${paint(text, "bold")}`;
export const check = () => paint("✔", "green");
export const warn = () => paint("!", "yellow");
export const arrow = () => paint("→", "cyan");
export const file = (text) => paint(text, "underline");
export const note = (text) => paint(text, "dim");
