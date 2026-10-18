import type * as Monaco from 'monaco-editor';
import { fsApi } from '@/lib/api';
import { languageFor } from './theme';

/**
 * Monaco's peek widgets (references, definitions) render an inline preview for every
 * result, which needs a live TextModel per file. Files not already open as tabs have no
 * model yet, so Monaco throws "Model not found" when it tries to preview them. Call this
 * before returning Locations for files that may not be open.
 */
export async function ensureModels(monaco: typeof Monaco, files: Iterable<string>) {
  await Promise.all(
    [...new Set(files)].map(async (file) => {
      const uri = monaco.Uri.file('/' + file);
      if (monaco.editor.getModel(uri)) return;
      try {
        const { content } = await fsApi.read(file);
        if (!monaco.editor.getModel(uri)) monaco.editor.createModel(content, languageFor(file), uri);
      } catch {}
    }),
  );
}
