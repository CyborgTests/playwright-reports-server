export interface AnthropicCacheControl {
  type: 'ephemeral';
}

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
  cache_control?: AnthropicCacheControl;
}

export interface AnthropicImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
  cache_control?: AnthropicCacheControl;
}

export type AnthropicContentBlock = AnthropicTextBlock | AnthropicImageBlock;

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string | AnthropicContentBlock[];
  }>;
  system?: string | AnthropicTextBlock[];
  temperature?: number;
  tools?: AnthropicTool[];
  tool_choice?: { type: 'tool'; name: string } | { type: 'auto' } | { type: 'any' };
}

export interface AnthropicResponseContentBlock {
  type: 'text' | 'tool_use';
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

export interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: AnthropicResponseContentBlock[];
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

export interface OpenAIResponseFormat {
  type: 'json_schema';
  json_schema: {
    name: string;
    description?: string;
    schema: Record<string, unknown>;
    strict?: boolean;
  };
}

export interface OpenAITextPart {
  type: 'text';
  text: string;
}

export interface OpenAIImagePart {
  type: 'image_url';
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
}

export type OpenAIMessageContent = string | Array<OpenAITextPart | OpenAIImagePart>;

export interface OpenAIRequest {
  model: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: OpenAIMessageContent;
  }>;
  max_tokens?: number;
  temperature?: number;
  response_format?: OpenAIResponseFormat;
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
      reasoning_content?: string;
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
