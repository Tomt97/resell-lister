// Pages with unsaved edits register here; the router waits for them before showing the next page.
const pending = new Set();
export const onBeforeLeave = (fn) => { pending.add(fn); return () => pending.delete(fn); };
export async function flushPending() {
  const fns = [...pending];
  pending.clear();
  await Promise.all(fns.map((fn) => fn()));
}
