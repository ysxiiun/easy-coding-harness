import { execFileSync } from "node:child_process";
import { it } from "vitest";

it("reuses only unchanged check inputs and bounds fingerprint work", () => {
  execFileSync("python3", ["-B", "test/shared-hooks/scoped_inputs_test.py"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: "pipe",
  });
}, 30000);
