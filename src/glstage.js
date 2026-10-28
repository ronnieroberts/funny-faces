// WebGL2 quad drawing: each pumpkin's face is a texture drawn on a four-corner quad with perspective-correct weights,
// so a tilted or skewed pumpkin looks like a flat picture seen at an angle. Needs a canvas that has no 2D context yet.
import { quadQ } from './quad.js';

const VS = `#version 300 es
layout(location=0) in vec4 aPos; layout(location=1) in vec3 aUV; out vec3 vUV;
void main(){ gl_Position = aPos; vUV = aUV; }`;
const FS = `#version 300 es
precision mediump float; in vec3 vUV; uniform sampler2D uTex; out vec4 o;
void main(){ o = vec4(texture(uTex, vUV.xy / vUV.z).rgb, 1.0); }`;
const UV = [[0, 0], [1, 0], [1, 1], [0, 1]];

export class GLStage {
  /** Throws when WebGL2 is not available or the shaders do not build. */
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
    if (!this.gl) throw new Error('WebGL2 is not available in this browser');
    this.verts = new Float32Array(28);
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { this.init(); this.lost = false; });
    this.init();
  }

  init() {
    const gl = this.gl;
    const shader = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader failed');
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link failed');
    gl.useProgram(prog);
    gl.bindVertexArray(gl.createVertexArray());
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, this.verts.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 16);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.enable(gl.BLEND); gl.blendEquation(gl.MAX);               // where faces overlap the brighter one wins, like light
    this.textures = new Map();                                    // key -> {tex, size}
  }

  texture(key, size) {
    const gl = this.gl;
    let t = this.textures.get(key);
    if (t && t.size !== size) { gl.deleteTexture(t.tex); t = null; }
    if (!t) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, size, size);    // allocated once per size; frames only upload into it
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      t = { tex, size };
      this.textures.set(key, t);
    }
    return t;
  }

  /** Free the textures of pumpkins that are gone (keys at or above count). */
  trim(count) {
    for (const [k, t] of this.textures) if (k >= count) { this.gl.deleteTexture(t.tex); this.textures.delete(k); }
  }

  clear() {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** items: [{key, canvas, quad}] where canvas is a square tile and quad has corners TL, TR, BR, BL as stage fractions. */
  draw(items) {
    if (this.lost) return;
    const gl = this.gl, W = this.canvas.width, H = this.canvas.height, A = W / H, v = this.verts;
    this.clear();
    for (const it of items) {
      const t = this.texture(it.key, it.canvas.width);
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, it.canvas);
      const q = quadQ(it.quad.map(([x, y]) => [x * A, y]));
      for (let i = 0; i < 4; i++) {
        const w = q[i], x = it.quad[i][0] * 2 - 1, y = 1 - it.quad[i][1] * 2;
        v.set([x * w, y * w, 0, w, UV[i][0] * w, UV[i][1] * w, w], i * 7);
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, v);
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }
  }
}
