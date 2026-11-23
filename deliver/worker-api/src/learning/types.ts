// Boztik Learning Hub — shared types for the Worker side of the Learning Hub.
//
// Exam banks (src/learning/exams/*.ts) are the ONLY place correct answers live.
// They are bundled into the Worker and never served to a browser.

export type QuestionKind = "single" | "scenario" | "multi" | "truefalse";

export interface ExamQuestion {
  /** Unique within the course, e.g. "ai-01". */
  id: string;
  /** Course module id this question belongs to ("m01" … "m10"); drives the per-module result breakdown. */
  module: string;
  kind: QuestionKind;
  prompt: string;
  options: string[];
  /** 0-based indexes of the correct option(s). Exactly one for single/scenario/truefalse. */
  correct: number[];
  /** Why the answer is right. Never sent to the learner by default. */
  explain: string;
}

export interface CourseRules {
  slug: string;
  title: string;
  category: string;
  /** Percentage (0–100) required on the written assessment. */
  passMark: number;
  /** Percentage (0–100) required on the practical exercise, when the course has one. */
  practicalPassMark: number | null;
  questionCount: number;
  moduleIds: string[];
  /** Every lesson id in the course, in order. The assessment unlocks when all are complete. */
  lessonIds: string[];
}

export const LEARNING_CATEGORIES = [
  "ai-emerging-technology",
  "cybersecurity-digital-safety",
  "data-analytics",
  "computer-digital-skills",
  "design-creativity",
  "business-entrepreneurship",
  "programming-development",
  "career-professional-skills",
] as const;
export type LearningCategory = (typeof LEARNING_CATEGORIES)[number];
