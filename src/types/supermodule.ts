export type SupermoduleRole = "standalone" | "super-parent" | "submodule-child";

export interface SubmoduleEntry {
  name: string;
  path: string;
  url: string;
}

export interface SupermoduleBoundary {
  submodulePaths: string[];
}

export interface SupermoduleConfig {
  role: SupermoduleRole;
  submodules?: string[];
  parent?: string;
}

export interface InstallContext {
  role: SupermoduleRole;
  initSource: "fresh" | "legacy-easy-coding";
  submodulePaths?: string[];
  parent?: string;
  legacyAssets?: string[];
  legacyMissingHarnessFiles?: string[];
}
