// WebGL renderer for the per-pixel generative backgrounds. The fragment
// shaders reproduce the exact formulas of the canvas-2d implementations in
// BackgroundLayer, so switching renderer does not change the visuals — it only
// moves the work from the main thread to the GPU.
//
// Pattern frequencies are defined in "simulation pixels" (u_simResolution),
// matching the downscaled buffer the CPU path renders into. The actual canvas
// can be much larger: the GPU output stays sharp while the pattern scale is
// identical to the CPU renderer.

export type WebglBackgroundType =
  | 'perlin'
  | 'fractal-flow'
  | 'aurora'
  | 'plasma'
  | 'julia'
  | 'reaction-diffusion';

export interface WebglPalette {
  baseA: [number, number, number];
  baseB: [number, number, number];
  baseC: [number, number, number];
  accent: [number, number, number];
  accent2: [number, number, number];
  danger: [number, number, number];
}

export interface WebglBackgroundHandle {
  render: (timeSeconds: number) => void;
  resize: (width: number, height: number, simWidth: number, simHeight: number) => void;
  dispose: () => void;
}

const VERTEX_SHADER = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_HEADER = `
precision mediump float;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_simResolution;
uniform vec3 u_baseA;
uniform vec3 u_baseB;
uniform vec3 u_baseC;
uniform vec3 u_accent;
uniform vec3 u_accent2;
uniform vec3 u_danger;
`;

// Matches drawPerlinNoise().
const PERLIN_SOURCE = `${FRAGMENT_HEADER}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float nx = uv.x;
  float ny = 1.0 - uv.y;
  float t = u_time;

  float val = 0.0;
  val += sin(nx * 6.283 + t * 0.3 + cos(ny * 3.141 + t * 0.2) * 2.0) * 0.3;
  val += sin(ny * 8.202 + t * 0.4 + sin(nx * 4.712 + t * 0.15) * 1.5) * 0.3;
  val += sin((nx * 3.0 + ny * 5.0) * 3.141 + t * 0.25) * 0.2;
  val += sin(nx * 12.566 + ny * 8.37 + t * 0.18) * 0.1;
  val += sin(ny * 6.283 - nx * 4.189 + t * 0.22) * 0.1;
  val += cos(nx * 7.5 + ny * 9.3) * sin(t * 0.12) * 0.08;
  val = (val + 1.0) / 2.0;

  float accentBlend = (sin(nx * 3.0 + ny * 2.0 + t * 0.1) + 1.0) / 2.0;
  vec3 target = mix(u_accent, u_accent2, accentBlend);
  float intensity = 0.18 + val * 0.62;
  gl_FragColor = vec4(clamp(mix(u_baseA, target, intensity), 0.0, 1.0), 1.0);
}
`;

// Matches drawFractalFlow().
const FRACTAL_FLOW_SOURCE = `${FRAGMENT_HEADER}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float nx = uv.x;
  float ny = 1.0 - uv.y;
  float t = u_time * 0.6;

  float val = 0.0;
  val += sin(nx * 10.0 + t * 0.5) * cos(ny * 8.0 + t * 0.3) * 0.5;
  val += sin(ny * 12.0 - t * 0.4) * cos(nx * 6.0 + t * 0.35) * 0.4;
  val += sin((nx * 5.0 + ny * 7.0) * 3.14159265 + t * 0.25) * 0.3;
  val += sin(nx * 15.0 + ny * 10.0 + t * 0.2) * 0.2;
  val = (val + 1.6) / 3.2;

  float accentBlend = (sin((nx + ny) * 3.0 + t * 0.3) + 1.0) / 2.0;
  vec3 target = mix(u_accent, u_accent2, accentBlend);
  float intensity = 0.16 + val * 0.7;
  gl_FragColor = vec4(clamp(mix(u_baseA, target, intensity), 0.0, 1.0), 1.0);
}
`;

// Matches drawAurora().
const AURORA_SOURCE = `${FRAGMENT_HEADER}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float nx = uv.x;
  float ny = 1.0 - uv.y;
  float t = u_time * 0.3;

  float val = 0.0;
  val += sin(ny * 8.0 + t * 0.7) * cos(nx * 3.0 - t * 0.5 + ny * 2.0) * 0.6;
  val += sin(ny * 15.0 - t * 0.4 + nx * 2.0) * 0.3;
  val += cos(nx * 6.0 + t * 0.3) * sin(ny * 4.0 + t * 0.6) * 0.4;
  val += sin((nx + ny) * 10.0 + t * 0.25) * 0.2;
  val *= sin(ny * 3.14159265) * 1.2;
  val = (val + 0.8) / 1.6;

  float accentBlend = (cos(nx * 3.0 + t * 0.3) + 1.0) / 2.0;
  vec3 target = mix(u_accent2, u_accent, accentBlend);
  float intensity = 0.12 + val * 0.76;
  gl_FragColor = vec4(clamp(mix(u_baseA, target, intensity), 0.0, 1.0), 1.0);
}
`;

// Matches drawPlasmaWaves(). Distances and angles are computed in simulation
// pixels so the ring frequencies equal the CPU renderer.
const PLASMA_SOURCE = `${FRAGMENT_HEADER}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 simPoint = vec2(uv.x, 1.0 - uv.y) * u_simResolution;
  vec2 center = u_simResolution / 2.0;
  float dist = distance(simPoint, center);
  float angle = atan(simPoint.y - center.y, simPoint.x - center.x);
  float t = u_time * 0.5;

  float val = 0.0;
  val += sin(dist * 0.03 + t * 0.8) * 0.5;
  val += cos(angle * 4.0 + t * 0.4) * 0.3;
  val += sin(dist * 0.05 - t * 0.6 + angle * 2.0) * 0.4;
  val += cos(dist * 0.02 + angle * 5.0) * sin(t * 0.3) * 0.3;
  val = (val + 1.2) / 2.4;

  float dangerMix = (cos(angle * 3.0 + t * 0.35) + 1.0) / 2.0;
  vec3 hot = mix(u_accent, u_danger, dangerMix);
  vec3 cool = u_baseC * 0.66 + u_accent2 * 0.34;
  float intensity = 0.1 + val * 0.82;
  gl_FragColor = vec4(clamp(mix(cool, hot, intensity), 0.0, 1.0), 1.0);
}
`;

