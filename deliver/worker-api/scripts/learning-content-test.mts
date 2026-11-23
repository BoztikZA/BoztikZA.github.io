// Validates every Boztik Learning course against the authoring contract in learning/courses/README.md.
//   npm run test:learning-content                      # all courses
//   COURSE=practical-ai-productivity npm run test:learning-content   # one course (while others are in progress)
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExamQuestion } from "../src/learning/types.ts";
import { LEARNING_CATEGORIES } from "../src/learning/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const COURSES_DIR = join(here, "../../../learning/courses");
const EXAMS_DIR = join(here, "../src/learning/exams");

const BANNED = [
  "in today's fast-paced", "in today’s fast-paced", "in the digital age", "delve", "dive in", "dive into", "unlock the power",
  "game-changer", "game changer", "it is important to note", "it's important to note", "it’s important to note", "in conclusion",
  "navigate the landscape", "seamless", "leverage", "revolutionise", "revolutionize", "ever-evolving", "ever evolving",
  "cutting-edge", "in the realm of", "tapestry", "embark on",
];
const EMOJI = /\p{Extended_Pictographic}/u;
const BLOCKS = new Set(["p", "h", "list", "callout", "steps", "table", "code", "exercise", "check"]);
const slugFilter = process.env.COURSE?.trim();

let failures = 0;
let passed = 0;
function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve().then(fn).then(
    () => { passed++; console.log(`  ok  ${name}`); },
    (e) => { failures++; console.log(`  FAIL ${name}\n       ${String(e.message).split("\n").join("\n       ")}`); },
  );
}

const words = (s: string) => (s.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length;
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
const jaccard = (a: string, b: string) => {
  const A = new Set(norm(a).split(" ")), B = new Set(norm(b).split(" "));
  const inter = [...A].filter((x) => B.has(x)).length;
  return inter / (A.size + B.size - inter || 1);
};

function lessonText(blocks: any[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "p": case "h": case "code": out.push(b.text ?? ""); break;
      case "list": out.push(...(b.items ?? [])); break;
      case "callout": out.push(b.title ?? "", b.text ?? ""); break;
      case "steps": out.push(b.title ?? "", ...(b.items ?? []).flatMap((i: any) => [i.title, i.text])); break;
      case "table": out.push(b.caption ?? "", ...(b.headers ?? []), ...(b.rows ?? []).flat()); break;
      case "exercise": out.push(b.title ?? "", b.intro ?? "", ...(b.tasks ?? []), b.reflection ?? ""); break;
      case "check": out.push(b.prompt ?? "", ...(b.options ?? []), b.explain ?? ""); break;
    }
  }
  return out.join(" \n ");
}
/** Teaching prose only (what a learner reads), excluding the quiz-style check block. */
function proseWords(blocks: any[]): number {
  return words(lessonText(blocks.filter((b) => b.type !== "check")));
}

const slugs = readdirSync(COURSES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(COURSES_DIR, d.name, "course.json")))
  .map((d) => d.name)
  .filter((s) => !slugFilter || s === slugFilter);

console.log(`Validating ${slugs.length} course(s): ${slugs.join(", ") || "(none)"}`);
if (slugs.length === 0) { console.log("FAIL no courses found"); process.exit(1); }

