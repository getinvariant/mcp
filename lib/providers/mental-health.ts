import { Provider, ProviderCategory, ProviderInfo, QueryResult } from "./types.js";

const CRISIS_RESOURCES = [
  {
    name: "988 Suicide & Crisis Lifeline",
    type: "hotline",
    contact: "Call or text 988",
    url: "https://988lifeline.org",
    available: "24/7",
    description: "Free, confidential support for people in distress, prevention and crisis resources.",
    categories: ["suicide", "crisis", "distress", "depression", "anxiety"],
  },
  {
    name: "Crisis Text Line",
    type: "text",
    contact: "Text HOME to 741741",
    url: "https://www.crisistextline.org",
    available: "24/7",
    description: "Free, 24/7 text-based mental health support and crisis intervention.",
    categories: ["crisis", "anxiety", "depression", "abuse", "self-harm"],
  },
  {
    name: "SAMHSA National Helpline",
    type: "hotline",
    contact: "1-800-662-4357",
    url: "https://www.samhsa.gov/find-help/national-helpline",
    available: "24/7, 365 days",
    description: "Free, confidential treatment referral and information service for substance abuse and mental health.",
    categories: ["substance abuse", "addiction", "treatment", "referral"],
  },
  {
    name: "NAMI Helpline",
    type: "hotline",
    contact: "1-800-950-6264 or text 'HELPLINE' to 62640",
    url: "https://www.nami.org/help",
    available: "Mon-Fri, 10am-10pm ET",
    description: "Free support, education, and advocacy for individuals and families affected by mental illness.",
    categories: ["mental illness", "family support", "education", "advocacy"],
  },
  {
    name: "Veterans Crisis Line",
    type: "hotline",
    contact: "Dial 988 then press 1, or text 838255",
    url: "https://www.veteranscrisisline.net",
    available: "24/7",
    description: "Connects veterans and their families with qualified responders.",
    categories: ["veterans", "military", "ptsd", "crisis"],
  },
  {
    name: "Trevor Project",
    type: "hotline",
    contact: "1-866-488-7386 or text START to 678-678",
    url: "https://www.thetrevorproject.org",
    available: "24/7",
    description: "Crisis intervention and suicide prevention for LGBTQ+ young people.",
    categories: ["lgbtq", "youth", "suicide prevention", "crisis"],
  },
  {
    name: "Postpartum Support International",
    type: "hotline",
    contact: "1-800-944-4773 or text 'HELP' to 988",
    url: "https://www.postpartum.net",
    available: "24/7",
    description: "Support for perinatal mood and anxiety disorders.",
    categories: ["postpartum", "pregnancy", "anxiety", "depression", "maternal"],
  },
  {
    name: "NIMH Mental Health Information",
    type: "resource",
    contact: "https://www.nimh.nih.gov/health",
    url: "https://www.nimh.nih.gov",
    available: "Always (web)",
    description: "Comprehensive mental health information from the National Institute of Mental Health.",
    categories: ["research", "information", "disorders", "treatment"],
  },
];

export class MentalHealthProvider implements Provider {
  info: ProviderInfo = {
    id: "mental_health",
    name: "Mental Health Crisis Resources",
    category: ProviderCategory.MENTAL_HEALTH,
    description: "Curated database of mental health crisis hotlines, text lines, and resources across the US.",
    availableActions: [
      {
        action: "crisis_resources",
        description: "List all crisis resources, optionally filtered by type (hotline, text, resource)",
        parameters: {
          type: { type: "string", description: "Filter by type: hotline, text, or resource", required: false },
        },
      },
      {
        action: "resource_search",
        description: "Search resources by keyword (e.g., anxiety, veterans, substance abuse)",
        parameters: {
          keyword: { type: "string", description: "Keyword to search for", required: true },
        },
      },
    ],
    requiresApiKey: false,
  };

  isAvailable(): boolean {
    return true;
  }

  async query(action: string, params: Record<string, unknown>): Promise<QueryResult> {
    switch (action) {
      case "crisis_resources": {
        const type = params.type as string | undefined;
        const results = type ? CRISIS_RESOURCES.filter((r) => r.type === type) : CRISIS_RESOURCES;
        return { success: true, data: results };
      }
      case "resource_search": {
        const keyword = (params.keyword as string)?.toLowerCase();
        if (!keyword) return { success: false, error: "Missing required parameter: keyword" };
        const results = CRISIS_RESOURCES.filter(
          (r) =>
            r.categories.some((c) => c.includes(keyword)) ||
            r.name.toLowerCase().includes(keyword) ||
            r.description.toLowerCase().includes(keyword)
        );
        return { success: true, data: results };
      }
      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  }
}
