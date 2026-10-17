import { isTauri } from '@tauri-apps/api/core';
import {
  availableMonitors,
  getCurrentWindow,
  PhysicalPosition,
  PhysicalSize,
  primaryMonitor,
} from '@tauri-apps/api/window';

const WINDOW_BOUNDS_KEY = 'desktop_memo_window_bounds_v1';
const MIN_WIDTH = 360;
const MIN_HEIGHT = 250;

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}

function readSavedBounds(): WindowBounds | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(WINDOW_BOUNDS_KEY) || 'null');
    if (
      typeof value === 'object' &&
      value !== null &&
      'x' in value &&
      'y' in value &&
      'width' in value &&
      'height' in value &&
      typeof value.x === 'number' &&
      typeof value.y === 'number' &&
      typeof value.width === 'number' &&
      typeof value.height === 'number'
    ) {
      return {
        x: value.x,
        y: value.y,
        width: value.width,
        height: value.height,
        scaleFactor:
          'scaleFactor' in value && typeof value.scaleFactor === 'number'
            ? value.scaleFactor
            : 1,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function writeBounds(bounds: WindowBounds): void {
  localStorage.setItem(WINDOW_BOUNDS_KEY, JSON.stringify(bounds));
}

export async function getWindowBounds(): Promise<WindowBounds> {
  const current = getCurrentWindow();
  const [position, size, scaleFactor] = await Promise.all([
    current.outerPosition(),
    current.outerSize(),
    current.scaleFactor(),
  ]);
  return {
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
    scaleFactor,
  };
}

async function clampToVisibleMonitor(bounds: WindowBounds): Promise<WindowBounds | null> {
  const monitors = await availableMonitors();
  if (monitors.length === 0) return null;

  const overlaps = monitors.map((monitor) => {
    const left = monitor.position.x;
    const top = monitor.position.y;
    const right = left + monitor.size.width;
    const bottom = top + monitor.size.height;
    const overlapWidth = Math.max(0, Math.min(bounds.x + bounds.width, right) - Math.max(bounds.x, left));
    const overlapHeight = Math.max(0, Math.min(bounds.y + bounds.height, bottom) - Math.max(bounds.y, top));
    return { monitor, area: overlapWidth * overlapHeight };
  });

  const best = overlaps.sort((a, b) => b.area - a.area)[0];
  const primary = await primaryMonitor();
  const monitor = best.area > 0 ? best.monitor : primary ?? monitors[0];
  const scale = monitor.scaleFactor || 1;
  const minimumWidth = Math.min(MIN_WIDTH * scale, monitor.size.width);
  const minimumHeight = Math.min(MIN_HEIGHT * scale, monitor.size.height);
  const width = Math.min(Math.max(bounds.width, minimumWidth), monitor.size.width);
  const height = Math.min(Math.max(bounds.height, minimumHeight), monitor.size.height);
  const x = Math.min(
    Math.max(bounds.x, monitor.position.x),
    monitor.position.x + monitor.size.width - width,
  );
  const y = Math.min(
    Math.max(bounds.y, monitor.position.y),
    monitor.position.y + monitor.size.height - height,
  );

  return { x, y, width, height, scaleFactor: scale };
}

export async function restoreWindowBounds(): Promise<void> {
  if (!isTauri()) return;
  const current = getCurrentWindow();
  const saved = readSavedBounds();
  const existing = await getWindowBounds();
  const target = await clampToVisibleMonitor(saved ?? existing);
  if (!target) return;

  await current.setSize(new PhysicalSize(target.width, target.height));
  await current.setPosition(new PhysicalPosition(target.x, target.y));
  writeBounds(target);
}

export async function clampWindowToVisibleMonitor(): Promise<void> {
  if (!isTauri()) return;
  const target = await clampToVisibleMonitor(await getWindowBounds());
  if (!target) return;

  const current = getCurrentWindow();
  await current.setSize(new PhysicalSize(target.width, target.height));
  await current.setPosition(new PhysicalPosition(target.x, target.y));
  writeBounds(target);
}

export async function saveWindowBounds(): Promise<void> {
  if (!isTauri()) return;
  writeBounds(await getWindowBounds());
}

export async function enableStartupOnWindows(): Promise<void> {
  if (!isTauri() || !/Windows/i.test(navigator.userAgent)) return;
  const autostart = await import('@tauri-apps/plugin-autostart');
  if (!(await autostart.isEnabled())) {
    await autostart.enable();
  }
}