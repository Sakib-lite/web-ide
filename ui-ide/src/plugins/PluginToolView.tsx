'use client';

import { useEffect, useRef } from 'react';
import { ToolDef, useStore, isToolVisible } from '@/lib/store';
import { ToolHeader } from '@/components/layout/ToolPanel';

export function PluginToolView({ def }: { def: ToolDef }) {
  const host = useRef<HTMLDivElement>(null);
  const rendered = useRef(false);
  const visible = useStore((s) => isToolVisible(s, def.id));
  useEffect(() => {
    if (host.current && !rendered.current) {
      rendered.current = true;
      def.plugin?.render(host.current);
    }
  }, [def]);
  useEffect(() => {
    if (visible) def.plugin?.onShow?.();
  }, [visible, def]);
  return (
    <>
      <ToolHeader id={def.id} title={def.title} />
      <div ref={host} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }} />
    </>
  );
}
