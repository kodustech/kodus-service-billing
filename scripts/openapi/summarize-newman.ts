import fs from "fs";
import path from "path";

const reportPath = process.argv[2] || path.join(".openapi", "newman-report.json");

if (!fs.existsSync(reportPath)) {
  console.error(`Report not found: ${reportPath}`);
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const stats = report?.run?.stats || {};
const failures = report?.run?.failures || [];

const requestStats = stats.requests || { total: 0, failed: 0 };
const assertionStats = stats.assertions || { total: 0, failed: 0 };

console.log("Newman Summary");
console.log(`Requests: ${requestStats.total} total, ${requestStats.failed} failed`);
console.log(
  `Assertions: ${assertionStats.total} total, ${assertionStats.failed} failed`
);

if (failures.length > 0) {
  console.log("\nFailures:");
  for (const failure of failures) {
    const source = failure?.source?.name || "unknown";
    const error = failure?.error?.message || "unknown error";
    console.log(`- ${source}: ${error}`);
  }
}
