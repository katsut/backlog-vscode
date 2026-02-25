import * as vscode from 'vscode';
import * as https from 'https';
import { ConfigService } from './configService';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

const SYSTEM_PROMPTS: Record<string, string> = {
  'backlog-reply':
    'あなたはビジネスコミュニケーションのアシスタントです。課題のコメントスレッドの文脈を踏まえて、簡潔で丁寧な返信を書いてください。返信文のみを出力し、前置きや説明は不要です。コメントスレッドと同じ言語で書いてください。',
  'slack-reply':
    'あなたはビジネスコミュニケーションのアシスタントです。Slackスレッドの文脈を踏まえて、簡潔でカジュアルな返信を書いてください。返信文のみを出力し、前置きや説明は不要です。スレッドと同じ言語で書いてください。',
};

export class AnthropicService {
  constructor(private configService: ConfigService) {}

  async getApiKey(): Promise<string | undefined> {
    return await this.configService.getAnthropicApiKey();
  }

  async setApiKey(key: string): Promise<void> {
    await this.configService.setAnthropicApiKey(key);
  }

  async ensureApiKey(): Promise<string | undefined> {
    let key = await this.getApiKey();
    if (key) {
      return key;
    }
    key = await vscode.window.showInputBox({
      prompt: 'Anthropic API Key を入力してください (Team Plan)',
      password: true,
      placeHolder: 'sk-ant-...',
    });
    if (key) {
      await this.setApiKey(key);
    }
    return key;
  }

  private getModel(): string {
    return vscode.workspace.getConfiguration('nulab').get<string>('ai.model') || DEFAULT_MODEL;
  }

  async generateReplyDraft(
    context: string,
    action: 'backlog-reply' | 'slack-reply',
    onChunk: (text: string) => void,
    token?: vscode.CancellationToken
  ): Promise<string> {
    const apiKey = await this.ensureApiKey();
    if (!apiKey) {
      throw new Error('Anthropic API Key が設定されていません');
    }

    const systemPrompt = SYSTEM_PROMPTS[action] || SYSTEM_PROMPTS['backlog-reply'];
    const model = this.getModel();

    const body = JSON.stringify({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `以下の文脈を踏まえて返信を書いてください。\n\n${context}`,
        },
      ],
      stream: true,
    });

    return new Promise<string>((resolve, reject) => {
      if (token?.isCancellationRequested) {
        reject(new Error('Cancelled'));
        return;
      }

      const url = new URL(ANTHROPIC_API_URL);
      const req = https.request(
        {
          hostname: url.hostname,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
          },
        },
        (res) => {
          if (res.statusCode !== 200) {
            let errorBody = '';
            res.on('data', (chunk: Buffer) => {
              errorBody += chunk.toString();
            });
            res.on('end', () => {
              reject(new Error(`Anthropic API error (${res.statusCode}): ${errorBody}`));
            });
            return;
          }

          let fullText = '';
          let buffer = '';

          res.on('data', (chunk: Buffer) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.startsWith('data: ')) {
                continue;
              }
              const data = line.slice(6).trim();
              if (data === '[DONE]') {
                continue;
              }
              try {
                const event = JSON.parse(data);
                if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                  const text = event.delta.text as string;
                  fullText += text;
                  onChunk(text);
                }
              } catch {
                // skip malformed JSON
              }
            }
          });

          res.on('end', () => {
            resolve(fullText);
          });

          res.on('error', reject);
        }
      );

      req.on('error', reject);

      token?.onCancellationRequested(() => {
        req.destroy();
        reject(new Error('Cancelled'));
      });

      req.write(body);
      req.end();
    });
  }
}
