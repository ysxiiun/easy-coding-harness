import chalk from "chalk";
import figlet from "figlet";
import { VERSION } from "../constants/version.js";

export interface BannerPreset {
  font: "ANSI Shadow" | "Small Shadow" | "Small Slant";
  horizontalLayout?: "full";
}

const WIDE_TERMINAL_WIDTH = 88;
const MEDIUM_TERMINAL_WIDTH = 72;

export function renderBanner(): void {
  const terminalWidth = process.stdout.columns ?? 120;
  const art = figlet.textSync("Easy Coding", selectBannerPreset(terminalWidth));
  console.log(colorizeBanner(art));
  console.log(chalk.bold.white(`  Easy Coding Harness  ${chalk.cyan(`v${VERSION}`)}\n`));
}

export function selectBannerPreset(width: number): BannerPreset {
  if (width >= WIDE_TERMINAL_WIDTH) {
    return { font: "ANSI Shadow", horizontalLayout: "full" };
  }

  if (width >= MEDIUM_TERMINAL_WIDTH) {
    return { font: "Small Shadow", horizontalLayout: "full" };
  }

  return { font: "Small Slant" };
}

export function colorizeBanner(art: string): string {
  const colors = [chalk.cyanBright, chalk.cyan, chalk.blueBright, chalk.blue];
  return art
    .split("\n")
    .map((line, index) => colors[index % colors.length](line))
    .join("\n");
}
