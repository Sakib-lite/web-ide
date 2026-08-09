import { useStore } from '@/lib/store';
import { showContextMenu } from '@/components/ui/ContextMenu';
import { openSettingsDialog } from '@/components/github/SettingsDialog';
import { openPluginsDialog } from '@/components/plugins/PluginsDialog';
import { editorManager } from '@/editor/editor-manager';
import { isMac } from '@/lib/utils';

export function openSettingsMenu(anchor: HTMLElement) {
  const r = anchor.getBoundingClientRect();
  const { settings, updateSettings } = useStore.getState();
  showContextMenu(r.right - 240, r.bottom + 4, [
    { label: 'Settings…', key: isMac ? '⌘,' : 'Ctrl+Alt+S', action: () => openSettingsDialog() },
    { label: 'GitHub Account…', action: () => openSettingsDialog() },
    { label: 'Plugins…', action: () => openPluginsDialog() },
    'sep',
    { label: 'Increase Font Size', key: `${isMac ? '⌘' : 'Ctrl'}+`, action: () => editorManager.changeFontSize(1) },
    { label: 'Decrease Font Size', key: `${isMac ? '⌘' : 'Ctrl'}-`, action: () => editorManager.changeFontSize(-1) },
    { label: 'Soft-Wrap', checked: settings.wordWrap === 'on', action: () => updateSettings({ wordWrap: settings.wordWrap === 'on' ? 'off' : 'on' }) },
    { label: 'Minimap', checked: settings.minimap, action: () => updateSettings({ minimap: !settings.minimap }) },
  ]);
}
