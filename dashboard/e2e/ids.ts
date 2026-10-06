import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Ids written by global-setup. A JSON fixture rather than env vars because SV18 forbids
 * any .env* file on this project, and threading six ids through the shell is worse than
 * reading one file.
 */
export const ids: Record<string, string> = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "ids.json"), "utf8"),
)
