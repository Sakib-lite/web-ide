const SHORTCUTS: [string, string[]][] = [
  ['Search Everywhere', ['Shift', 'Shift']],
  ['Go to File', ['⌘', '⇧', 'O']],
  ['Find in Files', ['⌘', '⇧', 'F']],
  ['Go to Declaration', ['⌘', 'Click']],
  ['Commit', ['⌘', 'K']],
  ['Terminal', ['⌥', 'F12']],
];

export function EmptyEditor() {
  return (
    <div className="editor-empty">
      <div className="empty-logo">WS</div>
      <div className="empty-shortcuts">
        {SHORTCUTS.map(([label, keys]) => (
          <div key={label}>
            <span>{label}</span>
            <span>{keys.map((k, i) => <kbd key={i}>{k}</kbd>)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
