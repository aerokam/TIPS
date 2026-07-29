// modal.js — Draggable + resizable modal frame, shared by every modal that wants to move/resize
// (TipsRef had a one-off inline version of this; generalized here so it isn't duplicated per modal).
//
// Usage: give the modal 8 `.resize-handle` divs (n/s/e/w/nw/ne/sw/se — CSS in the page stylesheet
// positions/cursors them) and a `position:fixed` modal element with an initial centered position
// (e.g. `top:60px;left:50%;transform:translateX(-50%)`), then call once:
//   makeDraggableResizable(modalEl, dragHandleEl, { minWidth, minHeight })
// `dragHandleEl` is whatever should start a drag on mousedown (typically the title bar).
export function makeDraggableResizable(modalEl, dragHandleEl, { minWidth = 400, minHeight = 200 } = {}) {
  let dragging = false, offX = 0, offY = 0;

  dragHandleEl.addEventListener('mousedown', e => {
    const rect = modalEl.getBoundingClientRect();
    modalEl.style.transform = 'none';
    modalEl.style.left = rect.left + 'px';
    modalEl.style.top  = rect.top  + 'px';
    offX = e.clientX - rect.left;
    offY = e.clientY - rect.top;
    dragging = true;
    e.preventDefault();
  });

  let resizing = false, resizeDir = '', startX = 0, startY = 0;
  let startLeft = 0, startTop = 0, startW = 0, startH = 0;

  modalEl.addEventListener('mousedown', e => {
    const handle = e.target.closest('.resize-handle');
    if (!handle) return;
    const rect = modalEl.getBoundingClientRect();
    modalEl.style.transform = 'none';
    modalEl.style.left = rect.left + 'px';
    modalEl.style.top  = rect.top  + 'px';
    resizeDir = handle.className.replace('resize-handle', '').trim();
    startX = e.clientX; startY = e.clientY;
    startLeft = rect.left; startTop = rect.top;
    startW = rect.width;   startH = rect.height;
    resizing = true;
    e.preventDefault();
    e.stopPropagation();
  });

  document.addEventListener('mousemove', e => {
    if (dragging) {
      modalEl.style.left = (e.clientX - offX) + 'px';
      modalEl.style.top  = (e.clientY - offY) + 'px';
    }
    if (resizing) {
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (resizeDir.includes('e')) modalEl.style.width = Math.max(minWidth, startW + dx) + 'px';
      if (resizeDir.includes('w')) { modalEl.style.left = (startLeft + dx) + 'px'; modalEl.style.width = Math.max(minWidth, startW - dx) + 'px'; }
      if (resizeDir.includes('s')) modalEl.style.maxHeight = Math.max(minHeight, startH + dy) + 'px';
      if (resizeDir.includes('n')) { modalEl.style.top = (startTop + dy) + 'px'; modalEl.style.maxHeight = Math.max(minHeight, startH - dy) + 'px'; }
    }
  });

  document.addEventListener('mouseup', () => {
    if (dragging) setTimeout(() => { dragging = false; }, 0);
    resizing = false;
  });
}
