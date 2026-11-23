# Boztik Learning — course authoring contract

Each course lives in `learning/courses/<slug>/course.json`. It is the **single source of truth**
for the public course page, the lesson player, and (via a generated manifest) the Worker's
lesson-completion rules. Run `npm run learning:build` in `deliver/worker-api` after editing.

Exam questions are **never** stored here. They live only in the Worker
(`deliver/worker-api/src/learning/exams/<slug>.ts`) so correct answers are never shipped to browsers.
Knowledge checks inside lessons are formative, public, and deliberately different from exam questions.

## course.json

```jsonc
{
  "slug": "practical-ai-productivity",          // matches folder + exam file name
  "title": "…",
  "subtitle": "…",                               // one line
  "category": "ai-emerging-technology",          // one of the 8 category ids
  "level": "Beginner–Intermediate",
  "summary": "≤160 chars. Used for meta description and cards.",
  "description": "2–3 sentences for the course page.",
  "estimatedHours": "5–6 hours",                 // string shown to learners
  "outcomes": ["6–8 course-level objectives, each starting with a verb"],
  "audience": ["3–4 short 'who this is for' lines"],
  "prerequisites": "One sentence.",
  "modules": [
    {
      "id": "m01",                               // m01 … m10, in order
      "title": "…",
      "summary": "One sentence.",
      "objectives": ["3–4 module objectives"],
      "lessons": [
        { "id": "m01-l01", "title": "…", "minutes": 8, "blocks": [ /* see below */ ] }
      ]
    }
  ],
  "furtherLearning": ["2–4 plain-text suggestions for what to learn next"]
}
```

Every course has **exactly 10 modules (m01–m10)**, **2–3 lessons per module**
(lesson ids `m01-l01`, `m01-l02`, …).

## Lesson blocks

| `type` | Fields | Use |
|---|---|---|
| `p` | `text` | A paragraph. 1–4 sentences. |
| `h` | `text` | Sub-heading inside a lesson. |
| `list` | `ordered` (bool), `items[]` | Short lists. |
| `callout` | `tone` (`tip`\|`warning`\|`key`\|`example`), `title`, `text` | Highlighted note. |
| `steps` | `title`, `items[{title,text}]` | A numbered process / simple flow diagram. 3–6 items. |
| `table` | `caption`, `headers[]`, `rows[][]` | Comparisons. Max 6 columns. |
| `code` | `label`, `text` | A sample prompt, formula, or checklist the learner can copy. Plain text. |
| `exercise` | `title`, `intro`, `tasks[]`, `reflection` | A hands-on activity. Learner ticks it as done. |
| `check` | `id`, `kind` (`single`\|`multi`\|`truefalse`), `prompt`, `options[]`, `correct[]`, `explain` | Knowledge check. `correct` is an array of 0-based option indexes. `truefalse` uses options `["True","False"]`. |

Inline formatting inside any `text`/`items`: `**bold**` and `` `code` `` only. **No HTML.** No markdown links
(write the name instead). No emoji.

## Content rules

* Teach like a knowledgeable human instructor. Plain, direct sentences. Concrete examples from everyday life,
  work, and small business. South African context is welcome where natural (rand, SARS, POPIA, load-shedding,
  WhatsApp, spaza/side-hustle/small-agency examples) but the learning must make sense anywhere.
* **Banned filler:** "In today's fast-paced world", "In the digital age", "delve", "dive in", "unlock the power",
  "game-changer", "it is important to note", "in conclusion", "navigate the landscape", "seamless", "leverage"
  (as a verb), "revolutionise". No sentence that could open any article on any topic.
* Do not pad. Each lesson ≈ 300–550 words of prose across its blocks, with at least one example, and a
  `check` block at the end (one per lesson). Each module has at least one `exercise`.
* No walls of text: alternate paragraphs with a `callout`, `steps`, `table`, or `code` block.
* Be accurate. Do not invent statistics, laws, product features, prices or quotes. Prefer principles and
  verifiable facts. Where a tool's interface changes often, teach the idea, not exact menu paths.
* Cybersecurity: defensive recognition and protection only. No intrusion, exploitation, credential-attack,
  malware-building or evasion instructions.
* Knowledge-check ids: `<lessonId>-c1` (and `-c2`).
* Course 3 teaches with its public practice dataset `learning/assets/data/boztik-cafe-practice.csv`.

## Exam banks (Worker only)

`deliver/worker-api/src/learning/exams/<slug>.ts` exports `export const questions: ExamQuestion[]`
(see `src/learning/types.ts`). Exactly **30** questions, **exactly 3 per module** (`module: "m01"` …),
unique ids `<prefix>-01` … `<prefix>-30`.

Mix: ~18 `single`, ~6 `scenario` (single answer, prompt opens with a short realistic situation),
~3 `multi` (prompt says "Select all that apply"; 2–3 correct of 4–5 options), ~3 `truefalse`.
Every question must be answerable from the course material, unambiguous (one defensible answer set),
free of "all of the above" / "none of the above", with plausible distractors of similar length.
Do not copy knowledge-check wording. Vary the position of correct options.
