import { useEffect, useRef, useState } from "react";
import { World } from "./World";
import { Brain } from "./Brain";
import { downloadJSON, parseRecording } from "./recording";
import {
  INTERVENTIONS,
  NAMES,
  type CircuitData,
  type Course,
  type Frame,
  type Intervention,
  type Job,
  type Recording,
  type Report,
} from "./types";

const fmt = (n: number | undefined, digits = 2) =>
  n === undefined ? "—" : n.toFixed(digits);
const api = async (path: string, options?: RequestInit) => {
  const r = await fetch(path, options);
  const data = await r.json();
  if (!r.ok)
    throw Error(
      typeof data.detail === "string" ? data.detail : "Request failed",
    );
  return data;
};

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2)
    return <div className="empty-chart">Telemetry appears during flight</div>;
  const max = Math.max(0.1, ...values.map(Math.abs));
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * 300},${48 - (v / max) * 38}`)
    .join(" ");
  return (
    <svg
      className="sparkline"
      viewBox="0 0 300 100"
      role="img"
      aria-label="Ground speed over recent flight"
    >
      <path d="M0 86H300" stroke="#323a3f" />
      <polyline
        points={points}
        fill="none"
        stroke="#ff634a"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default function App() {
  const [connection, setConnection] = useState("connecting"),
    [error, setError] = useState("");
  const [course, setCourse] = useState<Course | null>(null),
    [frame, setFrame] = useState<Frame | null>(null),
    [circuit, setCircuit] = useState<CircuitData | null>(null);
  const [seed, setSeed] = useState(42),
    [difficulty, setDifficulty] = useState("standard"),
    [tab, setTab] = useState<"flight" | "experiments" | "methods">("flight");
  const [report, setReport] = useState<Report>({ conditions: [] }),
    [job, setJob] = useState<Job>({
      status: "idle",
      message: "Ready for an experiment",
    });
  const [modelInfo, setModelInfo] = useState<{
    samples?: number;
    trainingSeeds?: number[];
    trainableParametersPerModel?: number;
    available?: boolean;
    checkpointHash?: string;
  }>({});
  const [jobCourses, setJobCourses] = useState(12),
    [recording, setRecording] = useState(false),
    [recordCount, setRecordCount] = useState(0);
  const [replay, setReplay] = useState<Recording | null>(null),
    [replayIndex, setReplayIndex] = useState(0),
    [replayPlaying, setReplayPlaying] = useState(false);
  const socket = useRef<WebSocket | null>(null),
    recordingRef = useRef(false),
    recorded = useRef<Frame[]>([]),
    history = useRef<number[]>([]),
    liveFrame = useRef<Frame | null>(null),
    liveCourse = useRef<Course | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  recordingRef.current = recording;
  const send = (command: Record<string, unknown>) => {
    if (socket.current?.readyState === WebSocket.OPEN)
      socket.current.send(JSON.stringify(command));
    else setError("Simulation disconnected. Reconnect to continue.");
  };
  useEffect(() => {
    let stopped = false,
      retry: ReturnType<typeof setTimeout>,
      ws: WebSocket;
    const connect = () => {
      setConnection("connecting");
      ws = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`,
      );
      socket.current = ws;
      ws.onopen = () => {
        setConnection("connected");
        setError("");
      };
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === "init") {
          liveCourse.current = data.course;
          setCourse(data.course);
          history.current = [];
          recorded.current = [];
          setRecordCount(0);
        }
        if (data.type === "frame") {
          liveFrame.current = data;
          setFrame(data);
          if (data.running) {
            history.current = [
              ...history.current.slice(-119),
              Math.hypot(...data.velocity.slice(0, 2)),
            ];
          }
          if (
            recordingRef.current &&
            recorded.current.length < 2400 &&
            data.sequence !== recorded.current.at(-1)?.sequence
          ) {
            recorded.current.push(data);
            setRecordCount(recorded.current.length);
          }
          if (recorded.current.length >= 2400) {
            setRecording(false);
            setError(
              "Recording reached its 2,400-frame limit. Export it to keep this run.",
            );
          }
        }
        if (data.type === "error") setError(data.message);
      };
      ws.onclose = () => {
        setConnection("disconnected");
        if (!stopped) retry = setTimeout(connect, 2500);
      };
      ws.onerror = () => setConnection("disconnected");
    };
    connect();
    api("/api/circuit")
      .then(setCircuit)
      .catch((e) => setError(e.message));
    api("/api/models")
      .then(setModelInfo)
      .catch((e) => setError(e.message));
    api("/api/benchmark")
      .then(setReport)
      .catch((e) => setError(e.message));
    return () => {
      stopped = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, []);
  useEffect(() => {
    let alive = true;
    const poll = () =>
      api("/api/jobs")
        .then((next) => {
          if (!alive) return;
          setJob((old) => {
            if (old.status === "running" && next.status === "complete") {
              api("/api/benchmark").then(setReport);
              api("/api/models").then(setModelInfo);
            }
            return next;
          });
        })
        .catch(() => {});
    poll();
    const timer = setInterval(poll, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!replayPlaying || !replay) return;
    const timer = setInterval(
      () =>
        setReplayIndex((i) => {
          if (i >= replay.frames.length - 1) {
            setReplayPlaying(false);
            return i;
          }
          return i + 1;
        }),
      50,
    );
    return () => clearInterval(timer);
  }, [replayPlaying, replay]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.code !== "Space" ||
        ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(
          (event.target as HTMLElement).tagName,
        )
      )
        return;
      event.preventDefault();
      if (!replay)
        send({ action: liveFrame.current?.running ? "pause" : "start" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [replay]);
  const shown = replay ? replay.frames[replayIndex] : frame,
    shownCourse = replay?.course ?? course;
  const reset = () => {
    setRecording(false);
    setReplay(null);
    setReplayPlaying(false);
    send({ action: "reset", seed, difficulty });
  };
  const runJob = async (mode: "train" | "benchmark") => {
    try {
      setJob(
        await api("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, courses: jobCourses }),
        }),
      );
    } catch (e) {
      setError(String(e));
    }
  };
  const exportRecording = () => {
    if (!liveCourse.current || !circuit || recorded.current.length < 2) {
      setError("Record at least two frames before exporting.");
      return;
    }
    downloadJSON(
      {
        version: "drone-fly-recording-v1",
        graphHash: circuit.hash,
        course: liveCourse.current,
        frames: recorded.current,
      },
      `drone-fly-${liveCourse.current.seed}.json`,
    );
  };
  const active = connection === "connected" && !replay;
  const bbox = shown?.vision.bbox;
  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          className="wordmark"
          href="#"
          aria-label="Drone Fly home"
          onClick={(e) => {
            e.preventDefault();
            setTab("flight");
          }}
        >
          <span className="brand-symbol">↗</span>DRONE<span>FLY</span>
        </a>
        <div className="topbar-caption">CONNECTOME FLIGHT LABORATORY</div>
        <div className="connection">
          <i className={connection === "connected" ? "online" : ""} />
          {connection === "connected"
            ? "LOCAL SIMULATION"
            : connection.toUpperCase()}
        </div>
        <a
          href="https://github.com/mohamedsobhi777/drone-fly"
          target="_blank"
          rel="noreferrer"
          className="source-link"
        >
          SOURCE ↗
        </a>
      </header>
      <div className="intro-row">
        <div>
          <p className="kicker">A SMALL CIRCUIT. A DIFFERENT KIND OF PILOT.</p>
          <h1>Let the fly navigate.</h1>
        </div>
        <div className="intro-note">
          Measured neural wiring.
          <br />
          Simulated flight. Observable decisions.
        </div>
      </div>
      <nav className="main-tabs" aria-label="Workbench sections">
        {(["flight", "experiments", "methods"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-current={tab === t ? "page" : undefined}
          >
            {t === "flight"
              ? "Flight deck"
              : t === "experiments"
                ? "Experiments"
                : "How it works"}
            <span>
              {t === "flight" ? "01" : t === "experiments" ? "02" : "03"}
            </span>
          </button>
        ))}
        <div className="model-tag">
          80 NEURONS <span>/</span> 339 LEARNED WEIGHTS
        </div>
      </nav>
      {error && (
        <div role="alert" className="error-banner">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      {tab === "flight" && (
        <>
          <section className="mission-bar" aria-label="Mission controls">
            <div className="mission-state">
              <span className="small-label">
                {replay ? "RECORDED SESSION" : "MISSION STATUS"}
              </span>
              <strong>
                {replay
                  ? "REPLAY"
                  : shown?.running
                    ? "IN FLIGHT"
                    : shown?.status === "flying"
                      ? shown.time > 0
                        ? "PAUSED"
                        : "READY TO FLY"
                      : (shown?.status.toUpperCase() ?? "CONNECTING")}
              </strong>
            </div>
            <label>
              COURSE SEED
              <input
                type="number"
                value={seed}
                min="0"
                max="2000000000"
                onChange={(e) =>
                  setSeed(
                    Math.min(
                      2000000000,
                      Math.max(0, Math.floor(Number(e.target.value))),
                    ),
                  )
                }
                disabled={!!replay}
              />
            </label>
            <label>
              ENVIRONMENT
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
                disabled={!!replay}
              >
                <option value="standard">Gate corridor</option>
                <option value="slalom">Wide slalom</option>
                <option value="gusts">Crosswind</option>
              </select>
            </label>
            <button className="secondary" onClick={reset} disabled={!active}>
              Reset course
            </button>
            <button
              className="primary flight-button"
              disabled={!active || shown?.status !== "flying"}
              onClick={() =>
                send({ action: shown?.running ? "pause" : "start" })
              }
            >
              {shown?.running ? "Ⅱ  Pause flight" : "↗  Launch flight"}
              <kbd>SPACE</kbd>
            </button>
          </section>
          <div className="flight-grid">
            <section className="panel world-panel">
              <div className="panel-heading">
                <h2>Flight environment</h2>
                <span>{shownCourse?.difficulty.toUpperCase()} / 6-DOF</span>
              </div>
              <World course={shownCourse} frame={shown} />
              <div className="gate-strip">
                <span>GATE PROGRESS</span>
                <div className="gate-markers">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div
                      className={
                        i < (shown?.gateIndex ?? 0)
                          ? "cleared"
                          : i === (shown?.gateIndex ?? 0)
                            ? "current"
                            : ""
                      }
                      key={i}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </div>
                  ))}
                </div>
                <strong>
                  {shown?.passed ?? 0}
                  <span> / 5 PASSED</span>
                </strong>
              </div>
            </section>
            <section className="panel camera-panel">
              <div className="panel-heading">
                <h2>Onboard camera</h2>
                <span>160 × 120 / RGB</span>
              </div>
              <div className="camera-view">
                {shown ? (
                  <img
                    alt="Actual MuJoCo camera image used by the controller"
                    src={`data:image/jpeg;base64,${shown.camera}`}
                  />
                ) : (
                  <div className="camera-loading">Connecting to camera…</div>
                )}
                {bbox && (
                  <div
                    className="vision-box"
                    style={{
                      left: `${bbox[0] * 100}%`,
                      top: `${bbox[1] * 100}%`,
                      width: `${bbox[2] * 100}%`,
                      height: `${bbox[3] * 100}%`,
                    }}
                  />
                )}
                <div className="camera-crosshair">+</div>
                <span className="camera-time">
                  T+ {fmt(shown?.observedTime)} s
                </span>
              </div>
              <div className="camera-data">
                <span>ACTIVE GATE</span>
                <strong>
                  {shown?.vision.visible ? "ACQUIRED" : "NOT VISIBLE"}
                </strong>
                <span>{shown?.vision.pixels ?? 0} target pixels</span>
              </div>
              <div className="sensor-note">
                The controller receives features extracted from this image and
                onboard velocity. Orange identifies the next gate.
              </div>
              <div className="mini-stats">
                <div>
                  <span>FLIGHT TIME</span>
                  <strong>
                    {fmt(shown?.time, 1)}
                    <small>s</small>
                  </strong>
                </div>
                <div>
                  <span>DISTANCE</span>
                  <strong>
                    {fmt(shown?.distance, 1)}
                    <small>m</small>
                  </strong>
                </div>
                <div>
                  <span>GATES MISSED</span>
                  <strong>{shown?.missed ?? 0}</strong>
                </div>
              </div>
            </section>
          </div>
          <div className="analysis-grid">
            <section className="panel brain-panel">
              <div className="panel-heading">
                <h2>The neural pilot</h2>
                <span>MALECNS v1.0</span>
              </div>
              <Brain data={circuit} frame={shown} />
            </section>
            <section className="panel controls-panel">
              <div className="panel-heading">
                <h2>Intervene & observe</h2>
                <span>LIVE CONTROLS</span>
              </div>
              <div className="controls-content">
                <label className="control-label">
                  NAVIGATION CONTROLLER
                  <select
                    value={shown?.controller ?? "connectome"}
                    disabled={!active}
                    onChange={(e) =>
                      send({ action: "controller", controller: e.target.value })
                    }
                  >
                    {Object.entries(NAMES).map(([id, name]) => (
                      <option value={id} key={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="controller-explainer">
                  {shown?.controller === "servo"
                    ? "Handwritten visual steering. Neural activity is monitored but does not drive the aircraft."
                    : "Camera features → fixed substrate → trained velocity readout → flight stabilizer."}
                </p>
                <span className="small-label">
                  NEURAL & SENSORY INTERVENTION
                </span>
                <div className="intervention-grid">
                  {Object.entries(INTERVENTIONS).map(([id, name]) => (
                    <button
                      key={id}
                      disabled={!active}
                      aria-pressed={shown?.intervention === id}
                      onClick={() =>
                        send({
                          action: "intervention",
                          intervention: id as Intervention,
                        })
                      }
                    >
                      {name}
                    </button>
                  ))}
                </div>
                <label className="wind-control">
                  <span>
                    CROSSWIND FORCE <output>{fmt(shown?.gust)} N</output>
                  </span>
                  <input
                    aria-label="Crosswind force"
                    type="range"
                    min="-.3"
                    max=".3"
                    step=".02"
                    value={shown?.gust ?? 0}
                    disabled={!active}
                    onChange={(e) =>
                      send({ action: "gust", force: Number(e.target.value) })
                    }
                  />
                </label>
              </div>
            </section>
            <section className="panel telemetry-panel">
              <div className="panel-heading">
                <h2>Flight telemetry</h2>
                <span>20 Hz</span>
              </div>
              <div className="telemetry-content">
                <div className="speed-title">
                  <span>GROUND SPEED</span>
                  <strong>
                    {shown
                      ? Math.hypot(...shown.velocity.slice(0, 2)).toFixed(2)
                      : "—"}{" "}
                    <small>m/s</small>
                  </strong>
                </div>
                <Sparkline
                  values={
                    replay
                      ? replay.frames
                          .slice(
                            Math.max(0, replayIndex - 120),
                            replayIndex + 1,
                          )
                          .map((f) => Math.hypot(...f.velocity.slice(0, 2)))
                      : history.current
                  }
                />
                <div className="motor-title">
                  ROTOR THRUST <span>NEWTONS</span>
                </div>
                <div className="motor-grid">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i}>
                      <span>M{i + 1}</span>
                      <strong>{fmt(shown?.motors[i], 3)}</strong>
                      <meter
                        min="0"
                        max="2.4"
                        value={shown?.motors[i] ?? 0}
                        aria-label={`Motor ${i + 1} thrust`}
                      />
                    </div>
                  ))}
                </div>
                <div className="commands">
                  <span>VELOCITY COMMAND</span>
                  <samp>
                    {shown?.command.map((v) => v.toFixed(2)).join(" / ") ??
                      "— / — / —"}{" "}
                    m/s
                  </samp>
                </div>
              </div>
            </section>
          </div>
          <section className="recording-bar" aria-label="Recording and replay">
            <div>
              <span className="small-label">FLIGHT RECORDER</span>
              <strong>
                {replay
                  ? `${replayIndex + 1} / ${replay.frames.length} frames`
                  : recording
                    ? `Recording · ${recordCount} frames`
                    : `${recordCount} frames captured`}
              </strong>
            </div>
            {replay ? (
              <>
                <button
                  className="secondary"
                  onClick={() => {
                    if (replayIndex === replay.frames.length - 1)
                      setReplayIndex(0);
                    setReplayPlaying(!replayPlaying);
                  }}
                >
                  {replayPlaying ? "Pause replay" : "Play replay"}
                </button>
                <input
                  aria-label="Replay timeline"
                  type="range"
                  min="0"
                  max={replay.frames.length - 1}
                  value={replayIndex}
                  onChange={(e) => {
                    setReplayPlaying(false);
                    setReplayIndex(Number(e.target.value));
                  }}
                />
                <button
                  className="secondary"
                  onClick={() => {
                    setReplay(null);
                    setReplayPlaying(false);
                  }}
                >
                  Back to live
                </button>
              </>
            ) : (
              <>
                <button
                  className={recording ? "primary" : "secondary"}
                  disabled={!active}
                  onClick={() => {
                    if (!recording) {
                      recorded.current = [];
                      setRecordCount(0);
                    }
                    setRecording(!recording);
                  }}
                >
                  {recording ? "Stop recording" : "Record flight"}
                </button>
                <button
                  className="secondary"
                  disabled={recordCount < 2}
                  onClick={exportRecording}
                >
                  Export recording ↓
                </button>
                <button
                  className="secondary"
                  onClick={() => upload.current?.click()}
                >
                  Load replay ↑
                </button>
              </>
            )}
            <input
              hidden
              ref={upload}
              type="file"
              accept=".json,application/json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file || !circuit) return;
                try {
                  if (file.size > 40 * 1024 * 1024)
                    throw Error("Recording must be smaller than 40 MB.");
                  const data = parseRecording(
                    JSON.parse(await file.text()),
                    circuit.hash,
                  );
                  send({ action: "pause" });
                  setRecording(false);
                  setReplay(data);
                  setReplayIndex(0);
                  setReplayPlaying(false);
                } catch (err) {
                  setError(String(err));
                }
              }}
            />
          </section>
        </>
      )}
      {tab === "experiments" && (
        <section className="experiments">
          <div className="experiment-intro">
            <div>
              <p className="kicker">MAKE THE COMPARISON.</p>
              <h2>Does the wiring matter?</h2>
              <p>
                Train all three readouts on the same camera observations. Then
                fly the same unfamiliar courses, with the same aircraft and
                stabilizer.
              </p>
            </div>
            <div className="training-facts">
              <div>
                <span>TRAINING OBSERVATIONS</span>
                <strong>{modelInfo.samples?.toLocaleString() ?? "—"}</strong>
              </div>
              <div>
                <span>LEARNED WEIGHTS / PILOT</span>
                <strong>{modelInfo.trainableParametersPerModel ?? 339}</strong>
              </div>
            </div>
          </div>
          <div className="experiment-actions">
            <label>
              COURSES PER RUN
              <input
                type="number"
                min="2"
                max="48"
                value={jobCourses}
                onChange={(e) =>
                  setJobCourses(
                    Math.max(
                      2,
                      Math.min(48, Math.floor(Number(e.target.value))),
                    ),
                  )
                }
              />
            </label>
            <button
              className="primary"
              disabled={job.status === "running"}
              onClick={() => runJob("train")}
            >
              Train readouts
            </button>
            <button
              className="secondary"
              disabled={
                job.status === "running" || modelInfo.available === false
              }
              onClick={() => runJob("benchmark")}
            >
              Run held-out comparison
            </button>
            {job.status === "running" && (
              <button
                className="secondary"
                onClick={() =>
                  api("/api/jobs", { method: "DELETE" })
                    .then(setJob)
                    .catch((e) => setError(e.message))
                }
              >
                Cancel experiment
              </button>
            )}
            <button
              className="text-button"
              disabled={!report.conditions.length}
              onClick={() => downloadJSON(report, "drone-fly-benchmark.json")}
            >
              Download results ↓
            </button>
          </div>
          <div className="job-status" role="status">
            <span className={job.status === "running" ? "pulse" : ""}>
              {job.status.toUpperCase()}
            </span>
            <p>{job.message}</p>
            {job.status === "running" && (
              <strong>
                {job.current ?? 0} / {job.total ?? jobCourses}
              </strong>
            )}
          </div>
          <div className="results-wrap">
            <table className="results">
              <caption>
                Held-out flight results{" "}
                {report.evaluationSeeds
                  ? `· ${report.evaluationSeeds.length} paired courses per condition`
                  : ""}
              </caption>
              <thead>
                <tr>
                  <th>Controller / intervention</th>
                  <th>Completed</th>
                  <th>Gates / 5</th>
                  <th>Collisions</th>
                  <th>Mean time</th>
                  <th>Completion · 95% interval</th>
                </tr>
              </thead>
              <tbody>
                {report.conditions.map((c) => (
                  <tr
                    key={`${c.controller}-${c.intervention}`}
                    className={
                      c.controller === "connectome" && c.intervention === "none"
                        ? "highlight-row"
                        : ""
                    }
                  >
                    <td>
                      <strong>{NAMES[c.controller]}</strong>
                      <span>{INTERVENTIONS[c.intervention]}</span>
                    </td>
                    <td>
                      {c.completions} / {c.courses}
                    </td>
                    <td>{c.meanGates.toFixed(2)}</td>
                    <td>{c.collisions}</td>
                    <td>{c.meanTime.toFixed(1)} s</td>
                    <td>
                      {(c.completionRate * 100).toFixed(0)}%
                      <small>
                        {c.completionCI95
                          .map((v) => (v * 100).toFixed(0))
                          .join("–")}
                        %
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!report.conditions.length && (
              <p className="empty-state">
                Run a comparison to generate measured flight results.
              </p>
            )}
          </div>
          <p className="evidence-note">
            {report.checkpointHash &&
              modelInfo.checkpointHash &&
              report.checkpointHash !== modelInfo.checkpointHash && (
                <strong>
                  These results belong to an earlier checkpoint. Run a new
                  comparison to evaluate the current readouts.{" "}
                </strong>
              )}
            These are recorded simulation results, not a claim that biological
            wiring is superior. The conventional visual servo is also the
            imitation teacher. Confidence intervals describe course completion;
            one training run does not measure training-seed robustness. Training
            updates local checkpoints; comparison results change only after a
            new evaluation.
          </p>
        </section>
      )}
      {tab === "methods" && (
        <section className="methods">
          <div className="method-lead">
            <p className="kicker">ANATOMY → COMPUTATION → FLIGHT</p>
            <h2>
              A real circuit.
              <br />
              An engineered experiment.
            </h2>
            <p>
              Drone Fly tests whether a small measured neural graph can carry
              useful visual information into a drone navigation policy.
            </p>
          </div>
          <div className="method-sections">
            <article>
              <h3>01 / What is measured</h3>
              <p>
                80 MaleCNS neurons, 1,296 directed connections and 26,029
                synaptic contacts. The neural view uses their measured cell-body
                positions. This subset comes from Fly Dino’s anatomically
                selected visual-to-descending circuit.
              </p>
            </article>
            <article>
              <h3>02 / What is modeled</h3>
              <p>
                Camera features stimulate selected cells. Signed, normalized
                connections propagate dimensionless activity through simplified
                leaky tanh units. Sixteen output cells feed a fixed nonlinear
                expansion and a trained 339-weight velocity readout. This is not
                measured firing or a whole-brain model.
              </p>
            </article>
            <article>
              <h3>03 / What learns</h3>
              <p>
                Ridge regression imitates an explicit visual-servo teacher. Only
                the output coefficients learn; anatomical edges, feature
                expansion and stabilizer stay fixed. Rewired and random-feature
                controls receive exactly the same training observations and
                readout budget.
              </p>
            </article>
            <article>
              <h3>04 / What flies</h3>
              <p>
                A generic 0.32 kg quadcopter in MuJoCo, driven by four rotor
                thrust actuators. A conventional velocity and attitude
                controller stabilizes it. A gimbal camera looks forward; an
                engineered color detector finds the active orange gate. No
                commercial airframe, raw-pixel neural vision, or physical drone
                deployment is claimed.
              </p>
            </article>
            <article>
              <h3>05 / What the interventions mean</h3>
              <p>
                Camera blackout removes visual pixels while preserving velocity
                sensing. Left masking removes half the image. Cell silencing
                sets modeled activity to zero while retaining the learned
                readout bias. Crosswind applies an external force to the rigid
                body.
              </p>
            </article>
            <article>
              <h3>06 / Sources & credits</h3>
              <p>
                Data:{" "}
                <a
                  href="https://male-cns.janelia.org/"
                  target="_blank"
                  rel="noreferrer"
                >
                  FlyEM / HHMI Janelia and MaleCNS collaborators
                </a>
                , CC BY 4.0. Circuit extraction:{" "}
                <a
                  href="https://github.com/cobanov/flyjump"
                  target="_blank"
                  rel="noreferrer"
                >
                  Fly Dino by Mert Cobanov
                </a>
                . Physics:{" "}
                <a href="https://mujoco.org/" target="_blank" rel="noreferrer">
                  MuJoCo
                </a>
                . Original Drone Fly application code is MIT licensed. See the
                repository for pinned data, methods and reproduction commands.
              </p>
            </article>
          </div>
        </section>
      )}
      <footer>
        <span>
          DRONE FLY <span className="footer-slash">/</span> SIMULATION FIRST
        </span>
        <span>
          Actual camera input. Computed neural activity. Measured outcomes.
        </span>
        <button onClick={() => setTab("methods")}>Methods & credits ↗</button>
      </footer>
    </div>
  );
}
