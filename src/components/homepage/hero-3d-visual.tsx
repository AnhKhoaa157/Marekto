"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

type Hero3DVisualProps = Readonly<{
  /**
   * Static CSS/SVG visual shown before the scene mounts and whenever 3D is
   * unavailable (no WebGL or reduced-motion). It also fills the layout box so
   * mounting the canvas never shifts the page.
   */
  children: ReactNode;
  activeSection?: string | null;
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
 * "Marekto AI Lead Journey Engine" — an enhanced 3D visual component.
 * Features:
 * - Parallax camera movement and group tilt relative to user's mouse position.
 * - Reactive highlighting of components synced to the hovered state from parent.
 * - Dual-particle system representing ambient contacts and active qualified leads.
 * - Premium semi-transparent 3D envelope structure.
 */
export function Hero3DVisual({ children, activeSection }: Hero3DVisualProps) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(false);
  const activeSectionRef = useRef<string | null>(null);

  // Bind activeSection to a ref to let the WebGL render loop consume it without hot-rebuilding the scene
  useEffect(() => {
    activeSectionRef.current = activeSection ?? null;
  }, [activeSection]);

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

        const disposables: Array<{ dispose: () => void }> = [];
        const glowTexture = createGlowTexture(THREE);
        disposables.push(glowTexture);

        // Brand colors
        const indigo = new THREE.Color("#6366f1");
        const blue = new THREE.Color("#3b82f6");
        const cyan = new THREE.Color("#22d3ee");
        const teal = new THREE.Color("#2dd4bf");

        // Funnel boundaries
        const TOP_Y = 2.7;
        const BOTTOM_Y = -2.3;
        const TOP_RADIUS = 2.5;
        const BOTTOM_RADIUS = 0.24;
        const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

        // 1) Funnel rings
        const ringCount = 9;
        const ringSegments = 72;
        const ringsList: Array<{
          line: import("three").LineLoop;
          defaultOpacity: number;
        }> = [];

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
          const defaultOpacity = 0.18 + (1 - t) * 0.22;
          const ringMaterial = new THREE.LineBasicMaterial({
            color: ringColor,
            opacity: defaultOpacity,
            transparent: true,
          });
          const ring = new THREE.LineLoop(ringGeometry, ringMaterial);
          group.add(ring);
          ringsList.push({ line: ring, defaultOpacity });
          disposables.push(ringGeometry, ringMaterial);
        }

        // Faint framing halo
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

        // 2) Dual particle system: Ambient (slow background records) + Active (AI qualified leads)
        const TWIST = 2.4;
        const tmpColor = new THREE.Color();

        // System A: Ambient Leads (dimmer, smaller, slower)
        const ambientCount = 140;
        const ambientPositions = new Float32Array(ambientCount * 3);
        const ambientColors = new Float32Array(ambientCount * 3);
        const ambientProgress = new Float32Array(ambientCount);
        const ambientAngle = new Float32Array(ambientCount);
        const ambientRadiusFactor = new Float32Array(ambientCount);
        const ambientSpeed = new Float32Array(ambientCount);

        // System B: Active Leads (brighter, larger, faster)
        const activeCount = 80;
        const activePositions = new Float32Array(activeCount * 3);
        const activeColors = new Float32Array(activeCount * 3);
        const activeProgress = new Float32Array(activeCount);
        const activeAngle = new Float32Array(activeCount);
        const activeRadiusFactor = new Float32Array(activeCount);
        const activeSpeed = new Float32Array(activeCount);

        const placeLead = (
          positions: Float32Array,
          progress: number,
          angle: number,
          radiusFactor: number,
          index: number,
        ) => {
          const y = lerp(TOP_Y, BOTTOM_Y, progress);
          const ringRadius = lerp(TOP_RADIUS, BOTTOM_RADIUS, progress);
          const radius = ringRadius * radiusFactor;
          const currentAngle = angle + progress * TWIST;
          positions[index * 3] = Math.cos(currentAngle) * radius;
          positions[index * 3 + 1] = y;
          positions[index * 3 + 2] = Math.sin(currentAngle) * radius;
        };

        // Initialize Ambient Leads
        for (let i = 0; i < ambientCount; i += 1) {
          ambientProgress[i] = Math.random();
          ambientAngle[i] = Math.random() * Math.PI * 2;
          ambientRadiusFactor[i] = 0.85 + Math.random() * 0.2;
          ambientSpeed[i] = 0.03 + Math.random() * 0.04;
          placeLead(ambientPositions, ambientProgress[i], ambientAngle[i], ambientRadiusFactor[i], i);
          
          tmpColor.copy(indigo).lerp(blue, Math.random() * 0.6);
          ambientColors[i * 3] = tmpColor.r;
          ambientColors[i * 3 + 1] = tmpColor.g;
          ambientColors[i * 3 + 2] = tmpColor.b;
        }

        const ambientGeometry = new THREE.BufferGeometry();
        const ambientPositionAttribute = new THREE.BufferAttribute(ambientPositions, 3);
        ambientPositionAttribute.setUsage(THREE.DynamicDrawUsage);
        ambientGeometry.setAttribute("position", ambientPositionAttribute);
        ambientGeometry.setAttribute("color", new THREE.BufferAttribute(ambientColors, 3));
        const ambientMaterial = new THREE.PointsMaterial({
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          map: glowTexture,
          opacity: 0.6,
          size: 0.08,
          sizeAttenuation: true,
          transparent: true,
          vertexColors: true,
        });
        const ambientLeads = new THREE.Points(ambientGeometry, ambientMaterial);
        group.add(ambientLeads);
        disposables.push(ambientGeometry, ambientMaterial);

        // Initialize Active Leads
        for (let i = 0; i < activeCount; i += 1) {
          activeProgress[i] = Math.random();
          activeAngle[i] = Math.random() * Math.PI * 2;
          activeRadiusFactor[i] = 0.4 + Math.random() * 0.45; // slightly centered
          activeSpeed[i] = 0.08 + Math.random() * 0.08;
          placeLead(activePositions, activeProgress[i], activeAngle[i], activeRadiusFactor[i], i);

          tmpColor.copy(cyan).lerp(teal, Math.random() * 0.8);
          activeColors[i * 3] = tmpColor.r;
          activeColors[i * 3 + 1] = tmpColor.g;
          activeColors[i * 3 + 2] = tmpColor.b;
        }

        const activeGeometry = new THREE.BufferGeometry();
        const activePositionAttribute = new THREE.BufferAttribute(activePositions, 3);
        activePositionAttribute.setUsage(THREE.DynamicDrawUsage);
        activeGeometry.setAttribute("position", activePositionAttribute);
        activeGeometry.setAttribute("color", new THREE.BufferAttribute(activeColors, 3));
        const activeMaterial = new THREE.PointsMaterial({
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          map: glowTexture,
          opacity: 0.9,
          size: 0.22,
          sizeAttenuation: true,
          transparent: true,
          vertexColors: true,
        });
        const activeLeads = new THREE.Points(activeGeometry, activeMaterial);
        group.add(activeLeads);
        disposables.push(activeGeometry, activeMaterial);

        // Converging core
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
          opacity: 0.75,
          size: 1.1,
          sizeAttenuation: true,
          transparent: true,
        });
        const core = new THREE.Points(coreGeometry, coreMaterial);
        group.add(core);
        disposables.push(coreGeometry, coreMaterial);

        // 3) Orbiting AI nodes with beams
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
          opacity: 0.85,
          size: 0.45,
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

        const updateNodes = (elapsedTime: number, speedMult: number) => {
          for (let n = 0; n < nodeCount; n += 1) {
            const t = orbitPhase[n] + elapsedTime * orbitSpeed[n] * speedMult;
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

        // 4) Delivery arc and pulse
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
          opacity: 0.26,
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
          size: 0.45,
          sizeAttenuation: true,
          transparent: true,
        });
        const pulse = new THREE.Points(pulseGeometry, pulseMaterial);
        group.add(pulse);
        disposables.push(pulseGeometry, pulseMaterial);

        // Premium 3D Envelope body and flap meshes (solid transparent shapes)
        const ew = 0.62;
        const eh = 0.42;
        const ex = envelopeCenter.x;
        const ey = envelopeCenter.y;
        const ez = envelopeCenter.z;

        const envelopeBodyGeom = new THREE.PlaneGeometry(ew * 2, eh * 2);
        const envelopeBodyMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color("#0c4a6e"),
          transparent: true,
          opacity: 0.15,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const envelopeBodyMesh = new THREE.Mesh(envelopeBodyGeom, envelopeBodyMat);
        envelopeBodyMesh.position.copy(envelopeCenter);
        group.add(envelopeBodyMesh);
        disposables.push(envelopeBodyGeom, envelopeBodyMat);

        const flapVertices = new Float32Array([
          -ew, eh, 0,
          ew, eh, 0,
          0, -0.02, 0.06,
        ]);
        const envelopeFlapGeom = new THREE.BufferGeometry();
        envelopeFlapGeom.setAttribute("position", new THREE.BufferAttribute(flapVertices, 3));
        const envelopeFlapMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color("#115e59"),
          transparent: true,
          opacity: 0.25,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const envelopeFlapMesh = new THREE.Mesh(envelopeFlapGeom, envelopeFlapMat);
        envelopeFlapMesh.position.copy(envelopeCenter);
        group.add(envelopeFlapMesh);
        disposables.push(envelopeFlapGeom, envelopeFlapMat);

        // Envelope outer wireframe outline
        const envelopeOutlineVertices = new Float32Array([
          // outer box
          ex - ew, ey - eh, ez, ex + ew, ey - eh, ez,
          ex + ew, ey - eh, ez, ex + ew, ey + eh, ez,
          ex + ew, ey + eh, ez, ex - ew, ey + eh, ez,
          ex - ew, ey + eh, ez, ex - ew, ey - eh, ez,
          // inner flap lines
          ex - ew, ey + eh, ez, ex, ey - 0.02, ez + 0.06,
          ex, ey - 0.02, ez + 0.06, ex + ew, ey + eh, ez,
        ]);
        const envelopeOutlineGeometry = new THREE.BufferGeometry();
        envelopeOutlineGeometry.setAttribute(
          "position",
          new THREE.BufferAttribute(envelopeOutlineVertices, 3),
        );
        const envelopeMaterial = new THREE.LineBasicMaterial({
          blending: THREE.AdditiveBlending,
          color: teal,
          opacity: 0.6,
          transparent: true,
        });
        const envelope = new THREE.LineSegments(
          envelopeOutlineGeometry,
          envelopeMaterial,
        );
        group.add(envelope);
        disposables.push(envelopeOutlineGeometry, envelopeMaterial);

        const pulseVector = new THREE.Vector3();
        const updateDelivery = (elapsedTime: number) => {
          const t = (elapsedTime * 0.32) % 1;
          deliveryCurve.getPoint(t, pulseVector);
          pulsePositionAttribute.setXYZ(
            0,
            pulseVector.x,
            pulseVector.y,
            pulseVector.z,
          );
          pulsePositionAttribute.needsUpdate = true;
          pulseMaterial.opacity = 0.4 + Math.sin(t * Math.PI) * 0.55;
        };

        // Mouse coordinates for interactive parallax
        let mouseX = 0;
        let mouseY = 0;
        let currentParallaxX = 0;
        let currentParallaxY = 0;

        const onMouseMove = (event: MouseEvent) => {
          const rect = host.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;
          const x = event.clientX - rect.left;
          const y = event.clientY - rect.top;
          mouseX = (x / rect.width) * 2 - 1;
          mouseY = -(y / rect.height) * 2 + 1;
        };

        host.addEventListener("mousemove", onMouseMove);

        const clock = new THREE.Clock();
        let frame = 0;
        let inView = true;
        let elapsed = 0;

        const renderFrame = () => {
          const delta = Math.min(clock.getDelta(), 0.05);
          elapsed += delta;

          const currentSection = activeSectionRef.current;

          // Parallax camera lerp
          currentParallaxX += (mouseX - currentParallaxX) * 0.08;
          currentParallaxY += (mouseY - currentParallaxY) * 0.08;

          // Dynamic speeds/sizes based on hovering state
          const isContacts = currentSection === "contacts";
          const isScoring = currentSection === "scoring";
          const isSegmentation = currentSection === "segmentation";
          const isCampaign = currentSection === "campaign";
          const isEmail = currentSection === "email";

          // 1) Funnel rings sync
          ringsList.forEach((item, r) => {
            const ringMat = item.line.material as import("three").LineBasicMaterial;
            if (isSegmentation) {
              const pulseScale = 1.0 + Math.sin(elapsed * 5 + r) * 0.05;
              item.line.scale.set(pulseScale, 1.0, pulseScale);
              ringMat.opacity = item.defaultOpacity + 0.35 + Math.sin(elapsed * 6 + r) * 0.12;
              ringMat.color.copy(cyan);
            } else {
              item.line.scale.set(1.0, 1.0, 1.0);
              ringMat.opacity = item.defaultOpacity;
              const t = r / (ringCount - 1);
              ringMat.color.copy(indigo).lerp(cyan, t);
            }
          });

          // 2) Flow speed multiplier
          const speedMultiplier = isContacts ? 2.5 : 1.0;

          // Update Ambient Leads
          for (let i = 0; i < ambientCount; i += 1) {
            ambientProgress[i] += ambientSpeed[i] * delta * speedMultiplier;
            if (ambientProgress[i] >= 1) {
              ambientProgress[i] -= 1;
              ambientAngle[i] = Math.random() * Math.PI * 2;
            }
            placeLead(ambientPositions, ambientProgress[i], ambientAngle[i], ambientRadiusFactor[i], i);
          }
          ambientPositionAttribute.needsUpdate = true;
          ambientMaterial.size = isContacts ? 0.16 : 0.08;
          ambientMaterial.opacity = isContacts ? 0.95 : 0.6;

          // Update Active Leads
          for (let i = 0; i < activeCount; i += 1) {
            activeProgress[i] += activeSpeed[i] * delta * speedMultiplier;
            if (activeProgress[i] >= 1) {
              activeProgress[i] -= 1;
              activeAngle[i] = Math.random() * Math.PI * 2;
            }
            placeLead(activePositions, activeProgress[i], activeAngle[i], activeRadiusFactor[i], i);
          }
          activePositionAttribute.needsUpdate = true;
          activeMaterial.size = isContacts ? 0.36 : 0.22;
          activeMaterial.opacity = isContacts ? 1.0 : 0.9;

          // 3) Orbiting AI nodes speed multiplier
          const nodeSpeedMultiplier = isScoring ? 3.0 : 1.0;
          updateNodes(elapsed, nodeSpeedMultiplier);
          nodeMaterial.size = isScoring ? 0.7 : 0.45;
          nodeMaterial.opacity = isScoring ? 1.0 : 0.85;
          beamMaterial.opacity = isScoring ? 0.65 : 0.28;

          // 4) Core converging point
          if (isCampaign) {
            coreMaterial.size = 1.8 * (1.0 + Math.sin(elapsed * 8) * 0.22);
            coreMaterial.opacity = 1.0;
          } else {
            coreMaterial.size = 1.1;
            coreMaterial.opacity = 0.7 + Math.sin(elapsed * 2.2) * 0.25;
          }

          // 5) Arc and envelope
          arcMaterial.opacity = isEmail ? 0.75 : 0.26;
          pulseMaterial.size = isEmail ? 0.85 : 0.45;
          envelopeMaterial.opacity = isEmail ? 1.0 : 0.6;

          if (envelopeBodyMesh && envelopeFlapMesh) {
            const bodyMat = envelopeBodyMesh.material as import("three").MeshBasicMaterial;
            const flapMat = envelopeFlapMesh.material as import("three").MeshBasicMaterial;
            bodyMat.opacity = isEmail ? 0.45 : 0.15;
            flapMat.opacity = isEmail ? 0.6 : 0.25;

            const envelopeFloat = isEmail ? 1.05 + Math.sin(elapsed * 6) * 0.05 : 1.0;
            envelope.scale.setScalar(envelopeFloat);
            envelopeBodyMesh.scale.setScalar(envelopeFloat);
            envelopeFlapMesh.scale.setScalar(envelopeFloat);
          }

          updateDelivery(elapsed);

          // Apply rotation including mouse movement
          group.rotation.y = elapsed * 0.08 + currentParallaxX * 0.25;
          group.rotation.x = 0.34 + Math.sin(elapsed * 0.35) * 0.04 - currentParallaxY * 0.15;

          // Camera floats slightly and tracks mouse
          camera.position.x = Math.sin(elapsed * 0.18) * 0.35 + currentParallaxX * 0.8;
          camera.position.y = 0.4 + Math.sin(elapsed * 0.22) * 0.12 + currentParallaxY * 0.6;
          camera.lookAt(0, 0, 0);

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
          host.removeEventListener("mousemove", onMouseMove);
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
