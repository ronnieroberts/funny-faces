// Edit mode on the main screen: pointer and key handling plus the handles drawn over the stage. The geometry itself
// lives in quad.js. Only the main screen creates an editor; display screens never show handles.
import { hitTest, applyDrag, viewDelta, handlesOf, pointerToStage, scaleQuad, resetSkew } from './quad.js';

const BLUE = '#4cc2ff', AMBER = '#ffb020';
const CURSORS = { move: 'move', corner: 'crosshair', edge: 'ew-resize', rotate: 'grab', zoom: 'zoom-in' };

/** o.canvas: the stage canvas (gets the pointer events). o.overlay: a 2D canvas over it for the handles.
 *  o.pumpkins(): the settings list (quads are changed in place). o.sel(), o.select(i), o.changed(): selection and "something moved".
 *  o.onMode(on): called when edit mode turns on or off. */
export function createEditor(o) {
  const canvas = o.canvas, pointers = new Map();
  let on = false, drag = null, pinch = 0;

  const aspect = () => canvas.width / canvas.height;
  const flags = () => ({ mirror: document.body.dataset.mirror === '1', flip: document.body.dataset.flip === '1' });
  /** Pointer in stage pixels, and k = stage pixels per CSS pixel. */
  function where(e) {
    const r = canvas.getBoundingClientRect(), { u, v } = pointerToStage(e.clientX, e.clientY, r, flags());
    return { u, v, x: u * canvas.width, y: v * canvas.height, k: canvas.width / (r.width || 1) };
  }
  const quads = () => o.pumpkins().map((p) => (p.enabled ? p.quad : null));
  const setQuad = (i, q) => { o.pumpkins()[i].quad = q; o.changed(); };

  function setOn(v) {
    v = !!v;
    if (v === on) return;
    on = v; drag = null; pointers.clear(); canvas.style.cursor = '';
    if (!on) o.overlay.getContext('2d').clearRect(0, 0, o.overlay.width, o.overlay.height);
    o.onMode(on);
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!on) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 2) { drag = null; pinch = 0; return; }
    const p = where(e), hit = hitTest(quads(), o.sel(), p.x, p.y, canvas.width, canvas.height, p.k);
    if (!hit) return;
    if (o.sel() !== hit.index) o.select(hit.index);
    drag = { ...hit, start: o.pumpkins()[hit.index].quad, from: [p.u, p.v] };
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!on) return;
    const mine = pointers.get(e.pointerId);
    if (mine) { mine.x = e.clientX; mine.y = e.clientY; }
    if (pointers.size === 2) {                                   // two fingers: pinch the selected pumpkin
      const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) setQuad(o.sel(), scaleQuad(o.pumpkins()[o.sel()].quad, d / pinch, aspect()));
      pinch = d;
      return;
    }
    const p = where(e);
    if (!drag) {
      const hit = hitTest(quads(), o.sel(), p.x, p.y, canvas.width, canvas.height, p.k);
      canvas.style.cursor = hit ? CURSORS[hit.kind] : 'default';
      return;
    }
    const q = applyDrag(drag.kind, drag.i, drag.start, [p.u, p.v], drag.from, aspect(), { shift: e.shiftKey, centre: e.altKey });
    if (q !== o.pumpkins()[drag.index].quad) setQuad(drag.index, q);
  });

  const end = (e) => { pointers.delete(e.pointerId); pinch = 0; if (!pointers.size) drag = null; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  canvas.addEventListener('wheel', (e) => {
    if (!on) return;
    e.preventDefault();
    const p = where(e), hit = hitTest(quads(), o.sel(), p.x, p.y, canvas.width, canvas.height, p.k);
    const i = hit ? hit.index : o.sel();                          // the pumpkin under the cursor, else the selected one
    if (i !== o.sel()) o.select(i);
    setQuad(i, scaleQuad(o.pumpkins()[i].quad, Math.exp(-e.deltaY * 0.0012), aspect()));
  }, { passive: false });

  return {
    flags,
    get on() { return on; },
    setOn,
    toggle() { setOn(!on); },

    /** Arrows nudge, + and - zoom, R resets the skew, Tab picks the next pumpkin. Returns true if the key was used. */
    key(e) {
      if (!on || e.metaKey || e.ctrlKey || e.altKey) return false;
      const list = o.pumpkins(), i = o.sel(), step = e.shiftKey ? 0.02 : 0.003, A = aspect() || 16 / 9;
      const arrow = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      const mv = arrow && viewDelta(arrow[0], arrow[1], flags());   // arrows follow what the viewer sees
      if (mv) { e.preventDefault(); setQuad(i, applyDrag('move', 0, list[i].quad, mv, [0, 0], A)); }
      else if (e.key === '+' || e.key === '=') setQuad(i, scaleQuad(list[i].quad, e.shiftKey ? 1.1 : 1.02, A));
      else if (e.key === '-') setQuad(i, scaleQuad(list[i].quad, e.shiftKey ? 0.9 : 0.98, A));
      else if (e.key === 'r' || e.key === 'R') setQuad(i, resetSkew(list[i].quad, A));
      else if (e.key === 'Tab') {
        e.preventDefault();
        const shown = list.map((p, n) => (p.enabled ? n : -1)).filter((n) => n >= 0);
        if (shown.length) o.select(shown[(Math.max(0, shown.indexOf(i)) + (e.shiftKey ? shown.length - 1 : 1)) % shown.length]);
      } else return false;
      return true;
    },

    /** Draw outlines and the selected pumpkin's handles. Call every frame; it does nothing outside edit mode. */
    draw() {
      if (!on) return;
      const w = canvas.width, h = canvas.height, ov = o.overlay;
      if (ov.width !== w || ov.height !== h) { ov.width = w; ov.height = h; }
      const ctx = ov.getContext('2d'), k = w / (canvas.getBoundingClientRect().width || w);
      ctx.clearRect(0, 0, w, h);
      const list = o.pumpkins(), sel = o.sel();
      const path = (q) => { ctx.beginPath(); q.forEach(([x, y], n) => (n ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h))); ctx.closePath(); };
      list.forEach((p, i) => {
        if (!p.enabled || i === sel) return;
        ctx.strokeStyle = 'rgba(76,194,255,.45)'; ctx.lineWidth = 1.5 * k; ctx.setLineDash([6 * k, 6 * k]);
        path(p.quad); ctx.stroke();
      });
      ctx.setLineDash([]);
      const q = list[sel] && list[sel].enabled && list[sel].quad;
      if (!q) return;
      path(q);
      ctx.fillStyle = 'rgba(76,194,255,.12)'; ctx.fill();            // the selected quad is lit and outlined
      ctx.strokeStyle = BLUE; ctx.lineWidth = 3 * k; ctx.stroke();
      const H = handlesOf(q, w, h, k);
      ctx.lineWidth = 1.5 * k;
      for (const [from, to] of [[H.edges[0], H.rot], [H.edges[2], H.zoom]]) { ctx.beginPath(); ctx.moveTo(...from); ctx.lineTo(...to); ctx.stroke(); }
      ctx.fillStyle = BLUE;
      ctx.beginPath(); ctx.arc(H.rot[0], H.rot[1], 7 * k, 0, 7); ctx.fill();                      // rotate: a solid dot
      ctx.beginPath(); ctx.arc(H.zoom[0], H.zoom[1], 9 * k, 0, 7); ctx.fillStyle = '#000'; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(H.zoom[0] - 5 * k, H.zoom[1]); ctx.lineTo(H.zoom[0] + 5 * k, H.zoom[1]);
      ctx.moveTo(H.zoom[0], H.zoom[1] - 5 * k); ctx.lineTo(H.zoom[0], H.zoom[1] + 5 * k); ctx.stroke();   // zoom: a plus in a ring
      ctx.fillStyle = '#fff'; ctx.strokeStyle = AMBER; ctx.lineWidth = 2 * k;                    // corners skew: white diamonds
      for (const [x, y] of H.corners) {
        const r = 8 * k;
        ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ctx.fillStyle = BLUE; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * k;                   // sides stretch: blue squares
      for (const [x, y] of H.edges) { ctx.beginPath(); ctx.rect(x - 4.5 * k, y - 4.5 * k, 9 * k, 9 * k); ctx.fill(); ctx.stroke(); }
    },
  };
}
