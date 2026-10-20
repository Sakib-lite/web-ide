export interface KeymapEntry {
  keys: string[];
  label: string;
}

export interface KeymapGroup {
  title: string;
  items: KeymapEntry[];
}

export const KEYMAP_GROUPS: KeymapGroup[] = [
  {
    title: 'General',
    items: [
      { keys: ['⇧⇧'], label: 'Search Everywhere (prefills the editor selection)' },
      { keys: ['⌘⇧A'], label: 'Find Action' },
      { keys: ['⌘,'], label: 'Settings' },
      { keys: ['⌘S'], label: 'Save All' },
      { keys: ['⌘E'], label: 'Recent Files' },
      { keys: ['⌘='], label: 'Increase Font Size' },
      { keys: ['⌘-'], label: 'Decrease Font Size' },
      { keys: ['Esc'], label: 'Focus Editor / Hide Tool Window' },
    ],
  },
  {
    title: 'Navigation',
    items: [
      { keys: ['⌘B'], label: 'Go to Declaration or Usages' },
      { keys: ['⌘Y'], label: 'Quick Definition (peek)' },
      { keys: ['⌘O'], label: 'Go to Class…' },
      { keys: ['⌘⇧O'], label: 'Go to File…' },
      { keys: ['⌘⌥O'], label: 'Go to Symbol…' },
      { keys: ['⌘E'], label: 'Recent Files' },
      { keys: ['⌘⌥←'], label: 'Back' },
      { keys: ['⌘⌥→'], label: 'Forward' },
      { keys: ['⌘['], label: 'Back (alternative)' },
      { keys: ['⌘]'], label: 'Forward (alternative)' },
      { keys: ['⌘L'], label: 'Go to Line:Column' },
      { keys: ['⌘G'], label: 'Next Occurrence' },
      { keys: ['⌘⇧G'], label: 'Previous Occurrence' },
      { keys: ['F2'], label: 'Next Problem' },
      { keys: ['⇧F2'], label: 'Previous Problem' },
      { keys: ['⌘F12'], label: 'File Structure' },
    ],
  },
  {
    title: 'Search',
    items: [
      { keys: ['⇧⇧'], label: 'Search Everywhere' },
      { keys: ['⌘F'], label: 'Find in File' },
      { keys: ['⌘R'], label: 'Replace in File' },
      { keys: ['⌘⇧F'], label: 'Find in Files…' },
      { keys: ['⌘⇧V'], label: 'Markdown Layout: Editor / Split / Preview' },
      { keys: ['⌥F7'], label: 'Find Usages' },
      { keys: ['⌥⌘F7'], label: 'Show Usages (popup)' },
    ],
  },
  {
    title: 'Editing',
    items: [
      { keys: ['⌘D'], label: 'Duplicate Line or Selection' },
      { keys: ['⌘⌫'], label: 'Delete Line' },
      { keys: ['⇧⌥↑'], label: 'Move Line Up' },
      { keys: ['⇧⌥↓'], label: 'Move Line Down' },
      { keys: ['⌘⇧↑'], label: 'Move Statement Up' },
      { keys: ['⌘⇧↓'], label: 'Move Statement Down' },
      { keys: ['⌥↑'], label: 'Extend Selection' },
      { keys: ['⌥↓'], label: 'Shrink Selection' },
      { keys: ['⌃G'], label: 'Add Selection to Next Occurrence' },
      { keys: ['⌘/'], label: 'Comment with Line Comment' },
      { keys: ['⌘⌥/'], label: 'Comment with Block Comment' },
      { keys: ['⌘⇧U'], label: 'Toggle Case' },
      { keys: ['⌃⇧J'], label: 'Join Lines' },
      { keys: ['⌘⇧⏎'], label: 'Complete Current Statement' },
      { keys: ['⌘⌥L'], label: 'Reformat Code' },
      { keys: ['⌘⌥⇧L'], label: 'Reformat Selection' },
      { keys: ['⌘⌥-'], label: 'Fold' },
      { keys: ['⌘⌥='], label: 'Unfold' },
      { keys: ['⌘⌥⇧-'], label: 'Collapse All' },
      { keys: ['⌘⌥⇧='], label: 'Expand All' },
    ],
  },
  {
    title: 'Code Info & Refactoring',
    items: [
      { keys: ['⇧F6'], label: 'Rename…' },
      { keys: ['⌥⏎'], label: 'Show Intention Actions' },
      { keys: ['⌘P'], label: 'Parameter Info' },
      { keys: ['⌃Space'], label: 'Basic Completion' },
      { keys: ['F1', '⌃J'], label: 'Quick Documentation' },
    ],
  },
  {
    title: 'Tabs',
    items: [
      { keys: ['⌘⇧['], label: 'Previous Tab' },
      { keys: ['⌘⇧]'], label: 'Next Tab' },
      { keys: ['⌘⇧W'], label: 'Close Tab' },
      { keys: ['⌘F4'], label: 'Close Tab (alternative)' },
    ],
  },
  {
    title: 'Git',
    items: [
      { keys: ['⌘K'], label: 'Commit (focus message)' },
      { keys: ['⌘⇧K'], label: 'Push…' },
      { keys: ['⌘T'], label: 'Update Project' },
      { keys: ['⌥⌘N'], label: 'New Branch…' },
      { keys: ['⌘9'], label: 'Git Log' },
      { keys: ['⌘0'], label: 'Commit Tool Window' },
    ],
  },
  {
    title: 'Tool Windows',
    items: [
      { keys: ['⌘1'], label: 'Project' },
      { keys: ['⌘7'], label: 'Structure' },
      { keys: ['⌘3'], label: 'Find' },
      { keys: ['⌥F12'], label: 'Terminal' },
      { keys: ['⌘⇧F12'], label: 'Hide All Tool Windows' },
      { keys: ['⌘⇧C'], label: 'Claude Code (plugin)' },
    ],
  },
];
