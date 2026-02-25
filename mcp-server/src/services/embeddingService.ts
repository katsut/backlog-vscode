// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pipeline = (text: string, options?: Record<string, unknown>) => Promise<any>;

export class EmbeddingService {
  private pipeline: Pipeline | null = null;
  private modelName: string;
  private initPromise: Promise<void> | null = null;

  constructor(modelName: string = 'Xenova/multilingual-e5-small') {
    this.modelName = modelName;
  }

  async ensureInitialized(): Promise<void> {
    if (this.pipeline) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.init().catch((e) => {
      this.initPromise = null;
      throw e;
    });
    return this.initPromise;
  }

  private async init(): Promise<void> {
    console.error(`Loading embedding model: ${this.modelName}...`);
    const { pipeline } = await import('@huggingface/transformers');
    // Use `any` to avoid TS2590: union type too complex
    this.pipeline = (await (pipeline as any)('feature-extraction', this.modelName, {
      dtype: 'fp32',
    })) as Pipeline;
    console.error(`Model loaded: ${this.modelName}`);
  }

  async embedSingle(text: string): Promise<number[]> {
    await this.ensureInitialized();
    const prefixed = this.addQueryPrefix(text);
    const result = await this.pipeline!(prefixed, {
      pooling: 'mean',
      normalize: true,
    });
    return Array.from(result.data as Float32Array);
  }

  async embed(texts: string[]): Promise<number[][]> {
    await this.ensureInitialized();
    const prefixed = texts.map((t) => this.addPassagePrefix(t));

    const vectors: number[][] = [];
    const batchSize = 32;
    const total = prefixed.length;
    for (let i = 0; i < total; i += batchSize) {
      const batch = prefixed.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (text) => {
          const result = await this.pipeline!(text, {
            pooling: 'mean',
            normalize: true,
          });
          return Array.from(result.data as Float32Array);
        })
      );
      vectors.push(...results);
      console.error(`  [embed] ${Math.min(i + batchSize, total)}/${total}`);
    }
    return vectors;
  }

  cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  getDimensions(): number {
    if (this.modelName.includes('ruri-v3-310m')) return 1024;
    if (this.modelName.includes('multilingual-e5-small')) return 384;
    if (this.modelName.includes('multilingual-e5-base')) return 768;
    return 384;
  }

  /** Query prefix for search queries */
  private addQueryPrefix(text: string): string {
    if (this.isRuriModel()) return `検索クエリ: ${text}`;
    if (this.isE5Model()) return `query: ${text}`;
    return text;
  }

  /** Passage prefix for documents to be indexed */
  private addPassagePrefix(text: string): string {
    if (this.isRuriModel()) return `文章: ${text}`;
    if (this.isE5Model()) return `passage: ${text}`;
    return text;
  }

  private isRuriModel(): boolean {
    return this.modelName.includes('ruri');
  }

  private isE5Model(): boolean {
    return this.modelName.includes('e5');
  }
}
