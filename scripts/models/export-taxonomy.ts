/**
 * Writes the taxonomy the offline trainer reads.
 *
 * The vocabulary is declared in `src/lib/ai/taxonomy.ts`, which is also what
 * `finalize` validates against and what the teacher is asked for. This script
 * only serialises it, so the trainer cannot hold a second copy. A test in
 * `taxonomy.test.ts` asserts the exported shape still matches the source.
 *
 *   npx tsx scripts/models/export-taxonomy.ts
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTaxonomy, HEADS } from "../../src/lib/ai/taxonomy";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const target = join(root, "tools", "models", "artifacts", "taxonomy.json");

const taxonomy = buildTaxonomy();
const json = JSON.stringify(taxonomy, null, 2);
const sha256 = createHash("sha256").update(json).digest("hex");

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${json}\n`, "utf8");

console.log(`taxonomy version ${taxonomy.version}`);
console.log("head        kind    cardinality");
for (const head of HEADS) {
  const { kind, cardinality } = taxonomy.heads[head];
  console.log(`  ${head.padEnd(10)}${kind.padEnd(8)}${cardinality}`);
}
console.log(`sha256 ${sha256}`);
console.log(`wrote ${target}`);
