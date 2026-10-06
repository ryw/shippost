import type { FileSystemService } from './file-system.js';
import type { TypefullyService } from './typefully.js';
import type { Post } from '../types/post.js';

/** One staging lock is shared by approval and retry, preventing duplicate sends. */
export function createReviewActions(fs: FileSystemService, getTypefully: () => TypefullyService) {
  let busy = false;
  const error = (status: number, message: string) => ({ status, body: { error: message } });
  async function stage(post: Post) {
    const draft = await getTypefully().createDraft(post.content, post.platform || 'x');
    fs.updatePost(post.id, current => ({ ...current, status: 'staged', metadata: { ...current.metadata, typefullyDraftId: draft.id } }));
    return { status: 200, body: { ok: true, staged: true, share_url: draft.share_url, draftId: draft.id,
      remaining: fs.readPosts().filter(p => p.status === 'approved').length,
      post: { id: post.id, content: post.content, platform: post.platform || 'x', sourceFile: post.sourceFile } } };
  }
  return {
    get busy() { return busy; },
    async handle(route: string, body: Record<string, unknown>) {
      if (busy) return error(409, 'A post is being sent to Typefully. Try again shortly.');
      busy = true;
      try {
        if (route === 'POST /api/decision') {
          const { id, action, content } = body;
          if (action !== 'approve' && action !== 'reject') return error(400, 'invalid action');
          const post = fs.readPosts().find(p => p.id === id);
          if (!post) return error(404, 'post not found');
          if (post.status !== 'new' && post.status !== 'keep') return error(409, 'post has already been reviewed');
          post.content = typeof content === 'string' && content.trim() ? content : post.content;
          post.status = action === 'approve' ? 'approved' : 'rejected';
          fs.updatePost(post.id, () => post);
          if (action === 'reject') return { status: 200, body: { ok: true } };
          try { return await stage(post); }
          catch { return { status: 200, body: { ok: true, staged: false, error: 'Approved, but sending to Typefully failed. Your edits are saved. Use Retry send.' } }; }
        }
        const post = fs.readPosts().find(p => p.status === 'approved' && (body.id === undefined || p.id === body.id));
        if (!post) return error(404, 'no approved posts to send');
        try { return await stage(post); }
        catch { return error(502, 'Sending to Typefully failed. The post remains approved; retry later.'); }
      } finally { busy = false; }
    },
  };
}
