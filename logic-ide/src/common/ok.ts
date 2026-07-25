export async function ok<T>(work: Promise<T> | T) {
  const output = await work;
  return { ok: true, output: typeof output === 'string' ? output.trim() : output };
}
