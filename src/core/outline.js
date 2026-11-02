// Ink outlines as a post pass, ported 1:1 from the ESP32 track's stage
// (assets/kit-*.js): the scene is drawn once with normals + depth and once in
// colour (4× MSAA), then a full-screen pass draws dark lines where depth steps
// or normals crease, over the colour. Only layer 0 goes into the normal pass, so
// the floor, grid and glow sprites (layer 1) get no outline.
import * as THREE from 'three';

const VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;
const FRAG = `
  uniform sampler2D tColor;
  uniform sampler2D tNormal;
  uniform sampler2D tDepth;
  uniform vec2 texel;
  uniform float thickness;
  uniform float depthRange;
  uniform float depthThreshold;
  uniform float normalThreshold;
  uniform vec3 lineColor;
  uniform float lineOpacity;
  uniform bool srgbOut;
  varying vec2 vUv;

  float depthAt(vec2 uv) { return texture2D(tDepth, uv).r * depthRange; }

  float edgePair(vec2 uv, vec2 off, float d0, vec4 n0) {
    vec4 na = texture2D(tNormal, uv + off);
    vec4 nb = texture2D(tNormal, uv - off);
    float da = depthAt(uv + off);
    float db = depthAt(uv - off);
    float e = max(abs(na.a - n0.a), abs(nb.a - n0.a));
    if (n0.a > 0.5) {
      float lap = abs(da + db - 2.0 * d0);
      float stepA = (na.a > 0.5) ? abs(da - d0) : 0.0;
      float stepB = (nb.a > 0.5) ? abs(db - d0) : 0.0;
      float dEdge = smoothstep(depthThreshold, depthThreshold * 2.0, min(lap, max(stepA, stepB) * 2.0));
      e = max(e, dEdge);
      vec3 c = n0.xyz * 2.0 - 1.0;
      float ca = na.a > 0.5 ? 1.0 - dot(c, na.xyz * 2.0 - 1.0) : 0.0;
      float cb = nb.a > 0.5 ? 1.0 - dot(c, nb.xyz * 2.0 - 1.0) : 0.0;
      e = max(e, 0.9 * smoothstep(normalThreshold, normalThreshold * 2.2, max(ca, cb)));
    }
    return e;
  }

  void main() {
    vec4 col = texture2D(tColor, vUv);
    vec4 n0 = texture2D(tNormal, vUv);
    float d0 = depthAt(vUv);
    vec2 o = texel * thickness;
    float e = 0.0;
    e = max(e, edgePair(vUv, vec2(o.x, 0.0), d0, n0));
    e = max(e, edgePair(vUv, vec2(0.0, o.y), d0, n0));
    e = max(e, edgePair(vUv, vec2(o.x, o.y) * 0.7071, d0, n0));
    e = max(e, edgePair(vUv, vec2(o.x, -o.y) * 0.7071, d0, n0));
    float e2 = 0.0;
    vec2 o2 = o * 1.5;
    e2 = max(e2, edgePair(vUv, vec2(o2.x, 0.0), d0, n0));
    e2 = max(e2, edgePair(vUv, vec2(0.0, o2.y), d0, n0));
    e = max(e, e2 * 0.35);
    e *= lineOpacity;
    vec3 rgb = col.a > 0.0 ? col.rgb / col.a : vec3(0.0);
    float a = col.a;
    float outA = a + e * (1.0 - a);
    vec3 mixed = (rgb * a * (1.0 - e) + lineColor * e) / max(outA, 1e-4);
    gl_FragColor = vec4(mixed, outA);
    #include <colorspace_fragment>
    if (srgbOut) gl_FragColor = sRGBTransferOETF(gl_FragColor);
    else gl_FragColor.rgb *= gl_FragColor.a;
  }
`;

export class OutlineComposer {
  // depthThreshold / normalThreshold: the ESP32 stage works in mm (0.35); this
  // stage works in cm, so the same lines need 0.035
  constructor(renderer, { lineColor = '#141a2c', thickness = 1.3, opacity = 1, depthThreshold = 0.035, normalThreshold = 0.22 } = {}) {
    this.renderer = renderer;
    this.thickness = thickness;
    this.colorTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.normalTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(1, 1, THREE.FloatType) });
    this.normalMaterial = new THREE.MeshNormalMaterial();
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        tColor: { value: this.colorTarget.texture }, tNormal: { value: this.normalTarget.texture }, tDepth: { value: this.normalTarget.depthTexture },
        texel: { value: new THREE.Vector2() }, thickness: { value: thickness }, depthRange: { value: 1 },
        depthThreshold: { value: depthThreshold }, normalThreshold: { value: normalThreshold },
        lineColor: { value: new THREE.Color(lineColor) }, lineOpacity: { value: opacity }, srgbOut: { value: false },
      },
      depthTest: false, depthWrite: false, transparent: true, blending: THREE.NoBlending,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
    this.quad = new THREE.Mesh(geo, this.material);
    this.quad.frustumCulled = false;
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.clearColor = new THREE.Color();
    this.enabled = true;
  }
  setSize(w, h, pr) {
    const W = Math.max(1, Math.round(w * pr)), H = Math.max(1, Math.round(h * pr));
    this.colorTarget.setSize(W, H);
    this.normalTarget.setSize(W, H);
    this.material.uniforms.texel.value.set(1 / W, 1 / H);
    this.pixelRatio = pr;
    this.setLineScale(this.lineScale ?? 1);
  }
  setLineScale(s) {
    this.lineScale = s;
    this.material.uniforms.thickness.value = this.thickness * (this.pixelRatio ?? 1) * s;
  }
  setLineColor(c) { this.material.uniforms.lineColor.value.set(c); }
  render(scene, camera, target = null) {
    const r = this.renderer;
    if (!this.enabled) { r.setRenderTarget(target); r.render(scene, camera); if (target) r.setRenderTarget(null); return; }
    const alpha = r.getClearAlpha();
    r.getClearColor(this.clearColor);
    const mask = camera.layers.mask;
    this.material.uniforms.depthRange.value = camera.far - camera.near;
    r.setClearColor(0, 0);
    camera.layers.set(0);
    scene.overrideMaterial = this.normalMaterial;
    r.setRenderTarget(this.normalTarget); r.clear(); r.render(scene, camera);
    scene.overrideMaterial = null;
    camera.layers.enableAll();
    r.setRenderTarget(this.colorTarget); r.clear(); r.render(scene, camera);
    camera.layers.mask = mask;
    this.material.uniforms.srgbOut.value = !!target;
    r.setRenderTarget(target); r.clear(); r.render(this.quad, this.quadCam);
    if (target) r.setRenderTarget(null);
    r.setClearColor(this.clearColor, alpha);
  }
}
