export interface SkillStep {
  type:
    'detect_intent' | 'request_info' | 'tag' | 'summarize' | 'send_message' | 'transfer_to_team';
  intent?: string;
  phrases?: string[];
  field?: string;
  prompt?: string;
  tag?: string;
  source?: 'text' | 'knowledge';
  text?: string;
  group?: string;
}

export interface Skill {
  id: string;
  ai_agent_id: string | null;
  name: string;
  kind: string;
  instruction: string | null;
  steps: SkillStep[];
  active: boolean;
  runs_count: number;
  updated_at: string;
}

export interface AiAgent {
  id: string;
  name: string;
  kind: 'ai_agent' | 'copilot';
  tone: string | null;
  active: boolean;
  skills_count: number;
}

export interface SkillLogEntry {
  step: string;
  detail: string;
  ok: boolean;
}

export interface SkillPreview {
  outcome: 'answered' | 'handed_off' | 'skipped';
  reply: string | null;
  tags: string[];
  transfer_to: string | null;
  summary: string | null;
  log: SkillLogEntry[];
  errors: string[];
}

export interface KnowledgeSource {
  id: string;
  ai_agent_id: string;
  name: string;
  type: string;
  status: string;
  chunk_count: number;
  updated_at: string;
}

/** Human-readable one-liner for a step, used in the editor list. */
export function describeStep(step: SkillStep): string {
  switch (step.type) {
    case 'detect_intent':
      return `Only run when the message is about “${step.intent ?? '?'}”`;
    case 'request_info':
      return `Ask for ${step.field ?? 'information'} — “${step.prompt ?? ''}”`;
    case 'tag':
      return `Tag the conversation “${step.tag ?? '?'}”`;
    case 'summarize':
      return 'Write a summary for the agent who picks it up';
    case 'send_message':
      return step.source === 'knowledge'
        ? 'Answer from the knowledge base'
        : `Reply “${step.text ?? ''}”`;
    case 'transfer_to_team':
      return `Hand over to ${step.group ?? '?'}`;
    default:
      return step.type;
  }
}
