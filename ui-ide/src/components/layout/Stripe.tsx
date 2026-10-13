'use client';

import { Side, isToolVisible, useStore } from '@/lib/store';
import { Icon } from '@/components/ui/Icon';
import { useCommitBadge } from '@/components/git/useCommitBadge';
import { openSettingsDialog } from '@/components/github/SettingsDialog';

const LEFT_TOP = ['project', 'commit', 'pulls', 'structure'];
const LEFT_BOTTOM = ['terminal', 'git', 'find'];

function StripeButton({ id }: { id: string }) {
  const def = useStore((s) => s.toolDefs.find((d) => d.id === id));
  const active = useStore((s) => isToolVisible(s, id));
  const toggle = useStore((s) => s.toggleTool);
  const badge = useCommitBadge(id);
  if (!def) return null;
  const title = def.title + (def.shortcut ? ` (${def.shortcut})` : '');
  return (
    <button className={`stripe-btn${active ? ' active' : ''}`} data-tool={id} title={title} onClick={() => toggle(id)}>
      {def.icon.trim().startsWith('<svg') ? <span dangerouslySetInnerHTML={{ __html: def.icon }} /> : <Icon name={def.icon} />}
      {badge ? <span className="badge">{badge}</span> : null}
    </button>
  );
}

export function Stripe({ side }: { side: Exclude<Side, 'bottom'> }) {
  const defs = useStore((s) => s.toolDefs);
  const top = side === 'left' ? LEFT_TOP : defs.filter((d) => d.side === 'right').map((d) => d.id);
  const bottom = side === 'left' ? LEFT_BOTTOM : [];
  return (
    <nav className={`stripe stripe-${side}`}>
      <div className="stripe-top">{top.map((id) => <StripeButton key={id} id={id} />)}</div>
      <div className="stripe-bottom">
        {bottom.map((id) => <StripeButton key={id} id={id} />)}
        {side === 'left' && (
          <button className="stripe-btn" title="Keymap Reference (⌘, → Keymap)" onClick={() => openSettingsDialog('keymap')}>
            <Icon name="keymap" />
          </button>
        )}
      </div>
    </nav>
  );
}
