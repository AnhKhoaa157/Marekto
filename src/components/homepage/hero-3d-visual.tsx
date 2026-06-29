"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

type Hero3DVisualProps = Readonly<{
  /**
   * Static CSS/SVG visual shown before the scene mounts and whenever 3D is
   * unavailable (no WebGL or reduced-motion). It also fills the layout box so
   * mounting the canvas never shifts the page.
   */
  children: ReactNode;
}>;

type ThreeModule = typeof import("three");

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext("webgl") ||
          canvas.getContext("experimental-webgl")),
    );
  } catch {
    return false;
  }
}

/**
 * Builds a tiny soft radial-gradient sprite (generated in code, no asset) used
 * to give particles and nodes a premium glow instead of hard squares.
 */
function createGlowTexture(THREE: ThreeModule) {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  if (ctx) {
    const gradient = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    );
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.25, "rgba(255,255,255,0.85)");
    gradient.addColorStop(0.5, "rgba(255,255,255,0.32)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * "Marekto AI Lead Journey Engine" — a lightweight, conceptual 3D scene:
 * contacts stream as glowing particles down a layered segmentation funnel,
 * AI/network nodes orbit and beam into the core, and a delivery arc carries a
 * pulse out to an envelope (personalized email). It is decorative only; it
 * encodes no business data, counts, or records.
 *
 * Performance: `three` is dynamically imported inside the effect (code-split,
 * never blocking first paint / SSR). The render loop pauses offscreen and when
 * the tab is hidden, the pixel ratio is capped, geometry/materials/texture are
 * disposed on unmount, and reduced-motion / missing-WebGL keep the static
 * `children` fallback.
 */
export function Hero3DVisual({ children }: Hero3DVisualProps) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) {
      return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches || !hasWebGL()) {
      return;
    }

    let disposed = false;
    let cleanup: (() => void) | null = null;

    import("three")
      .then((THREE) => {
        if (disposed || !layerRef.current) {
          return;
        }

        const host = layerRef.current;
        const width = host.clientWidth || 1;
        const height = host.clientHeight || 1;

        const renderer = new THREE.WebGLRenderer({
          alpha: true,
          antialias: true,
          powerPreference: "high-performance",
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(width, height, false);

        const canvas = renderer.domElement;
        canvas.setAttribute("aria-hidden", "true");
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.display = "block";
        host.appendChild(canvas);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
        camera.position.set(0, 0.4, 8.4);
        camera.lookAt(0, 0, 0);

        const group = new THREE.Group();
        group.rotation.x = 0.34;
        scene.add(group);

        // Track every disposable so unmount fully releases GPU memory.
        const disposables: Array<{ dispose: () => void }> = [];
        const glowTexture = createGlowTexture(THREE);
        disposables.push(glowTexture);

        // Brand palette.
        const indigo = new THREE.Color("#6366f1");
        const blue = new THREE.Color("#3b82f6");
        const cyan = new THREE.Color("#22d3ee");
        const teal = new THREE.Color("#2dd4bf");

        // Funnel geometry parameters (oriented along the Y axis).
        const TOP_Y = 2.7;
        const BOTTOM_Y = -2.3;
        const TOP_RADIUS = 2.5;
        const BOTTOM_RADIUS = 0.24;
        const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

        // 1) Layered segmentation funnel: stacked perspective rings, colour
        //    graded indigo -> blue -> cyan from intake to output.
        const ringCount = 9;
        const ringSegments = 72;
        for (let r = 0; r < ringCount; r += 1) {
          const t = r / (ringCount - 1);
          const y = lerp(TOP_Y, BOTTOM_Y, t);
          const radius = lerp(TOP_RADIUS, BOTTOM_RADIUS, t);
          const ringPositions = new Float32Array((ringSegments + 1) * 3);
          for (let s = 0; s <= ringSegments; s += 1) {
            const angle = (s / ringSegments) * Math.PI * 2;
            ringPositions[s * 3] = Math.cos(angle) * radius;
            ringPositions[s * 3 + 1] = y;
            ringPositions[s * 3 + 2] = Math.sin(angle) * radius;
          }
          const ringGeometry = new THREE.BufferGeometry();
          ringGeometry.setAttribute(
            "position",
            new THREE.BufferAttribute(ringPositions, 3),
          );
          const ringColor = indigo.clone().lerp(cyan, t);
          const ringMaterial = new THREE.LineBasicMaterial({
            color: ringColor,
            opacity: 0.18 + (1 - t) * 0.22,
            transparent: true,
          });
          const ring = new THREE.LineLoop(ringGeometry, ringMaterial);
          group.add(ring);
          disposables.push(ringGeometry, ringMaterial);
        }

        // Faint outer halo ring for depth/framing.
        const haloSegments = 96;
        const haloPositions = new Float32Array((haloSegments + 1) * 3);
        for (let s = 0; s <= haloSegments; s += 1) {
          const angle = (s / haloSegments) * Math.PI * 2;
          haloPositions[s * 3] = Math.cos(angle) * 3.25;
          haloPositions[s * 3 + 1] = 0.2;
          haloPositions[s * 3 + 2] = Math.sin(angle) * 3.25;
        }
        const haloGeometry = new THREE.BufferGeometry();
        haloGeometry.setAttribute(
          "position",
          new THREE.BufferAttribute(haloPositions, 3),
        );
        const haloMaterial = new THREE.LineBasicMaterial({
          color: indigo,
          opacity: 0.08,
          transparent: true,
        });
        const halo = new THREE.LineLoop(haloGeometry, haloMaterial);
        group.add(halo);
        disposables.push(haloGeometry, haloMaterial);

        // 2) Lead particles streaming down the funnel.
        const leadCount = 220;
        const leadPositions = new Float32Array(leadCount * 3);
        const leadColors = new Float32Array(leadCount * 3);
        const leadProgress = new Float32Array(leadCount);
        const leadAngle = new Float32Array(leadCount);
        const leadRadiusFactor = new Float32Array(leadCount);
        const leadSpeed = new Float32Array(leadCount);
        const TWIST = 2.4;
        const tmpColor = new THREE.Color();

        const placeLead = (i: number) => {
          const p = leadProgress[i];
          const y = lerp(TOP_Y, BOTTOM_Y, p);
          const ringRadius = lerp(TOP_RADIUS, BOTTOM_RADIUS, p);
          const radius = ringRadius * leadRadiusFactor[i];
          const angle = leadAngle[i] + p * TWIST;
          leadPositions[i * 3] = Math.cos(angle) * radius;
          leadPositions[i * 3 + 1] = y;
          leadPositions[i * 3 + 2] = Math.sin(angle) * radius;
        };

        for (let i = 0; i < leadCount; i += 1) {
          leadProgress[i] = Math.random();
          leadAngle[i] = Math.random() * Math.PI * 2;
          leadRadiusFactor[i] = 0.82 + Math.random() * 0.26;
          leadSpeed[i] = 0.05 + Math.random() * 0.09;
          placeLead(i);
          tmpColor.copy(indigo).lerp(cyan, Math.random());
          leadColors[i * 3] = tmpColor.r;
          leadColors[i * 3 + 1] = tmpColor.g;
          leadColors[i * 3 + 2] = tmpColor.b;
        }

        const leadGeometry = new THREE.BufferGeometry();
        const leadPositionAttribute = new THREE.BufferAttribute(
          leadPositions,
          3,
        );
        leadPositionAttribute.setUsage(THREE.DynamicDrawUsage);
        leadGeometry.setAttribute("position", leadPositionAttribute);
        leadGeometry.setAttribute(
          "color",
          new THREE.BufferAttribute(leadColors, 3),
        );
        const leadMaterial = new THREE.PointsMaterial({
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          map: glowTexture,
          opacity: 0.92,
          size: 0.16,
          sizeAttenuation: true,
          transparent: true,
          vertexColors: true,
        });
        const leads = new THREE.Points(leadGeometry, leadMaterial);
        group.add(leads);
        disposables.push(leadGeometry, leadMaterial);

        // Bright converging core at the funnel output.
        const coreGeometry = new THREE.BufferGeometry();
        coreGeometry.setAttribute(
          "position",
          new THREE.BufferAttribute(
            new Float32Array([0, BOTTOM_Y - 0.05, 0]),
            3,
          ),
        );
        const coreMaterial = new THREE.PointsMaterial({
          blending: THREE.AdditiveBlending,
          color: new THREE.Color("#a5f3fc"),
          depthWrite: false,
          map: glowTexture,
          opacity: 0.95,
          size: 1.1,
          sizeAttenuation: true,
          transparent: true,
        });
        const core = new THREE.Points(coreGeometry, coreMaterial);
        group.add(core);
        disposables.push(coreGeometry, coreMaterial);

        // 3) Orbiting AI/network nodes with beams into the core.
        const nodeCount = 6;
        const orbitCenter = new THREE.Vector3(0, 0.3, 0);
        const orbitRadius: number[] = [];
        const orbitSpeed: number[] = [];
        const orbitPhase: number[] = [];
        const orbitTilt: number[] = [];
        for (let n = 0; n < nodeCount; n += 1) {
          orbitRadius.push(1.9 + Math.random() * 1.1);
          orbitSpeed.push(0.18 + Math.random() * 0.16);
          orbitPhase.push(Math.random() * Math.PI * 2);
          orbitTilt.push(-0.5 + Math.random() * 1.0);
        }
        const nodePositions = new Float32Array(nodeCount * 3);
        const nodeGeometry = new THREE.BufferGeometry();
        const nodePositionAttribute = new THREE.BufferAttribute(
          nodePositions,
          3,
        );
        nodePositionAttribute.setUsage(THREE.DynamicDrawUsage);
        nodeGeometry.setAttribute("position", nodePositionAttribute);
        const nodeMaterial = new THREE.PointsMaterial({
          blending: THREE.AdditiveBlending,
          color: teal,
          depthWrite: false,
          map: glowTexture,
          opacity: 0.95,
          size: 0.5,
          sizeAttenuation: true,
          transparent: true,
        });
        const nodes = new THREE.Points(nodeGeometry, nodeMaterial);
        group.add(nodes);
        disposables.push(nodeGeometry, nodeMaterial);

        const beamPositions = new Float32Array(nodeCount * 2 * 3);
        const beamGeometry = new THREE.BufferGeometry();
        const beamPositionAttribute = new THREE.BufferAttribute(
          beamPositions,
          3,
        );
        beamPositionAttribute.setUsage(THREE.DynamicDrawUsage);
        beamGeometry.setAttribute("position", beamPositionAttribute);
        const beamMaterial = new THREE.LineBasicMaterial({
          blending: THREE.AdditiveBlending,
          color: blue,
          opacity: 0.28,
          transparent: true,
        });
        const beams = new THREE.LineSegments(beamGeometry, beamMaterial);
        group.add(beams);
        disposables.push(beamGeometry, beamMaterial);

        const updateNodes = (elapsed: number) => {
          for (let n = 0; n < nodeCount; n += 1) {
            const t = orbitPhase[n] + elapsed * orbitSpeed[n];
            const radius = orbitRadius[n];
            const tilt = orbitTilt[n];
            const ox = Math.cos(t) * radius;
            const oz = Math.sin(t) * radius;
            const x = orbitCenter.x + ox;
            const y = orbitCenter.y - oz * Math.sin(tilt);
            const z = orbitCenter.z + oz * Math.cos(tilt);
            nodePositions[n * 3] = x;
            nodePositions[n * 3 + 1] = y;
            nodePositions[n * 3 + 2] = z;
            beamPositions[n * 6] = orbitCenter.x;
            beamPositions[n * 6 + 1] = orbitCenter.y;
            beamPositions[n * 6 + 2] = orbitCenter.z;
            beamPositions[n * 6 + 3] = x;
            beamPositions[n * 6 + 4] = y;
            beamPositions[n * 6 + 5] = z;
          }
          nodePositionAttribute.needsUpdate = true;
          beamPositionAttribute.needsUpdate = true;
        };

        // 4) Delivery signal: an arc from the core out to an envelope, with a
        //    pulse travelling along it (personalized email being sent).
        const deliveryStart = new THREE.Vector3(0, BOTTOM_Y - 0.05, 0);
        const envelopeCenter = new THREE.Vector3(2.05, -1.9, 0.35);
        const deliveryCurve = new THREE.QuadraticBezierCurve3(
          deliveryStart,
          new THREE.Vector3(1.0, -0.85, 1.5),
          envelopeCenter,
        );
        const arcPoints = deliveryCurve.getPoints(40);
        const arcGeometry = new THREE.BufferGeometry().setFromPoints(arcPoints);
        const arcMaterial = new THREE.LineBasicMaterial({
          blending: THREE.AdditiveBlending,
          color: cyan,
          opacity: 0.3,
          transparent: true,
        });
        const arc = new THREE.Line(arcGeometry, arcMaterial);
        group.add(arc);
        disposables.push(arcGeometry, arcMaterial);

        const pulseGeometry = new THREE.BufferGeometry();
        const pulsePositionAttribute = new THREE.BufferAttribute(
          new Float32Array(3),
          3,
        );
        pulsePositionAttribute.setUsage(THREE.DynamicDrawUsage);
        pulseGeometry.setAttribute("position", pulsePositionAttribute);
        const pulseMaterial = new THREE.PointsMaterial({
          blending: THREE.AdditiveBlending,
          color: new THREE.Color("#ccfbf1"),
          depthWrite: false,
          map: glowTexture,
          opacity: 0.95,
          size: 0.5,
          sizeAttenuation: true,
          transparent: true,
        });
        const pulse = new THREE.Points(pulseGeometry, pulseMaterial);
        group.add(pulse);
        disposables.push(pulseGeometry, pulseMaterial);

        // Envelope outline near the delivery output (lines only).
        const ew = 0.62;
        const eh = 0.42;
        const ex = envelopeCenter.x;
        const ey = envelopeCenter.y;
        const ez = envelopeCenter.z;
        const envelopeVertices = new Float32Array([
          // rectangle
          ex - ew, ey - eh, ez, ex + ew, ey - eh, ez,
          ex + ew, ey - eh, ez, ex + ew, ey + eh, ez,
          ex + ew, ey + eh, ez, ex - ew, ey + eh, ez,
          ex - ew, ey + eh, ez, ex - ew, ey - eh, ez,
          // flap
          ex - ew, ey + eh, ez, ex, ey - 0.02, ez,
          ex, ey - 0.02, ez, ex + ew, ey + eh, ez,
        ]);
        const envelopeGeometry = new THREE.BufferGeometry();
        envelopeGeometry.setAttribute(
          "position",
          new THREE.BufferAttribute(envelopeVertices, 3),
        );
        const envelopeMaterial = new THREE.LineBasicMaterial({
          blending: THREE.AdditiveBlending,
          color: teal,
          opacity: 0.7,
          transparent: true,
        });
        const envelope = new THREE.LineSegments(
          envelopeGeometry,
          envelopeMaterial,
        );
        group.add(envelope);
        disposables.push(envelopeGeometry, envelopeMaterial);

        const pulseVector = new THREE.Vector3();
        const updateDelivery = (elapsed: number) => {
          const t = (elapsed * 0.32) % 1;
          deliveryCurve.getPoint(t, pulseVector);
          pulsePositionAttribute.setXYZ(
            0,
            pulseVector.x,
            pulseVector.y,
            pulseVector.z,
          );
          pulsePositionAttribute.needsUpdate = true;
          pulseMaterial.opacity = 0.4 + Math.sin(t * Math.PI) * 0.55;
          envelopeMaterial.opacity = 0.5 + Math.sin(elapsed * 1.4) * 0.2;
        };

        const clock = new THREE.Clock();
        let frame = 0;
        let inView = true;
        let elapsed = 0;

        const renderFrame = () => {
          // Clamp delta (and accumulate elapsed from it) so a tab/scroll pause
          // never produces a motion spike when the loop resumes.
          const delta = Math.min(clock.getDelta(), 0.05);
          elapsed += delta;

          for (let i = 0; i < leadCount; i += 1) {
            leadProgress[i] += leadSpeed[i] * delta;
            if (leadProgress[i] >= 1) {
              leadProgress[i] -= 1;
              leadAngle[i] = Math.random() * Math.PI * 2;
            }
            placeLead(i);
          }
          leadPositionAttribute.needsUpdate = true;

          updateNodes(elapsed);
          updateDelivery(elapsed);

          group.rotation.y = elapsed * 0.1;
          group.rotation.x = 0.34 + Math.sin(elapsed * 0.35) * 0.05;
          camera.position.x = Math.sin(elapsed * 0.18) * 0.35;
          camera.position.y = 0.4 + Math.sin(elapsed * 0.22) * 0.12;
          camera.lookAt(0, 0, 0);

          coreMaterial.opacity = 0.7 + Math.sin(elapsed * 2.2) * 0.25;
          renderer.render(scene, camera);
        };

        const loop = () => {
          frame = requestAnimationFrame(loop);
          renderFrame();
        };

        const startLoop = () => {
          if (frame === 0 && inView && !document.hidden) {
            clock.getDelta();
            frame = requestAnimationFrame(loop);
          }
        };

        const stopLoop = () => {
          if (frame !== 0) {
            cancelAnimationFrame(frame);
            frame = 0;
          }
        };

        const handleVisibility = () => {
          if (document.hidden) {
            stopLoop();
          } else {
            startLoop();
          }
        };

        const intersectionObserver = new IntersectionObserver(
          (entries) => {
            inView = entries[0]?.isIntersecting ?? true;
            if (inView) {
              startLoop();
            } else {
              stopLoop();
            }
          },
          { threshold: 0.05 },
        );
        intersectionObserver.observe(host);

        const resizeObserver = new ResizeObserver(() => {
          const nextWidth = host.clientWidth;
          const nextHeight = host.clientHeight;
          if (nextWidth === 0 || nextHeight === 0) {
            return;
          }
          camera.aspect = nextWidth / nextHeight;
          camera.updateProjectionMatrix();
          renderer.setSize(nextWidth, nextHeight, false);
          if (frame === 0) {
            renderFrame();
          }
        });
        resizeObserver.observe(host);

        document.addEventListener("visibilitychange", handleVisibility);

        renderFrame();
        setActive(true);
        startLoop();

        cleanup = () => {
          stopLoop();
          intersectionObserver.disconnect();
          resizeObserver.disconnect();
          document.removeEventListener("visibilitychange", handleVisibility);
          for (const disposable of disposables) {
            disposable.dispose();
          }
          renderer.dispose();
          if (canvas.parentNode) {
            canvas.parentNode.removeChild(canvas);
          }
        };
      })
      .catch(() => {
        // WebGL/runtime failure: silently keep the static fallback.
      });

    return () => {
      disposed = true;
      if (cleanup) {
        cleanup();
      }
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      <div
        className={
          active
            ? "absolute inset-0 opacity-0 transition-opacity duration-700"
            : "absolute inset-0 opacity-100 transition-opacity duration-700"
        }
      >
        {children}
      </div>
      <div className="pointer-events-none absolute inset-0" ref={layerRef} />
    </div>
  );
}
