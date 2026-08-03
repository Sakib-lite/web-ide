import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { ProjectsService } from '../projects/projects.service';
import { PluginHost } from '../plugins/plugin-host';
import { attachTerminal } from '../terminal/terminal';
import { isAuthorized } from '../auth/token-auth';

export function installWebSockets(server: Server, projects: ProjectsService, plugins: PluginHost) {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const reject = (status: string) => {
      socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
      socket.destroy();
    };
    if (!isAuthorized(req)) return reject('401 Unauthorized');
    const url = new URL(req.url || '/', 'http://localhost');
    const project = projects.get(url.searchParams.get('root') || undefined);
    const pluginMatch = /^\/ws\/plugins\/([\w.-]+)$/.exec(url.pathname);
    if (!project || (!['/ws/terminal', '/ws/events'].includes(url.pathname) && !pluginMatch)) return reject('404 Not Found');
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (pluginMatch) return plugins.handleUpgrade(pluginMatch[1], ws, project, url);
      if (url.pathname === '/ws/terminal') return attachTerminal(ws, project.root);
      project.clients.add(ws);
      ws.send(JSON.stringify({ type: 'hello', indexReady: project.symbols.ready }));
      ws.on('close', () => project.clients.delete(ws));
    });
  });
}
