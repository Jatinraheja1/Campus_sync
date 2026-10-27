import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff, ImageUp, RotateCcw } from "lucide-react";

interface Props {
  onChange: (canvas: HTMLCanvasElement | null) => void;
  captureLabel: string;
  facing?: "user" | "environment";
}

type CamState = "off" | "starting" | "on" | "blocked";

/** Camera preview with permission handling, capture, retake, and a photo-upload fallback. */
export default function CameraCapture({ onChange, captureLabel, facing = "user" }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<CamState>("off");
  const [error, setError] = useState<string | null>(null);
  const [shot, setShot] = useState<string | null>(null);

  const stop = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setState("off");
  };
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  const start = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("blocked");
      setError(window.isSecureContext ? "This browser does not support camera access." : "Camera access needs HTTPS or localhost. Open the app from localhost, or upload a photo instead.");
      return;
    }
    setState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) { v.srcObject = stream; await v.play(); }
      setState("on");
    } catch (e) {
      setState("blocked");
      const name = e instanceof DOMException ? e.name : "";
      setError(
        name === "NotAllowedError" ? "Camera permission was blocked. Allow camera access in your browser's site settings, then press Start camera again."
        : name === "NotFoundError" ? "No camera was found on this device. You can upload a photo instead."
        : "The camera could not be started. Close other apps using it, or upload a photo instead."
      );
    }
  };

  const finish = (c: HTMLCanvasElement) => {
    setShot(c.toDataURL("image/jpeg", 0.92)); // preview only, kept in memory
    onChange(c);
  };

  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) { setError("The camera is not ready yet. Wait a moment and try again."); return; }
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    finish(c);
  };

  const retake = () => { setShot(null); setError(null); onChange(null); };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 3200 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      finish(c);
    };
    img.onerror = () => { URL.revokeObjectURL(url); setError("That file could not be read as an image."); };
    img.src = url;
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="camera">
      <div className="camera-box">
        <video ref={videoRef} className="camera-media" playsInline muted style={{ display: state === "on" && !shot ? "block" : "none" }} />
        {shot && <img className="camera-media" src={shot} alt="Captured photo preview" />}
        {!shot && state !== "on" && (
          <div className="camera-empty">
            <CameraOff size={30} />
            <p>{state === "starting" ? "Starting camera…" : "Camera is off"}</p>
          </div>
        )}
      </div>

      {error && <div className="notice notice-error" role="alert">{error}</div>}

      <div className="camera-actions">
        {shot ? (
          <button className="btn btn-outline" onClick={retake}><RotateCcw size={16} /> Retake photo</button>
        ) : state === "on" ? (
          <>
            <button className="btn btn-primary" onClick={capture}><Camera size={16} /> {captureLabel}</button>
            <button className="btn btn-outline" onClick={stop}>Stop camera</button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={() => void start()} disabled={state === "starting"}><Camera size={16} /> Start camera</button>
        )}
        {!shot && (
          <>
            <button className="btn btn-outline" onClick={() => fileRef.current?.click()}><ImageUp size={16} /> Upload a photo instead</button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          </>
        )}
      </div>
    </div>
  );
}
