import {
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window';
import {
  APP_NAME,
  NOTE_COLORS,
  createBackupJson,
  createNote,
  loadAppData,
  readBackupFile,
  saveDailySnapshot,
  saveLocalData,
  type AppData,
  type Note,
  type NoteColor,
} from './storage';
import {
  clampWindowToVisibleMonitor,
  enableStartupOnWindows,
  getWindowBounds,
  restoreWindowBounds,
  saveWindowBounds,
} from './desktop';

type SaveStatus = 'saving' | 'saved' | 'error' | 'backupError';
type ResizeEdge = 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface PointerAction {
  kind: 'move' | 'resize';
  pointerId: number;
  edge?: ResizeEdge;
  startScreenX: number;
  startScreenY: number;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}

function getColor(color: NoteColor) {
  return NOTE_COLORS.find((item) => item.id === color) ?? NOTE_COLORS[0];
}

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [startupWarning, setStartupWarning] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [mobileView, setMobileView] = useState<'list' | 'editor'>('list');
  const [editorMenuOpen, setEditorMenuOpen] = useState(false);
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
  const [dropTargetNoteId, setDropTargetNoteId] = useState<string | null>(null);
  const [renameFor, setRenameFor] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const importInput = useRef<HTMLInputElement | null>(null);
  const draggedNoteId = useRef<string | null>(null);
  const pointerAction = useRef<PointerAction | null>(null);
  const adjustingRef = useRef(false);
  const saveGeneration = useRef(0);

  useEffect(() => {
    let active = true;
    void loadAppData().then((loaded) => {
      if (active) {
        setData(loaded);
        setReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    adjustingRef.current = adjusting;
  }, [adjusting]);

  useEffect(() => {
    if (!ready || !data) return;
    const generation = ++saveGeneration.current;
    setSaveStatus('saving');
    try {
      saveLocalData(data);
    } catch {
      setSaveStatus('error');
      return;
    }

    const backupTimer = window.setTimeout(() => {
      void saveDailySnapshot(data)
        .then(() => {
          if (generation === saveGeneration.current) setSaveStatus('saved');
        })
        .catch(() => {
          if (generation === saveGeneration.current) setSaveStatus('backupError');
        });
    }, 250);

    return () => window.clearTimeout(backupTimer);
  }, [data, ready]);

  useEffect(() => {
    if (!isTauri()) return;

    const current = getCurrentWindow();
    let disposed = false;
    let boundsTimer = 0;

    const focusListener = current.onFocusChanged(({ payload }) => {
      if (!payload && adjustingRef.current) {
        adjustingRef.current = false;
        pointerAction.current = null;
        setAdjusting(false);
        void clampWindowToVisibleMonitor();
      }
    });
    const persistBounds = () => {
      window.clearTimeout(boundsTimer);
      boundsTimer = window.setTimeout(() => {
        void saveWindowBounds();
      }, 300);
    };
    const movedListener = current.onMoved(persistBounds);
    const resizedListener = current.onResized(persistBounds);

    void (async () => {
      try {
        await restoreWindowBounds();
      } catch {
        // 初回起動などで位置を読めない場合は、既定位置で表示します。
      }
      if (!disposed) {
        try {
          await current.show();
        } catch {
          // 画面を表示できない場合は、トレイから再表示できます。
        }
      }
    })();

    void enableStartupOnWindows().catch(() => setStartupWarning(true));

    return () => {
      disposed = true;
      window.clearTimeout(boundsTimer);
      void focusListener.then((unlisten) => unlisten()).catch(() => undefined);
      void movedListener.then((unlisten) => unlisten()).catch(() => undefined);
      void resizedListener.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    let frame: number | null = null;
    let queuedEvent: PointerEvent | null = null;

    const updateWindow = () => {
      frame = null;
      const event = queuedEvent;
      const action = pointerAction.current;
      if (!event || !action || !isTauri()) return;

      const dx = (event.screenX - action.startScreenX) * action.scaleFactor;
      const dy = (event.screenY - action.startScreenY) * action.scaleFactor;
      const current = getCurrentWindow();

      if (action.kind === 'move') {
        void current.setPosition(new PhysicalPosition(action.x + dx, action.y + dy));
        return;
      }

      const edge = action.edge ?? 'se';
      const minWidth = 360 * action.scaleFactor;
      const minHeight = 250 * action.scaleFactor;
      let width = action.width;
      let height = action.height;
      let x = action.x;
      let y = action.y;

      if (edge.includes('e')) width = Math.max(minWidth, action.width + dx);
      if (edge.includes('s')) height = Math.max(minHeight, action.height + dy);
      if (edge.includes('w')) {
        width = Math.max(minWidth, action.width - dx);
        x = action.x + action.width - width;
      }
      if (edge.includes('n')) {
        height = Math.max(minHeight, action.height - dy);
        y = action.y + action.height - height;
      }

      void current.setPosition(new PhysicalPosition(x, y));
      void current.setSize(new PhysicalSize(width, height));
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!pointerAction.current || pointerAction.current.pointerId !== event.pointerId) return;
      queuedEvent = event;
      if (frame === null) frame = window.requestAnimationFrame(updateWindow);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!pointerAction.current || pointerAction.current.pointerId !== event.pointerId) return;
      pointerAction.current = null;
      queuedEvent = null;
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      void saveWindowBounds();
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, []);

  const selectedNote =
    data?.notes.find((note) => note.id === data.selectedId) ?? data?.notes[0] ?? null;

  function updateNote(noteId: string, update: Partial<Note>) {
    setData((current) => {
      if (!current) return current;
      return {
        ...current,
        notes: current.notes.map((note) =>
          note.id === noteId ? { ...note, ...update, updatedAt: new Date().toISOString() } : note,
        ),
      };
    });
  }

  function selectNote(noteId: string) {
    setData((current) => (current ? { ...current, selectedId: noteId } : current));
    setEditorMenuOpen(false);
    setRenameFor(null);
    setMobileView('editor');
  }

  function addNote() {
    const note = createNote();
    setData((current) =>
      current
        ? { ...current, notes: [...current.notes, note], selectedId: note.id }
        : current,
    );
    setEditorMenuOpen(false);
    setRenameFor(null);
    setMobileView('editor');
  }

  function saveTitle(noteId: string) {
    const title = titleDraft.trim().slice(0, 4) || 'タイトル';
    updateNote(noteId, { title });
    setRenameFor(null);
    setEditorMenuOpen(false);
  }

  function startTitleEdit(note: Note) {
    setTitleDraft(note.title);
    setRenameFor(note.id);
    setEditorMenuOpen(false);
  }

  function moveNote(noteId: string, direction: -1 | 1) {
    setData((current) => {
      if (!current) return current;
      const from = current.notes.findIndex((note) => note.id === noteId);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= current.notes.length) return current;
      const notes = [...current.notes];
      [notes[from], notes[to]] = [notes[to], notes[from]];
      return { ...current, notes };
    });
  }

  function reorderNote(noteId: string, targetId: string) {
    setData((current) => {
      if (!current || noteId === targetId) return current;
      const from = current.notes.findIndex((note) => note.id === noteId);
      const to = current.notes.findIndex((note) => note.id === targetId);
      if (from < 0 || to < 0) return current;
      const notes = [...current.notes];
      const [note] = notes.splice(from, 1);
      notes.splice(to, 0, note);
      return { ...current, notes };
    });
  }

  function deleteNote(noteId: string) {
    if (!data || !window.confirm('このメモを削除しますか？')) return;
    const notes = data.notes.filter((note) => note.id !== noteId);
    const selectedId =
      data.selectedId === noteId ? notes[0]?.id ?? null : data.selectedId;
    setData({ ...data, notes, selectedId });
    setEditorMenuOpen(false);
    setRenameFor(null);
    if (!notes.length) setMobileView('list');
  }

  function toggleAdjusting() {
    if (adjusting) {
      adjustingRef.current = false;
      pointerAction.current = null;
      setAdjusting(false);
      void clampWindowToVisibleMonitor();
    } else {
      setAdjusting(true);
    }
  }

  async function beginMove(event: ReactPointerEvent<HTMLElement>) {
    if (!adjusting || !isTauri() || event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    try {
      const bounds = await getWindowBounds();
      pointerAction.current = {
        kind: 'move',
        pointerId: event.pointerId,
        startScreenX: event.screenX,
        startScreenY: event.screenY,
        ...bounds,
      };
    } catch {
      pointerAction.current = null;
    }
  }

  async function beginResize(edge: ResizeEdge, event: ReactPointerEvent<HTMLDivElement>) {
    if (!adjusting || !isTauri() || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);

    try {
      const bounds = await getWindowBounds();
      pointerAction.current = {
        kind: 'resize',
        edge,
        pointerId: event.pointerId,
        startScreenX: event.screenX,
        startScreenY: event.screenY,
        ...bounds,
      };
    } catch {
      pointerAction.current = null;
    }
  }

  function exportData() {
    if (!data) return;
    const date = new Date();
    const dateKey =
      String(date.getFullYear()) +
      String(date.getMonth() + 1).padStart(2, '0') +
      String(date.getDate()).padStart(2, '0');
    const blob = new Blob([createBackupJson(data)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = APP_NAME + '_backup_' + dateKey + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setEditorMenuOpen(false);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importData(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (file.size > 10_000_000) {
      window.alert('ファイルが大きすぎます。');
      return;
    }

    try {
      const imported = await readBackupFile(file);
      if (!window.confirm('バックアップの内容で、現在のメモを置き換えますか？')) return;
      saveLocalData(imported);
      setData(imported);
      setEditorMenuOpen(false);
      setMobileView(imported.notes.length ? 'editor' : 'list');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '読み込みに失敗しました。');
    }
  }

  if (!ready || !data) {
    return (
      <div className="loading-screen" role="status">
        読み込み中
      </div>
    );
  }

  const saveText =
    saveStatus === 'saving'
      ? '保存中'
      : saveStatus === 'backupError'
        ? '自動バックアップに失敗しました'
        : saveStatus === 'error'
          ? '保存に失敗しました'
          : '保存済み';
  const selectedIndex = selectedNote
    ? data.notes.findIndex((note) => note.id === selectedNote.id)
    : -1;

  return (
    <div className={isTauri() ? 'app-shell desktop-shell' : 'app-shell web-shell'}>
      <main className={adjusting ? 'memo-window is-adjusting' : 'memo-window'}>
        <header
          className="window-chrome"
          onDoubleClick={toggleAdjusting}
          onPointerDown={(event) => void beginMove(event)}
          title={adjusting ? 'ドラッグで移動・枠をダブルクリックで固定' : 'ダブルクリックで位置とサイズを変更'}
        >
          <span className="window-name">付箋紙アプリ</span>
          {adjusting && <span className="window-hint">配置を調整中</span>}
        </header>

        {adjusting &&
          (['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeEdge[]).map((edge) => (
            <div
              key={edge}
              className={'resize-handle resize-' + edge}
              aria-hidden="true"
              onPointerDown={(event) => void beginResize(edge, event)}
              onDoubleClick={toggleAdjusting}
            />
          ))}

        <div className="workspace" data-mobile-view={mobileView}>
          <aside className="sidebar">
            <div className="sidebar-heading">
              <span className="sidebar-label">付箋</span>
              <button className="add-note" type="button" onClick={addNote} aria-label="メモを追加">
                ＋
              </button>
            </div>

            <div className="note-list">
              {data.notes.map((note) => {
                const color = getColor(note.color);
                const active = selectedNote?.id === note.id;
                return (
                  <button
                    className={[
                      'note-tab',
                      active && 'is-active',
                      draggingNoteId === note.id && 'is-dragging',
                      dropTargetNoteId === note.id && 'is-drop-target',
                    ].filter(Boolean).join(' ')}
                    key={note.id}
                    style={{
                      '--note-color': color.dot,
                      '--note-surface': color.surface,
                    } as React.CSSProperties}
                    type="button"
                    draggable
                    onClick={() => selectNote(note.id)}
                    onDragStart={(event) => {
                      draggedNoteId.current = note.id;
                      setDraggingNoteId(note.id);
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', note.id);
                    }}
                    onDragOver={(event) => {
                      if (!draggedNoteId.current) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      if (dropTargetNoteId !== note.id) setDropTargetNoteId(note.id);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const sourceId = draggedNoteId.current || event.dataTransfer.getData('text/plain');
                      if (sourceId) reorderNote(sourceId, note.id);
                      draggedNoteId.current = null;
                      setDraggingNoteId(null);
                      setDropTargetNoteId(null);
                    }}
                    onDragEnd={() => {
                      draggedNoteId.current = null;
                      setDraggingNoteId(null);
                      setDropTargetNoteId(null);
                    }}
                    aria-pressed={active}
                    aria-label={note.title}
                    title={`${note.title} · ドラッグして順番変更`}
                  >
                    <span className="note-title">{note.title}</span>
                  </button>
                );
              })}

              {data.notes.length === 0 && (
                <p className="list-empty">メモはまだありません</p>
              )}
            </div>

            {startupWarning && (
              <div className="sidebar-warning">自動起動を設定できませんでした</div>
            )}
          </aside>

          <section
            className="editor-panel"
            aria-label="メモ本文"
            style={{
              '--note-surface': selectedNote ? getColor(selectedNote.color).surface : '#fbfaf7',
            } as React.CSSProperties}
          >
            <div className="editor-heading">
              <button
                className="mobile-back"
                type="button"
                onClick={() => setMobileView('list')}
                aria-label="メモ一覧に戻る"
              >
                ← 一覧
              </button>
              <div className="active-note-name">
                {selectedNote ? (
                  renameFor === selectedNote.id ? (
                    <input
                      className="title-input"
                      value={titleDraft}
                      maxLength={4}
                      autoFocus
                      aria-label="メモのタイトル"
                      onChange={(event) => setTitleDraft(event.target.value)}
                      onBlur={() => saveTitle(selectedNote.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') saveTitle(selectedNote.id);
                      }}
                    />
                  ) : (
                    <h1>
                      <button
                        className="title-edit-trigger"
                        type="button"
                        aria-label="タイトルを編集"
                        title="クリックしてタイトルを編集"
                        onClick={() => startTitleEdit(selectedNote)}
                      >
                        {selectedNote.title}
                      </button>
                    </h1>
                  )
                ) : (
                  <span className="empty-title">メモがありません</span>
                )}
              </div>
              <div className="editor-actions">
                <span className="autosave-label" title={saveText}>{saveText}</span>
                <button
                  className="editor-more"
                  type="button"
                  aria-label="メモのその他の操作"
                  aria-expanded={editorMenuOpen}
                  title="その他の操作"
                  onClick={() => setEditorMenuOpen(!editorMenuOpen)}
                >
                  ⋯
                </button>
                {editorMenuOpen && (
                  <div className="editor-menu">
                    {selectedNote && (
                      <>
                        <div className="color-options" aria-label="メモの色">
                          {NOTE_COLORS.map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              className={selectedNote.color === option.id ? 'color-option selected' : 'color-option'}
                              style={{ '--swatch': option.dot } as React.CSSProperties}
                              aria-label={option.label}
                              aria-pressed={selectedNote.color === option.id}
                              title={option.label}
                              onClick={() => {
                                updateNote(selectedNote.id, { color: option.id });
                                setEditorMenuOpen(false);
                              }}
                            />
                          ))}
                        </div>
                        <div className="order-actions">
                          <button
                            type="button"
                            onClick={() => moveNote(selectedNote.id, -1)}
                            disabled={selectedIndex <= 0}
                            aria-label="上へ移動"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => moveNote(selectedNote.id, 1)}
                            disabled={selectedIndex < 0 || selectedIndex === data.notes.length - 1}
                            aria-label="下へ移動"
                          >
                            ↓
                          </button>
                        </div>
                        <button
                          className="menu-action delete-action"
                          type="button"
                          onClick={() => deleteNote(selectedNote.id)}
                        >
                          削除
                        </button>
                        <div className="menu-divider" />
                      </>
                    )}
                    <div className="menu-utility-actions">
                      <button type="button" onClick={exportData}>バックアップ</button>
                      <button type="button" onClick={() => importInput.current?.click()}>データ挿入</button>
                    </div>
                  </div>
                )}
                <input
                  ref={importInput}
                  className="file-input"
                  type="file"
                  accept=".json,application/json"
                  onChange={(event) => void importData(event)}
                  aria-label="バックアップJSONを選択"
                />
              </div>
            </div>

            {selectedNote ? (
              <textarea
                className="note-body"
                value={selectedNote.body}
                placeholder="ここにメモを書きます"
                aria-label={selectedNote.title + 'の本文'}
                onChange={(event) => updateNote(selectedNote.id, { body: event.target.value })}
                spellCheck={false}
              />
            ) : (
              <div className="empty-editor">
                <p>メモを選ぶか、新しく追加してください</p>
                <button type="button" onClick={addNote}>＋ メモを追加</button>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
