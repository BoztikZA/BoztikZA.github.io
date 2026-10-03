/**
 * Boztik Growth — Marketing Engine seam (Phase 1).
 *
 * This file is the ONE place that knows about an AI provider. In Phase 1 no
 * AI provider is connected: drafting is manual. The seam exists so Phase 2 can
 * plug a provider (e.g. Anthropic Claude) in here without touching routes or UI.
 *
 * Conceptual chain:
 *   Command Centre → Growth Content Studio → Marketing Engine → AI Provider → Draft
 *
 * No API keys or provider code live here yet. The only provider is `manual`,
 * which reports "not connected" so the UI never pretends a draft was AI-written.
 */

export interface AIPrompt {
  /** System / "persona" context (e.g. relevant knowledge-base entries). */
  system: string;
  /** The user's request (e.g. "write an X post about this service"). */
  user: string;
}

export interface AIProvider {
  readonly id: string;
  /** Returns the model's text, or null when the provider is unavailable/off. */
  complete(prompt: AIPrompt, opts?: { maxTokens?: number }): Promise<{ text: string } | null>;
}

/** Manual-only provider. Always reports "not connected". */
export const manualAIProvider: AIProvider = {
  id: "manual",
  async complete() {
    return null;
  },
};

/** The single engine used by all Growth routes. Provider stays manual in Phase 1. */
export const growthEngine = {
  provider: manualAIProvider as AIProvider,

  /**
   * Effective AI status. "active" only when a real provider is wired in AND the
   * PAUSE-AI switch (settings key `growth.ai_status`) is not "paused".
   * Phase 1 always yields "paused".
   */
  status(aiPaused: boolean): "active" | "paused" {
    return growthEngine.provider.id === "manual" || aiPaused ? "paused" : "active";
  },
};
