import {
  formatDevPortReport,
  hasBlockingPortConflicts,
  inspectDevPorts,
} from "./dev-port-utils.mjs";

async function main() {
  const results = await inspectDevPorts();
  console.log(formatDevPortReport(results));

  if (hasBlockingPortConflicts(results)) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});