for (const slug of slugs) {
  console.log(`\n${slug}`);
  const course = JSON.parse(readFileSync(join(COURSES_DIR, slug, "course.json"), "utf8"));
  const knowledgePrompts: string[] = [];

  await test("top-level fields are present and well-formed", () => {
    assert.equal(course.slug, slug, "slug must match the folder name");
    for (const f of ["title", "subtitle", "level", "summary", "description", "estimatedHours", "prerequisites"]) {
      assert.equal(typeof course[f], "string", `${f} must be a string`);
      assert.ok(course[f].trim().length > 3, `${f} is empty`);
    }
    assert.ok((LEARNING_CATEGORIES as readonly string[]).includes(course.category), `unknown category ${course.category}`);
    assert.ok(course.summary.length <= 160, `summary is ${course.summary.length} chars (max 160)`);
    assert.ok(Array.isArray(course.outcomes) && course.outcomes.length >= 6 && course.outcomes.length <= 8, "outcomes must list 6–8 items");
    assert.ok(Array.isArray(course.audience) && course.audience.length >= 3 && course.audience.length <= 4, "audience must list 3–4 items");
    assert.ok(Array.isArray(course.furtherLearning) && course.furtherLearning.length >= 2 && course.furtherLearning.length <= 4, "furtherLearning must list 2–4 items");
  });

  await test("exactly 10 modules m01–m10, 2–3 lessons each, with objectives", () => {
    assert.equal(course.modules.length, 10, "must have 10 modules");
    course.modules.forEach((m: any, i: number) => {
      const id = `m${String(i + 1).padStart(2, "0")}`;
      assert.equal(m.id, id, `module ${i + 1} must have id ${id}`);
      assert.ok(m.title && m.summary, `${id} needs title and summary`);
      assert.ok(Array.isArray(m.objectives) && m.objectives.length >= 3 && m.objectives.length <= 4, `${id} needs 3–4 objectives`);
      assert.ok(m.lessons.length >= 2 && m.lessons.length <= 3, `${id} must have 2–3 lessons (has ${m.lessons.length})`);
      m.lessons.forEach((l: any, j: number) => {
        assert.equal(l.id, `${id}-l${String(j + 1).padStart(2, "0")}`, `lesson id in ${id} position ${j + 1}`);
        assert.ok(l.title && Number.isInteger(l.minutes) && l.minutes >= 3 && l.minutes <= 25, `${l.id} needs a title and 3–25 minutes`);
      });
    });
  });

  await test("every block uses a known type and has its required fields", () => {
    for (const m of course.modules) for (const l of m.lessons) {
      assert.ok(Array.isArray(l.blocks) && l.blocks.length >= 5, `${l.id} has too few blocks`);
      for (const [i, b] of l.blocks.entries()) {
        const where = `${l.id} block ${i + 1} (${b.type})`;
        assert.ok(BLOCKS.has(b.type), `${where}: unknown block type`);
        const str = (v: unknown, n: string) => assert.ok(typeof v === "string" && v.trim().length > 0, `${where}: ${n} must be a non-empty string`);
        const arr = (v: unknown, n: string, min = 1) => assert.ok(Array.isArray(v) && v.length >= min, `${where}: ${n} must be an array of ≥${min}`);
        if (b.type === "p" || b.type === "h") str(b.text, "text");
        if (b.type === "code") { str(b.label, "label"); str(b.text, "text"); }
        if (b.type === "list") { assert.equal(typeof b.ordered, "boolean", `${where}: ordered must be boolean`); arr(b.items, "items", 2); b.items.forEach((x: unknown) => str(x, "item")); }
        if (b.type === "callout") { assert.ok(["tip", "warning", "key", "example"].includes(b.tone), `${where}: bad tone`); str(b.title, "title"); str(b.text, "text"); }
        if (b.type === "steps") { str(b.title, "title"); arr(b.items, "items", 3); assert.ok(b.items.length <= 6, `${where}: max 6 steps`); b.items.forEach((x: any) => { str(x.title, "step title"); str(x.text, "step text"); }); }
        if (b.type === "table") { arr(b.headers, "headers", 2); assert.ok(b.headers.length <= 6, `${where}: max 6 columns`); arr(b.rows, "rows", 2); b.rows.forEach((r: unknown[]) => assert.equal(r.length, b.headers.length, `${where}: every row needs ${b.headers.length} cells`)); }
        if (b.type === "exercise") { str(b.title, "title"); str(b.intro, "intro"); arr(b.tasks, "tasks", 2); str(b.reflection, "reflection"); }
        if (b.type === "check") {
          str(b.id, "id"); str(b.prompt, "prompt"); str(b.explain, "explain");
          assert.ok(["single", "multi", "truefalse"].includes(b.kind), `${where}: bad kind`);
          arr(b.options, "options", 2); arr(b.correct, "correct", 1);
          assert.ok(b.correct.every((c: number) => Number.isInteger(c) && c >= 0 && c < b.options.length), `${where}: correct index out of range`);
          assert.equal(new Set(b.correct).size, b.correct.length, `${where}: duplicate correct index`);
          if (b.kind === "single") assert.equal(b.correct.length, 1, `${where}: single needs exactly one correct`);
          if (b.kind === "multi") assert.ok(b.correct.length >= 2 && b.options.length >= 4, `${where}: multi needs ≥2 correct of ≥4 options`);
          if (b.kind === "truefalse") assert.deepEqual(b.options, ["True", "False"], `${where}: truefalse options must be ["True","False"]`);
          knowledgePrompts.push(b.prompt);
        }
      }
    }
  });

  await test("each lesson ends with a knowledge check; check ids are unique and well-named", () => {
    const seen = new Set<string>();
    for (const m of course.modules) for (const l of m.lessons) {
      const checks = l.blocks.filter((b: any) => b.type === "check");
      assert.ok(checks.length >= 1 && checks.length <= 2, `${l.id} needs 1–2 checks (has ${checks.length})`);
      assert.equal(l.blocks[l.blocks.length - 1].type, "check", `${l.id} must end with a check`);
      checks.forEach((c: any, k: number) => {
        assert.equal(c.id, `${l.id}-c${k + 1}`, `${l.id}: check id must be ${l.id}-c${k + 1}`);
        assert.ok(!seen.has(c.id), `duplicate check id ${c.id}`); seen.add(c.id);
      });
    }
  });

  await test("every module has at least one practical exercise", () => {
    for (const m of course.modules) {
      const n = m.lessons.flatMap((l: any) => l.blocks).filter((b: any) => b.type === "exercise").length;
      assert.ok(n >= 1, `${m.id} has no exercise block`);
    }
  });

  await test("lessons are a sensible length (280–750 words of teaching prose)", () => {
    const bad: string[] = [];
    let total = 0;
    for (const m of course.modules) for (const l of m.lessons) {
      const n = proseWords(l.blocks); total += n;
      if (n < 280 || n > 750) bad.push(`${l.id}: ${n} words`);
    }
    assert.equal(bad.length, 0, `out of range → ${bad.join("; ")}`);
    console.log(`       (${total} words of teaching prose in total)`);
  });

  await test("no banned filler phrases, no HTML, no emoji, no markdown links", () => {
    const text = JSON.stringify(course, null, 0);
    const lower = lessonText(course.modules.flatMap((m: any) => m.lessons.flatMap((l: any) => l.blocks))).toLowerCase() + " " + [course.summary, course.description, ...course.outcomes].join(" ").toLowerCase();
    for (const phrase of BANNED) assert.ok(!lower.includes(phrase), `banned phrase "${phrase}"`);
    const body = lessonText(course.modules.flatMap((m: any) => m.lessons.flatMap((l: any) => l.blocks)));
    assert.ok(!/<[a-z/][^>]*>/i.test(body), "HTML tags are not allowed in lesson text");
    assert.ok(!EMOJI.test(text), "emoji are not allowed");
    assert.ok(!/\[[^\]]+\]\([^)]+\)/.test(body), "markdown links are not allowed");
    assert.ok(!/https?:\/\//i.test(body), "do not include raw URLs in lessons");
  });

  // ------------------------------------------------------------------ exam bank
  const examPath = join(EXAMS_DIR, `${slug}.ts`);
  await test("an exam bank exists for the course", () => { assert.ok(existsSync(examPath), `missing ${examPath}`); });
  if (!existsSync(examPath)) continue;
  const questions: ExamQuestion[] = (await import(pathToFileURL(examPath).href)).questions;

  await test("exam: exactly 30 questions, 3 per module, unique ids with one prefix", () => {
    assert.equal(questions.length, 30, `has ${questions.length} questions`);
    const ids = new Set(questions.map((q) => q.id));
    assert.equal(ids.size, 30, "duplicate question ids");
    const prefixes = new Set(questions.map((q) => q.id.replace(/-\d+$/, "")));
    assert.equal(prefixes.size, 1, `ids must share one prefix (found ${[...prefixes].join(", ")})`);
    questions.forEach((q, i) => assert.match(q.id, new RegExp(`^${[...prefixes][0]}-${String(i + 1).padStart(2, "0")}$`), `question ${i + 1} id should be ${[...prefixes][0]}-${String(i + 1).padStart(2, "0")}`));
    const moduleIds = course.modules.map((m: any) => m.id);
    for (const mid of moduleIds) assert.equal(questions.filter((q) => q.module === mid).length, 3, `module ${mid} must have exactly 3 questions`);
    assert.ok(questions.every((q) => moduleIds.includes(q.module)), "a question references an unknown module");
  });

  await test("exam: each question is well-formed and unambiguous in shape", () => {
    for (const q of questions) {
      assert.ok(["single", "scenario", "multi", "truefalse"].includes(q.kind), `${q.id}: bad kind`);
      assert.ok(q.prompt.trim().length >= 15, `${q.id}: prompt too short`);
      assert.ok(q.explain.trim().length >= 20, `${q.id}: explain too short`);
      assert.ok(new Set(q.options.map(norm)).size === q.options.length, `${q.id}: duplicate options`);
      assert.ok(q.correct.every((c) => Number.isInteger(c) && c >= 0 && c < q.options.length), `${q.id}: correct index out of range`);
      assert.equal(new Set(q.correct).size, q.correct.length, `${q.id}: duplicate correct index`);
      if (q.kind === "truefalse") { assert.deepEqual(q.options, ["True", "False"], `${q.id}: truefalse options`); assert.equal(q.correct.length, 1, `${q.id}: one correct`); }
      if (q.kind === "single" || q.kind === "scenario") { assert.ok(q.options.length >= 4 && q.options.length <= 5, `${q.id}: needs 4–5 options`); assert.equal(q.correct.length, 1, `${q.id}: exactly one correct`); }
      if (q.kind === "multi") { assert.ok(q.options.length >= 4 && q.options.length <= 5, `${q.id}: needs 4–5 options`); assert.ok(q.correct.length >= 2 && q.correct.length <= 3, `${q.id}: 2–3 correct`); assert.match(q.prompt, /select all that apply/i, `${q.id}: multi prompt must say "Select all that apply"`); }
      for (const o of q.options) assert.ok(!/^(all|none) of the (above|these)/i.test(o.trim()) && !/^both /i.test(o.trim()), `${q.id}: "all/none of the above" style options are not allowed`);
      assert.ok(!EMOJI.test(JSON.stringify(q)), `${q.id}: no emoji`);
      assert.ok(!/<[a-z/][^>]*>/i.test(q.prompt + q.options.join(" ")), `${q.id}: no HTML`);
    }
  });

  await test("exam: kind mix and answer-position spread are healthy", () => {
    const count = (k: string) => questions.filter((q) => q.kind === k).length;
    assert.ok(count("single") >= 14, `needs ≥14 single (has ${count("single")})`);
    assert.ok(count("scenario") >= 5, `needs ≥5 scenario (has ${count("scenario")})`);
    assert.ok(count("multi") >= 2, `needs ≥2 multi (has ${count("multi")})`);
    assert.ok(count("truefalse") >= 2, `needs ≥2 truefalse (has ${count("truefalse")})`);
    const singles = questions.filter((q) => q.kind === "single" || q.kind === "scenario");
    const byPos: Record<number, number> = {};
    for (const q of singles) byPos[q.correct[0] as number] = (byPos[q.correct[0] as number] ?? 0) + 1;
    const worst = Math.max(...Object.values(byPos));
    assert.ok(worst / singles.length <= 0.4, `correct answer sits in the same position too often (${JSON.stringify(byPos)})`);
    const tf = questions.filter((q) => q.kind === "truefalse");
    assert.ok(!tf.every((q) => q.correct[0] === tf[0]?.correct[0]), "true/false answers should not all be the same");
  });

  await test("exam: no banned phrases, and questions are distinct from the public knowledge checks", () => {
    const blob = questions.map((q) => `${q.prompt} ${q.options.join(" ")} ${q.explain}`).join(" ").toLowerCase();
    for (const phrase of BANNED) assert.ok(!blob.includes(phrase), `banned phrase "${phrase}" in exam bank`);
    for (const q of questions) {
      for (const kp of knowledgePrompts) assert.ok(jaccard(q.prompt, kp) < 0.7, `${q.id} is too similar to a public knowledge check: "${kp.slice(0, 70)}…"`);
    }
    for (let i = 0; i < questions.length; i++) for (let j = i + 1; j < questions.length; j++) {
      assert.ok(jaccard((questions[i] as ExamQuestion).prompt, (questions[j] as ExamQuestion).prompt) < 0.8, `${(questions[i] as ExamQuestion).id} and ${(questions[j] as ExamQuestion).id} are near-duplicates`);
    }
  });
}

console.log(`\nlearning-content: ${passed} checks passed${failures ? `, ${failures} FAILED` : ""}`);
if (failures) process.exit(1);
