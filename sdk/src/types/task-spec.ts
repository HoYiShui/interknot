export interface TaskSpec {
  type: string;
  version: string;
  spec: Record<string, any>;
  requirements?: Record<string, any>;
}

export interface ComputeLlmInferenceSpec extends TaskSpec {
  type: "compute/llm-inference";
  spec: {
    model: string;
    maxTokens?: number;
    temperature?: number;
  };
  requirements?: {
    minVramGb?: number;
    maxLatencyMs?: number;
  };
}
