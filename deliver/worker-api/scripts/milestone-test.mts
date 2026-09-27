// Unit test for the pure milestone rules in src/lib/milestones.ts.
// Run: npm test:unit  (node runs .mts directly — Node >= 22 type-stripping).
import assert from "node:assert/strict";
import { thresholdsFor, reachedMilestones, nextMilestone, milestoneEmailContent, metricStep } from "../src/lib/milestones.ts";

let failed = 0;
const eq = (label, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}\n      got      ${a}\n      expected ${e}`);
  }
};

console.log("metricStep");
eq("views step", metricStep("views"), 1000);
eq("downloads step", metricStep("downloads"), 10);
eq("shares step", metricStep("shares"), 10);
eq("deliveries step (irregular ladder)", metricStep("deliveries"), null);

console.log("thresholdsFor — regular metrics");
eq("views up to 2500", thresholdsFor("views", 2500), [1000, 2000]);
eq("views up to 999", thresholdsFor("views", 999), []);
eq("downloads up to 32", thresholdsFor("downloads", 32), [10, 20, 30]);
eq("shares up to 11", thresholdsFor("shares", 11), [10]);
eq("non-finite / <1 return []", thresholdsFor("views", 0.5), []);
eq("non-finite / <1 return []", thresholdsFor("views", Number.NaN), []);

console.log("thresholdsFor — deliveries ladder");
eq("deliveries up to 12", thresholdsFor("deliveries", 12), [10]);
eq("deliveries up to 100 relates to head 100", thresholdsFor("deliveries", 100), [10, 25, 50, 100]);
// ladder: after 1000 come 2500 (×2.5), then 5000 (×2), then 10000 (×2)...
eq("deliveries top of ladder", thresholdsFor("deliveries", 3000), [10, 25, 50, 100, 250, 500, 1000, 2500]);
eq("deliveries ladder continues", thresholdsFor("deliveries", 6000), [10, 25, 50, 100, 250, 500, 1000, 2500, 5000]);

console.log("reachedMilestones");
eq("not initialized -> none", reachedMilestones("views", 5000, new Set([1000]), false), []);
eq("filters already sent", reachedMilestones("views", 5000, new Set([1000, 3000]), true), [2000, 4000, 5000]);
eq("nothing new when all sent", reachedMilestones("downloads", 20, new Set([10, 20]), true), []);

console.log("nextMilestone");
eq("views next", nextMilestone("views", 1000), 2000);
eq("downloads next", nextMilestone("downloads", 10), 20);
eq("deliveries next after 50", nextMilestone("deliveries", 50), 100);
eq("deliveries next after 1000", nextMilestone("deliveries", 1000), 2500);

console.log("milestoneEmailContent");
eq("subject views", milestoneEmailContent("views", 1000).subject, "BOZTIK COMMAND CENTRE — You just hit 1,000 views");
eq("subject downloads", milestoneEmailContent("downloads", 20).subject, "BOZTIK COMMAND CENTRE — 20 downloads");
eq("subject deliveries", milestoneEmailContent("deliveries", 100).subject, "BOZTIK COMMAND CENTRE — 100 deliveries");
eq("deliveries body mentions next stop", milestoneEmailContent("deliveries", 100).text.includes("Next stop: 250."), true);
eq("plain text present", typeof milestoneEmailContent("views", 2000).text === "string", true);
eq("html mirror present", milestoneEmailContent("views", 2000).html.includes("2,000 views"), true);

console.log(failed === 0 ? "\nAll milestone unit tests passed." : `\n${failed} assertion(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);