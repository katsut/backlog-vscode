import { BacklogApiService } from '../services/backlogApi';

/**
 * Resolve Backlog image URLs in markdown content.
 * Returns original content on failure.
 */
export async function resolveBacklogImages(
  content: string,
  backlogApi: BacklogApiService | undefined
): Promise<string> {
  if (!content || !backlogApi) {
    return content;
  }
  try {
    return await backlogApi.resolveBacklogImages(content);
  } catch {
    return content;
  }
}
