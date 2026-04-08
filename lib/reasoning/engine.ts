import { getAllProviders } from "../providers/registry.js";
import { providerKnowledge, intentKeywords, categoryDescriptions } from "./provider-knowledge.js";
import type { Recommendation, RecommendationRequest, Priority } from "./types.js";

/**
 * The Reasoning Engine.
 *
 * Takes a natural-language need, matches it against provider capabilities,
 * scores each candidate, and returns ranked recommendations with explanations.
 */
export function recommend(request: RecommendationRequest): Recommendation[] {
  const { need, priorities = [], budget = "any" } = request;
  const needLower = need.toLowerCase();

  const providers = getAllProviders();
  const scored: Recommendation[] = [];

  for (const provider of providers) {
    const knowledge = providerKnowledge[provider.info.id];
    if (!knowledge) continue;

    // ── 1. Relevance scoring (0-50 pts) ────────────────────────────
    let relevance = 0;
    const matchedKeywords: string[] = [];

    // Check intent keywords
    for (const [keyword, providerIds] of Object.entries(intentKeywords)) {
      if (needLower.includes(keyword) && providerIds.includes(provider.info.id)) {
        // Longer keyword matches are worth more (more specific)
        relevance += Math.min(keyword.split(" ").length * 8, 20);
        matchedKeywords.push(keyword);
      }
    }

    // Check category descriptions
    for (const [category, keywords] of Object.entries(categoryDescriptions)) {
      if (provider.info.category === category) {
        for (const kw of keywords) {
          if (needLower.includes(kw)) {
            relevance += 5;
            matchedKeywords.push(kw);
          }
        }
      }
    }

    // Check provider description and action names
    const providerText = [
      provider.info.description,
      ...provider.info.availableActions.map((a) => `${a.action} ${a.description}`),
    ]
      .join(" ")
      .toLowerCase();

    const needWords = needLower.split(/\s+/).filter((w) => w.length > 3);
    for (const word of needWords) {
      if (providerText.includes(word)) {
        relevance += 3;
      }
    }

    // Check bestFor matches
    for (const use of knowledge.bestFor) {
      const useLower = use.toLowerCase();
      const useWords = useLower.split(/\s+/);
      for (const word of needWords) {
        if (useLower.includes(word)) {
          relevance += 6;
        }
      }
      // Full phrase match bonus
      if (needLower.includes(useLower)) {
        relevance += 15;
      }
    }

    // Cap relevance at 50
    relevance = Math.min(relevance, 50);

    // Skip providers with zero relevance
    if (relevance === 0) continue;

    // ── 2. Priority scoring (0-30 pts) ─────────────────────────────
    let priorityScore = 0;

    for (const priority of priorities) {
      switch (priority) {
        case "cost":
          if (knowledge.pricing.model === "free") priorityScore += 10;
          else if (knowledge.pricing.model === "freemium") priorityScore += 6;
          else priorityScore += 0;
          break;
        case "reliability":
          if (knowledge.reliability === "high") priorityScore += 10;
          else if (knowledge.reliability === "medium") priorityScore += 5;
          else priorityScore += 0;
          break;
        case "speed":
          if (knowledge.dataFreshness === "static") priorityScore += 10; // instant, no API call
          else if (knowledge.dataFreshness === "real-time") priorityScore += 7;
          else priorityScore += 4;
          break;
        case "data-quality":
          if (knowledge.reliability === "high") priorityScore += 8;
          if (knowledge.dataFreshness === "real-time" || knowledge.dataFreshness === "near-real-time")
            priorityScore += 5;
          break;
        case "no-auth":
          if (!provider.info.requiresApiKey) priorityScore += 10;
          break;
      }
    }

    // If no priorities specified, apply balanced defaults
    if (priorities.length === 0) {
      if (knowledge.reliability === "high") priorityScore += 5;
      if (knowledge.pricing.model === "free") priorityScore += 3;
      if (!provider.info.requiresApiKey) priorityScore += 2;
    }

    priorityScore = Math.min(priorityScore, 30);

    // ── 3. Budget filter (0-10 pts) ────────────────────────────────
    let budgetScore = 5; // neutral default

    if (budget === "free") {
      if (knowledge.pricing.model === "free") budgetScore = 10;
      else if (knowledge.pricing.model === "freemium") budgetScore = 6;
      else budgetScore = 0; // paid-only provider
    } else if (budget === "low") {
      if (knowledge.pricing.model === "free") budgetScore = 10;
      else if (knowledge.pricing.model === "freemium") budgetScore = 8;
      else budgetScore = 4;
    }

    // ── 4. Availability bonus (0-10 pts) ───────────────────────────
    const availabilityScore = provider.isAvailable() ? 10 : 0;

    // ── Total ──────────────────────────────────────────────────────
    const totalScore = relevance + priorityScore + budgetScore + availabilityScore;

    // ── Build reasoning string ─────────────────────────────────────
    const reasons: string[] = [];

    if (matchedKeywords.length > 0) {
      reasons.push(`Matches your need for: ${[...new Set(matchedKeywords)].join(", ")}`);
    }

    if (knowledge.pricing.model === "free") {
      reasons.push("Completely free to use");
    } else if (knowledge.pricing.model === "freemium" && knowledge.pricing.freeTier) {
      reasons.push(`Free tier: ${knowledge.pricing.freeTier}`);
    } else {
      reasons.push(`Paid: starts at ${knowledge.pricing.paidStartsAt}`);
    }

    if (knowledge.reliability === "high") {
      reasons.push("High reliability");
    }

    if (!provider.info.requiresApiKey) {
      reasons.push("No API key required");
    }

    if (!provider.isAvailable()) {
      reasons.push("⚠ Not currently configured on server — API key needed");
    }

    if (knowledge.alternatives.length > 0) {
      reasons.push(`Alternatives: ${knowledge.alternatives.join(", ")}`);
    }

    // Find relevant actions
    const relevantActions = provider.info.availableActions
      .filter((a) => {
        const actionText = `${a.action} ${a.description}`.toLowerCase();
        return needWords.some((w) => actionText.includes(w));
      })
      .map((a) => a.action);

    // If no specific action matched, include all
    const actions = relevantActions.length > 0
      ? relevantActions
      : provider.info.availableActions.map((a) => a.action);

    scored.push({
      provider_id: provider.info.id,
      provider_name: provider.info.name,
      score: totalScore,
      reasoning: reasons.join(". ") + ".",
      actions,
      pricing: knowledge.pricing,
      rateLimits: knowledge.rateLimits,
      available: provider.isAvailable(),
    });
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored;
}

/**
 * Compare two or more providers side by side.
 */
export function compareProviders(providerIds: string[]): Record<string, unknown>[] {
  const providers = getAllProviders();
  const results: Record<string, unknown>[] = [];

  for (const id of providerIds) {
    const provider = providers.find((p) => p.info.id === id);
    const knowledge = providerKnowledge[id];

    if (!provider || !knowledge) continue;

    results.push({
      id: provider.info.id,
      name: provider.info.name,
      category: provider.info.category,
      available: provider.isAvailable(),
      requiresApiKey: provider.info.requiresApiKey,
      actions: provider.info.availableActions.map((a) => a.action),
      pricing: knowledge.pricing,
      rateLimits: knowledge.rateLimits,
      strengths: knowledge.strengths,
      weaknesses: knowledge.weaknesses,
      bestFor: knowledge.bestFor,
      dataFreshness: knowledge.dataFreshness,
      reliability: knowledge.reliability,
      alternatives: knowledge.alternatives,
    });
  }

  return results;
}
