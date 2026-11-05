// Loads MediaPipe Pose Landmarker from this server's own files
// (public/mediapipe/wasm and public/models), never from a CDN.
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";

export type ModelKind = "lite" | "full" | "heavy";

export type Processor = "auto" | "GPU" | "CPU";

const base = import.meta.env.BASE_URL.replace(/\/$/, "");
const cache = new Map<string, Promise<{ landmarker: PoseLandmarker; delegate: "GPU" | "CPU" }>>();

async function create(kind: ModelKind, processor: Processor) {
  const fileset = await FilesetResolver.forVisionTasks(`${base}/mediapipe/wasm`);
  const options = (delegate: "GPU" | "CPU") => ({
    baseOptions: { modelAssetPath: `${base}/models/pose_landmarker_${kind}.task`, delegate },
    runningMode: "VIDEO" as const,
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  if (processor === "CPU") return { landmarker: await PoseLandmarker.createFromOptions(fileset, options("CPU")), delegate: "CPU" as const };
  try {
    return { landmarker: await PoseLandmarker.createFromOptions(fileset, options("GPU")), delegate: "GPU" as const };
  } catch (err) {
    if (processor === "GPU") throw err;
    // No WebGL (or a blocked GPU): the CPU is slower but works everywhere.
    return { landmarker: await PoseLandmarker.createFromOptions(fileset, options("CPU")), delegate: "CPU" as const };
  }
}

/**
 * "auto" tries the GPU (WebGL) first. Some phones (and emulators, whose GPU
 * is software) are faster or steadier on the CPU: the page lets you choose.
 */
export function loadLandmarker(kind: ModelKind, processor: Processor = "auto") {
  const key = `${kind}:${processor}`;
  let p = cache.get(key);
  if (!p) {
    p = create(kind, processor);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

const PROCESSOR_KEY = "normativai.processor";

export function savedProcessor(): Processor {
  try {
    const v = localStorage.getItem(PROCESSOR_KEY);
    return v === "GPU" || v === "CPU" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function saveProcessor(p: Processor) {
  try {
    localStorage.setItem(PROCESSOR_KEY, p);
  } catch {
    /* storage unavailable */
  }
}

export { PoseLandmarker };
