import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { CircuitData, Frame } from "./types";

export function Brain({
  data,
  frame,
}: {
  data: CircuitData | null;
  frame: Frame | null;
}) {
  const host = useRef<HTMLDivElement>(null),
    live = useRef(frame);
  live.current = frame;
  const [selected, setSelected] = useState<number | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!data || !host.current) return;
    const element = host.current,
      scene = new THREE.Scene();
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setError("3D circuit unavailable");
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    element.append(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
    camera.position.set(0.3, 0.4, 4.2);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.minDistance = 2;
    controls.maxDistance = 7;
    const positions = data.graph.nodes.map(
      (n) => new THREE.Vector3(...(n.position as [number, number, number])),
    );
    const bounds = new THREE.Box3().setFromPoints(positions),
      center = bounds.getCenter(new THREE.Vector3());
    const scale =
      2.5 / Math.max(...bounds.getSize(new THREE.Vector3()).toArray());
    positions.forEach((p) => {
      p.sub(center).multiplyScalar(scale);
      p.y *= -1;
    });
    const spheres: THREE.Mesh[] = [];
    data.graph.nodes.forEach((node, i) => {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(node.role === "output" ? 0.035 : 0.025, 10, 8),
        new THREE.MeshBasicMaterial({ color: "#748085" }),
      );
      mesh.position.copy(positions[i]);
      mesh.userData.index = i;
      scene.add(mesh);
      spheres.push(mesh);
    });
    const lineVertices = new Float32Array(data.graph.edges.length * 6),
      lineColors = new Float32Array(lineVertices.length);
    data.graph.edges.forEach(([a, b], i) => {
      lineVertices.set(positions[a].toArray(), i * 6);
      lineVertices.set(positions[b].toArray(), i * 6 + 3);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(lineVertices, 3),
    );
    geometry.setAttribute("color", new THREE.BufferAttribute(lineColors, 3));
    const lines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.35,
      }),
    );
    scene.add(lines);
    const raycaster = new THREE.Raycaster();
    const onClick = (event: MouseEvent) => {
      const rect = element.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          (-(event.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const hits = raycaster.intersectObjects(spheres);
      setSelected(hits.length ? hits[0].object.userData.index : null);
    };
    element.addEventListener("click", onClick);
    const resize = () => {
      const { width, height } = element.getBoundingClientRect();
      renderer.setSize(width, Math.max(1, height));
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    let raf = 0;
    const color = new THREE.Color();
    const draw = () => {
      const activity = live.current?.activity ?? [];
      for (let i = 0; i < spheres.length; i++) {
        const v = Math.min(1, Math.abs(activity[i] ?? 0) * 2.5);
        color.set("#637278").lerp(new THREE.Color("#ff6348"), v);
        (spheres[i].material as THREE.MeshBasicMaterial).color.copy(color);
        spheres[i].scale.setScalar(1 + v * 0.6);
      }
      data.graph.edges.forEach(([a, , w], i) => {
        const v = Math.min(
          1,
          Math.abs(activity[a] ?? 0) * Math.log1p(w) * 0.35,
        );
        color.setRGB(0.12 + v * 0.6, 0.16 + v * 0.03, 0.18 - v * 0.1);
        lineColors.set(color.toArray(), i * 6);
        lineColors.set(color.toArray(), i * 6 + 3);
      });
      geometry.attributes.color.needsUpdate = true;
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      element.removeEventListener("click", onClick);
      controls.dispose();
      geometry.dispose();
      (lines.material as THREE.Material).dispose();
      spheres.forEach((m) => {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [data]);
  const node = selected !== null ? data?.graph.nodes[selected] : null;
  return (
    <div className="brain-wrap">
      <div
        ref={host}
        className="brain-canvas"
        aria-label="Measured MaleCNS neuron positions colored by simulated activity"
      />
      {error && <p>{error}</p>}
      <div className="brain-caption">
        {node ? (
          <>
            <strong>{node.type}</strong>
            <span>
              Body {node.id} · {node.role} · activity{" "}
              {(frame?.activity[selected!] ?? 0).toFixed(4)}
            </span>
          </>
        ) : (
          <>
            <strong>80 CELLS / 1,296 CONNECTIONS</strong>
            <span>Measured positions · drag to orbit · click a cell</span>
          </>
        )}
      </div>
      {frame?.controller !== "connectome" && frame?.controller !== "servo" && (
        <div className="brain-caveat">
          {frame?.controller === "rewired"
            ? "Rewired activity; lines show the original reference graph."
            : "Random-feature activity; anatomy is reference only."}
        </div>
      )}
    </div>
  );
}
