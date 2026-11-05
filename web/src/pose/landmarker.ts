// Loads MediaPipe Pose Landmarker from this server's own files
// (public/mediapipe/wasm and public/models), never from a CDN.
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";

export type ModelKind = "lite" | "full" | "heavy";

const base = import.meta.env.BASE_URL.replace(/\/$/, "");
const cache = new Map<string, Promise<{ landmarker: PoseLandmarker; delegate: "GPU" | "CPU" }>>();

async function create(kind: ModelKind) {
  const fileset = await FilesetResolver.forVisionTasks(`${base}/mediapipe/wasm`);
  const options = (delegate: "GPU" | "CPU") => ({
    baseOptions: { modelAssetPath: `${base}/models/pose_landmarker_${kind}.task`, delegate },
    runningMode: "VIDEO" as const,
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  try {
    return { landmarker: await PoseLandmarker.createFromOptions(fileset, options("GPU")), delegate: "GPU" as const };
  } catch {
    // No WebGL (or a blocked GPU): the CPU is slower but works everywhere.
    return { landmarker: await PoseLandmarker.createFromOptions(fileset, options("CPU")), delegate: "CPU" as const };
  }
}

export function loadLandmarker(kind: ModelKind) {
  let p = cache.get(kind);
  if (!p) {
    p = create(kind);
    p.catch(() => cache.delete(kind));
    cache.set(kind, p);
  }
  return p;
}

export { PoseLandmarker };
