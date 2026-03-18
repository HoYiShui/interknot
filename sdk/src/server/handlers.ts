/** Task execution handler interface */
export interface TaskHandler {
  execute(input: TaskInput): Promise<TaskOutput>;
}

export interface TaskInput {
  prompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface TaskOutput {
  output: string;
  model: string;
  tokensUsed: number;
  latencyMs: number;
}

/**
 * Mock handler — returns a hardcoded response after a delay.
 * Used for development and testing without real GPU/model.
 */
export class MockTaskHandler implements TaskHandler {
  constructor(private readonly delayMs: number = 1000) {}

  async execute(input: TaskInput): Promise<TaskOutput> {
    const start = Date.now();
    await new Promise((r) => setTimeout(r, this.delayMs));
    return {
      output: `[Mock response to: "${input.prompt.slice(0, 50)}..."] This is a simulated LLM response for testing the Inter-Knot protocol flow.`,
      model: input.model ?? "mock-model",
      tokensUsed: Math.floor(Math.random() * 500) + 100,
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * Ollama handler — sends prompt to a local Ollama instance for real inference.
 * Requires Ollama running locally (default: http://localhost:11434).
 */
export class OllamaTaskHandler implements TaskHandler {
  constructor(
    private readonly ollamaUrl: string = "http://localhost:11434",
  ) {}

  async execute(input: TaskInput): Promise<TaskOutput> {
    const start = Date.now();
    const model = input.model ?? "llama3.1:8b";

    const response = await fetch(`${this.ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: input.prompt,
        stream: false,
        options: {
          num_predict: input.maxTokens ?? 1024,
          temperature: input.temperature ?? 0.7,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as {
      response: string;
      eval_count?: number;
    };

    return {
      output: data.response,
      model,
      tokensUsed: data.eval_count ?? 0,
      latencyMs: Date.now() - start,
    };
  }
}
