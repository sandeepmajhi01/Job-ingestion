import fs from "fs/promises";
import path from "path";

export type ProviderResult =
  | {
      status: "success";
    }
  | {
      status: "retryable";
      code: 429 | 503;
      message: string;
    }
  | {
      status: "permanent";
      code: 422;
      message: string;
    };

type ProviderResponse = "success" | "429" | "503" | "422";

type ProviderPlan = {
  default: ProviderResponse;
  events: Record<string, ProviderResponse[]>;
};

const fixturePath = path.resolve(
  process.cwd(),
  "fixtures",
  "provider-plan.json",
);

async function loadProviderPlan(): Promise<ProviderPlan> {
  const file = await fs.readFile(fixturePath, "utf-8");

  return JSON.parse(file) as ProviderPlan;
}

export async function verifyJob(
  eventId: string,
  attempt: number,
): Promise<ProviderResult> {
  const plan = await loadProviderPlan();

  const responses = plan.events[eventId];

  const response =
    responses?.[attempt - 1] ?? plan.default;

  switch (response) {
    case "429":
      return {
        status: "retryable",
        code: 429,
        message: "Provider rate limited request",
      };

    case "503":
      return {
        status: "retryable",
        code: 503,
        message: "Provider temporarily unavailable",
      };

    case "422":
      return {
        status: "permanent",
        code: 422,
        message: "Provider rejected job",
      };

    default:
      return {
        status: "success",
      };
  }
}
