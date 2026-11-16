/*
 * One entry point for repainting the screen. Everything that changes state calls render()
 * and nothing else: which screen is up follows from whether a table is open and what the
 * player last chose, so no caller has to know what to repaint.
 */
import { patch } from './dom.ts';
import { device, live, ui } from './state.ts';
import { renderLobbyForm } from './views/lobby.ts';
import { renderRoom } from './views/room.ts';
import { renderTable } from './views/table.ts';
import { sheetHTML } from './views/sheets.ts';

export function render(): void {
  const S = live.S, me = device();
  if (!S) renderLobbyForm(ui, live.net);
  else if (ui.view === 'room') renderRoom(S, ui, me, live.online, live.net);
  else renderTable(S, ui, me, live.online);
  patch('sheet', S ? sheetHTML(S, ui, me) : '');
}
