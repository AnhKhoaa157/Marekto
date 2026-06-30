"use client";

import { useEffect, useRef } from "react";

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
 * Builds a tiny soft radial-gradient sprite for particles.
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

export function Background3D() {
  const layerRef = useRef<HTMLDivElement | null>(null);

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
    let animationFrameId: number;
    let resizeObserver: ResizeObserver;
    let cleanup: (() => void) | null = null;

    import("three")
      .then((THREE) => {
        if (disposed || !layerRef.current) {
          return;
        }

        const host = layerRef.current;
        let width = window.innerWidth;
        let height = window.innerHeight;

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
        canvas.style.position = "absolute";
        canvas.style.top = "0";
        canvas.style.left = "0";
        host.appendChild(canvas);

        const scene = new THREE.Scene();
        // Use a wide angle to give depth
        const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
        camera.position.set(0, 0, 100);
        camera.lookAt(0, 0, 0);

        const group = new THREE.Group();
        scene.add(group);

        const disposables: Array<{ dispose: () => void }> = [];
        const glowTexture = createGlowTexture(THREE);
        disposables.push(glowTexture);

        const particleCount = 1800;
        const positions = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);
        const colors = new Float32Array(particleCount * 3);

        const baseColors = [
          new THREE.Color("#3b82f6"), // blue-500
          new THREE.Color("#6366f1"), // indigo-500
          new THREE.Color("#8b5cf6"), // violet-500
          new THREE.Color("#2dd4bf"), // teal-400
        ];

        for (let i = 0; i < particleCount; i++) {
          // Distribute particles at a balanced distance
          const radius = 60 + Math.random() * 200;
          const theta = Math.random() * 2 * Math.PI;
          const y = (Math.random() - 0.5) * 400;

          positions[i * 3] = Math.cos(theta) * radius;
          positions[i * 3 + 1] = y;
          positions[i * 3 + 2] = Math.sin(theta) * radius;

          sizes[i] = Math.random() * 2.0 + 1.0;

          const color = baseColors[Math.floor(Math.random() * baseColors.length)];
          colors[i * 3] = color.r;
          colors[i * 3 + 1] = color.g;
          colors[i * 3 + 2] = color.b;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
        disposables.push(geometry);

        // Use PointsMaterial for basic particles
        const material = new THREE.PointsMaterial({
          size: 4.5,
          map: glowTexture,
          transparent: true,
          opacity: 0.7,
          vertexColors: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        disposables.push(material);

        const particles = new THREE.Points(geometry, material);
        group.add(particles);

        let mouseX = 0;
        let mouseY = 0;
        let targetX = 0;
        let targetY = 0;

        const onMouseMove = (event: MouseEvent) => {
          mouseX = (event.clientX - window.innerWidth / 2);
          mouseY = (event.clientY - window.innerHeight / 2);
        };
        window.addEventListener("mousemove", onMouseMove);

        const render = () => {
          if (disposed) return;

          // Gentle rotation over time
          group.rotation.y += 0.0005;
          group.rotation.x += 0.0002;

          // Parallax effect based on mouse
          targetX = mouseX * 0.05;
          targetY = mouseY * 0.05;
          camera.position.x += (targetX - camera.position.x) * 0.02;
          camera.position.y += (-targetY - camera.position.y) * 0.02;
          camera.lookAt(0, 0, 0);

          renderer.render(scene, camera);
          animationFrameId = requestAnimationFrame(render);
        };

        render();

        resizeObserver = new ResizeObserver(() => {
          if (disposed) return;
          width = window.innerWidth;
          height = window.innerHeight;
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          renderer.setSize(width, height, false);
        });
        resizeObserver.observe(document.body);

        cleanup = () => {
          disposed = true;
          window.removeEventListener("mousemove", onMouseMove);
          cancelAnimationFrame(animationFrameId);
          if (resizeObserver) resizeObserver.disconnect();
          
          disposables.forEach((d) => d.dispose());
          if (renderer.domElement && renderer.domElement.parentNode) {
            renderer.domElement.parentNode.removeChild(renderer.domElement);
          }
          renderer.dispose();
        };
      })
      .catch((err) => {
        console.error("Failed to load three.js for background:", err);
      });

    return () => {
      disposed = true;
      if (cleanup) {
        cleanup();
      }
    };
  }, []);

  return (
    <div
      ref={layerRef}
      className="pointer-events-none fixed inset-0 z-0"
      aria-hidden="true"
    />
  );
}
