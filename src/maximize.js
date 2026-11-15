// Windows 창 오른쪽 위 '최소화(–) / 최대화(□)' 버튼
import { h } from './util.js';
import { I } from './icons.js';

export function minimizeButton() {
  const d = window.desktop;
  if (!d?.minimize) return null; // 예전 버전 Windows 앱(다시 설치 전)에서는 숨김
  return h('button', { class: 'icon-btn', title: '최소화', html: I.minimize, onClick: () => d.minimize() });
}

export function maximizeButton() {
  const d = window.desktop;
  if (!d?.toggleMaximize) return null;
  const btn = h('button', { class: 'icon-btn', title: '최대화', html: I.maximize, onClick: () => d.toggleMaximize() });
  const show = (max) => { btn.innerHTML = max ? I.unmaximize : I.maximize; btn.title = max ? '이전 크기로' : '최대화'; };
  d.onMaximizeChange?.(show);
  d.isMaximized?.().then(show);
  return btn;
}
