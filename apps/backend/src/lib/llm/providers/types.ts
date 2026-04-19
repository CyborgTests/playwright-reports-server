export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  system?: string;
  temperature?: number;
  stream?: boolean;
}

export interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{
    type: string;
    text: string;
  }>;
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface AnthropicModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

export interface AnthropicModelList {
  data: AnthropicModel[];
}

export interface OpenAIRequest {
  model: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  max_tokens?: number;
  temperature?: number;
}

export interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAIModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

export interface OpenAIModelList {
  data: OpenAIModel[];
}

export interface OpenAIStreamChoice {
  index: number;
  delta: {
    content?: string;
    reasoning_content?: string;
    role?: string;
  };
  finish_reason: string | null;
}

export interface OpenAIStreamUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OpenAIStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIStreamChoice[];
  usage?: OpenAIStreamUsage;
}

export interface AnthropicStreamContentBlockDelta {
  type: string;
  delta: {
    type: string;
    text?: string;
  };
}

export interface AnthropicStreamChunk {
  type: string;
  index?: number;
  delta?: {
    type: string;
    text?: string;
  };
  content_block?: AnthropicStreamContentBlockDelta;
  usage?: {
    output_tokens: number;
  };
  message?: {
    usage: {
      input_tokens: number;
      output_tokens: number;
    };
  };
}