// Matches drawJuliaSet().
const JULIA_SOURCE = `${FRAGMENT_HEADER}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float t = u_time * 0.18;
  float cRe = -0.78 + sin(t) * 0.04;
  float cIm = 0.156 + cos(t * 0.8) * 0.035;
  float zoom = 1.25 + sin(t * 0.6) * 0.08;

  float zx = (uv.x - 0.5) * 3.1 / zoom;
  float zy = ((1.0 - uv.y) - 0.5) * 2.25 / zoom;

  const int maxIter = 22;
  int iter = maxIter;
  for (int i = 0; i < maxIter; i++) {
    if (zx * zx + zy * zy >= 4.0) {
      iter = i;
      break;
    }
    float nextX = zx * zx - zy * zy + cRe;
    zy = 2.0 * zx * zy + cIm;
    zx = nextX;
  }

  float ratio = float(iter) / float(maxIter);
  float edge = pow(ratio, 1.8);
  float glow = sin(ratio * 3.14159265);
  vec3 colorA = mix(u_baseA, u_accent, edge);
  vec3 colorB = mix(u_accent2, u_danger, glow * 0.35);
  vec3 color = mix(colorA, colorB, glow * 0.42);
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

// Matches drawReactionDiffusion().
const REACTION_DIFFUSION_SOURCE = `${FRAGMENT_HEADER}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float nx = uv.x;
  float ny = 1.0 - uv.y;
  float cx = nx - 0.5;
  float cy = ny - 0.5;
  float dist = sqrt(cx * cx + cy * cy);
  float t = u_time * 0.42;

  float cells =
    sin((nx * 18.0 + sin(ny * 9.0 + t)) * 3.14159265) +
    cos((ny * 16.0 + cos(nx * 8.0 - t * 0.8)) * 3.14159265);
  float rings = sin(dist * 64.0 - t * 3.4);
  float veins = sin((nx + ny) * 28.0 + sin((nx - ny) * 12.0 + t));
  float val = (cells * 0.42 + rings * 0.34 + veins * 0.24 + 1.6) / 3.2;
  float clamped = clamp(val, 0.0, 1.0);
  float s = clamped * clamped * (3.0 - 2.0 * clamped);

  vec3 color = mix(
    mix(u_baseA, u_accent, s),
    mix(u_accent2, u_danger, 0.24),
    max(0.0, sin(s * 3.14159265)) * 0.34
  );
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

const FRAGMENT_SOURCES: Record<WebglBackgroundType, string> = {
  perlin: PERLIN_SOURCE,
  'fractal-flow': FRACTAL_FLOW_SOURCE,
  aurora: AURORA_SOURCE,
  plasma: PLASMA_SOURCE,
  julia: JULIA_SOURCE,
  'reaction-diffusion': REACTION_DIFFUSION_SOURCE,
};

export function isWebglBackgroundType(type: string | undefined): type is WebglBackgroundType {
  return Boolean(type && type in FRAGMENT_SOURCES);
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function createWebglBackground(
  canvas: HTMLCanvasElement,
  type: WebglBackgroundType,
  palette: WebglPalette
): WebglBackgroundHandle | null {
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'low-power',
    });
  } catch {
    return null;
  }
  if (!gl) return null;

  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCES[type]);
  const program = gl.createProgram();
  if (!vertexShader || !fragmentShader || !program) {
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
    if (program) gl.deleteProgram(program);
    return null;
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return null;
  }

  gl.useProgram(program);

  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  // One triangle covering the whole clip space.
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const positionLocation = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  const timeLocation = gl.getUniformLocation(program, 'u_time');
  const resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
  const simResolutionLocation = gl.getUniformLocation(program, 'u_simResolution');
  gl.uniform3fv(gl.getUniformLocation(program, 'u_baseA'), palette.baseA);
  gl.uniform3fv(gl.getUniformLocation(program, 'u_baseB'), palette.baseB);
  gl.uniform3fv(gl.getUniformLocation(program, 'u_baseC'), palette.baseC);
  gl.uniform3fv(gl.getUniformLocation(program, 'u_accent'), palette.accent);
  gl.uniform3fv(gl.getUniformLocation(program, 'u_accent2'), palette.accent2);
  gl.uniform3fv(gl.getUniformLocation(program, 'u_danger'), palette.danger);

  let disposed = false;

  return {
    render: (timeSeconds: number) => {
      if (disposed || gl.isContextLost()) return;
      gl.uniform1f(timeLocation, timeSeconds);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    resize: (width: number, height: number, simWidth: number, simHeight: number) => {
      if (disposed || gl.isContextLost()) return;
      gl.viewport(0, 0, width, height);
      gl.uniform2f(resolutionLocation, width, height);
      gl.uniform2f(simResolutionLocation, simWidth, simHeight);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      // The context itself stays alive: the effect that owns the canvas can
      // re-run (e.g. when the ready callback identity changes) and a lost
      // context would permanently disable WebGL for this canvas element.
      if (!gl.isContextLost()) {
        gl.deleteBuffer(positionBuffer);
        gl.deleteProgram(program);
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
      }
    },
  };
}
