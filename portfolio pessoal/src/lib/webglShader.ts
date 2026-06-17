const VERTEX_SRC = `#version 300 es
precision highp float;
in vec4 position;
void main(){gl_Position=position;}`;

const VERTICES = [-1, 1, -1, -1, 1, 1, 1, -1];

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export class ShaderRenderer {
  private gl: WebGL2RenderingContext;
  private vs: WebGLShader | null = null;
  private fs: WebGLShader | null = null;
  private program: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private mouseMove: [number, number] = [0, 0];
  private wheel: [number, number] = [0, 0];

  constructor(
    private canvas: HTMLCanvasElement,
    private dpr: number,
    private fragmentSource: string
  ) {
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false });
    if (!gl) throw new Error("WebGL2 não disponível");
    this.gl = gl;
  }

  resize(width: number, height: number) {
    this.canvas.width = Math.floor(width * this.dpr);
    this.canvas.height = Math.floor(height * this.dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  setDpr(dpr: number) {
    this.dpr = dpr;
  }

  init() {
    this.dispose();
    const { gl } = this;

    this.vs = gl.createShader(gl.VERTEX_SHADER)!;
    this.fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    this.compile(this.vs, VERTEX_SRC);
    this.compile(this.fs, this.fragmentSource);

    this.program = gl.createProgram()!;
    gl.attachShader(this.program, this.vs);
    gl.attachShader(this.program, this.fs);
    gl.linkProgram(this.program);

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(this.program));
      return;
    }

    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(VERTICES), gl.STATIC_DRAW);

    const position = gl.getAttribLocation(this.program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  }

  dispose() {
    const { gl, program, vs, fs } = this;
    if (program) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      gl.deleteProgram(program);
    }
    this.program = null;
    this.vs = null;
    this.fs = null;
  }

  private compile(shader: WebGLShader, source: string) {
    const { gl } = this;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(shader));
    }
  }

  updatePointer(state: {
    move: [number, number];
    wheel: [number, number];
  }) {
    this.mouseMove = state.move;
    this.wheel = state.wheel;
  }

  render(now: number) {
    const { gl, program, buffer, canvas } = this;
    if (!program) return;

    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

    gl.uniform2f(gl.getUniformLocation(program, "resolution"), canvas.width, canvas.height);
    gl.uniform1f(gl.getUniformLocation(program, "time"), now * 1e-3);
    gl.uniform2f(gl.getUniformLocation(program, "move"), this.mouseMove[0], this.mouseMove[1]);
    gl.uniform2f(gl.getUniformLocation(program, "wheel"), this.wheel[0], this.wheel[1]);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

export class PointerTracker {
  private pointers = new Map<number, [number, number]>();
  private lastCoords: [number, number] = [0, 0];
  private moves: [number, number] = [0, 0];
  private zoom = 0;
  private wheelDelta = 0;
  private wheelOffset = 0;
  private ex = 0;
  private ey = 0;

  constructor(private getSize: () => { width: number; height: number; dpr: number }) {}

  private map(x: number, y: number): [number, number] {
    const { dpr } = this.getSize();
    const h = window.innerHeight;
    return [x * dpr, (h - y) * dpr];
  }

  bind(target: Window) {
    const onPointer = (e: PointerEvent) => {
      const mapped = this.map(e.clientX, e.clientY);
      this.lastCoords = mapped;
      if (e.type === "pointerdown") {
        this.ex = e.clientX;
        this.ey = e.clientY;
      }
      if (e.type === "pointermove" || e.type === "pointerdown") {
        this.moves = [this.moves[0] + (e.clientX - this.ex), this.moves[1] + (this.ey - e.clientY)];
        this.ex = e.clientX;
        this.ey = e.clientY;
      }
      this.pointers.set(e.pointerId, mapped);
    };

    target.addEventListener("pointerdown", onPointer);
    target.addEventListener("pointermove", onPointer);
    target.addEventListener("pointerup", (e) => {
      if (this.pointers.size === 1) this.lastCoords = this.first;
      this.pointers.delete(e.pointerId);
    });
    target.addEventListener(
      "wheel",
      (e) => {
        this.zoom = lerp(this.zoom, Math.max(-1, Math.min(1, this.zoom + e.deltaY)), 0.05);
        if (this.wheelDelta * e.deltaY < 0) {
          this.wheelDelta = e.deltaY;
        } else {
          this.wheelDelta = lerp(this.wheelDelta, e.deltaY, 0.05);
        }
        this.wheelOffset += this.wheelDelta;
      },
      { passive: true }
    );
  }

  get first(): [number, number] {
    return this.pointers.values().next().value ?? this.lastCoords;
  }

  snapshot() {
    return {
      move: this.moves,
      wheel: [this.wheelDelta, this.wheelOffset] as [number, number],
    };
  }
}
