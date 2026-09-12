"""Local-only flight laboratory API and static frontend host."""

import asyncio
import json
import sys
import time
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Literal
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .circuit import GRAPH, GRAPH_HASH, MANIFEST, Circuit, Readout
from .experiments import ARTIFACTS, KINDS, ROOT, VERSION, load_models, save_json
from .physics import CONTROL_DT, Flight
from .vision import CHANNELS, encode, visual_servo

LOCAL = ROOT / ".local"
ACTIVE = LOCAL / "active-models.json"


def model_path():
    if ACTIVE.exists():
        candidate = LOCAL / json.loads(ACTIVE.read_text())["path"]
        if candidate.is_relative_to(LOCAL) and candidate.exists():
            return candidate
    return ARTIFACTS / "models.json"


class Command(BaseModel):
    action: Literal["start", "pause", "reset", "controller", "intervention", "gust"]
    seed: int = Field(default=42, ge=0, le=2_000_000_000)
    difficulty: Literal["standard", "slalom", "gusts"] = "standard"
    controller: Literal["connectome", "rewired", "random", "servo"] = "connectome"
    intervention: Literal["none", "blind", "left-eye", "silence", "outputs"] = "none"
    force: float = Field(default=0.0, ge=-0.3, le=0.3)

    model_config = {"extra": "forbid"}


class JobRequest(BaseModel):
    mode: Literal["train", "benchmark"]
    courses: int = Field(default=12, ge=2, le=48)
    model_config = {"extra": "forbid"}


class Jobs:
    def __init__(self):
        self.process = None
        self.task = None
        self.state = {"status": "idle", "message": "Ready for an experiment"}
        self.last_report = None

    async def start(self, request: JobRequest):
        if self.process and self.process.returncode is None:
            raise HTTPException(409, "An experiment is already running")
        folder = LOCAL / "experiments" / datetime.now(UTC).strftime("%Y%m%d-%H%M%S-%f")
        folder.mkdir(parents=True)
        args = [
            sys.executable,
            "-u",
            "-m",
            "drone_fly.experiments",
            request.mode,
            "--courses",
            str(request.courses),
            "--output",
            str(folder),
        ]
        if request.mode == "benchmark":
            args += ["--models", str(model_path())]
        self.process = await asyncio.create_subprocess_exec(
            *args, cwd=ROOT, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
        )
        self.state = {
            "status": "running",
            "mode": request.mode,
            "current": 0,
            "total": request.courses,
            "message": "Starting experiment",
            "history": [],
        }
        self.task = asyncio.create_task(self._watch(folder, request.mode, self.process))
        return self.state

    async def _watch(self, folder, mode, process):
        history = []
        log = []
        try:
            while line := await process.stdout.readline():
                decoded = line.decode(errors="replace").strip()
                log.append(decoded)
                try:
                    event = json.loads(decoded)
                except json.JSONDecodeError:
                    continue
                if event.get("event") == "progress":
                    history.append(
                        {key: event[key] for key in ("phase", "current", "mse", "kind") if key in event}
                    )
                    self.state.update({k: v for k, v in event.items() if k not in {"result", "event"}})
                    self.state["history"] = history[-300:]
            code = await process.wait()
            (folder / "run.log").write_text("\n".join(log))
            if self.state["status"] == "cancelled":
                return
            if code != 0:
                self.state.update(status="failed", message="Experiment failed; details in local run.log")
                return
            if mode == "train":
                load_models(folder / "models.json")
                save_json(ACTIVE, {"path": str((folder / "models.json").relative_to(LOCAL))})
                self.state.update(
                    status="complete", message="Readouts trained. Reset the flight to load them."
                )
            else:
                self.last_report = folder / "benchmark.json"
                self.state.update(status="complete", message="Held-out comparison complete")
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self.state.update(status="failed", message="Could not complete experiment output")
            (folder / "run.log").write_text("\n".join(log) + f"\n{exc}")

    async def cancel(self):
        if self.process and self.process.returncode is None:
            self.state.update(
                status="cancelled", message="Experiment cancelled; previous checkpoint retained"
            )
            self.process.terminate()
            try:
                await asyncio.wait_for(self.process.wait(), 4)
            except TimeoutError:
                self.process.kill()
                await self.process.wait()
        if self.task:
            await self.task
        return self.state


jobs = Jobs()


@asynccontextmanager
async def lifespan(app):
    yield
    await jobs.cancel()


app = FastAPI(title="Drone Fly", lifespan=lifespan)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "testserver"])


def origin_allowed(origin):
    return not origin or urlparse(origin).hostname in {"localhost", "127.0.0.1"}


@app.middleware("http")
async def check_origin(request: Request, call_next):
    if request.method not in {"GET", "HEAD"} and not origin_allowed(request.headers.get("origin")):
        from fastapi.responses import JSONResponse

        return JSONResponse({"detail": "Local origins only"}, status_code=403)
    return await call_next(request)


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": VERSION, "physics": "MuJoCo", "hardware": False}


@app.get("/api/circuit")
async def circuit():
    return {"graph": GRAPH, "hash": GRAPH_HASH, "manifest": MANIFEST, "channels": CHANNELS}


@app.get("/api/models")
async def models():
    try:
        data = load_models(model_path())
        return {k: v for k, v in data.items() if k not in {"models", "teacherResults"}} | {
            "models": {k: {"trainingMSE": v["trainingMSE"]} for k, v in data["models"].items()}
        }
    except (OSError, ValueError):
        return {"available": False, "message": "Train readouts to enable neural controllers"}


@app.get("/api/benchmark")
async def benchmark_report():
    path = jobs.last_report or ARTIFACTS / "benchmark.json"
    if not path.exists():
        return {"conditions": [], "message": "No held-out benchmark yet"}
    return json.loads(path.read_text())


@app.get("/api/jobs")
async def job_status():
    return jobs.state


@app.post("/api/jobs")
async def start_job(request: JobRequest):
    return await jobs.start(request)


@app.delete("/api/jobs")
async def cancel_job():
    return await jobs.cancel()


class Session:
    def __init__(self):
        self.flight = None
        self.running = False
        self.controller = "connectome"
        self.intervention = "none"
        self.models = None
        self.circuit = None
        self.readout = None
        self.sequence = 0
        self.reset(42, "standard")

    def set_controller(self, kind):
        if kind in KINDS and self.models is None:
            raise ValueError("No checkpoint available; train a readout or select Visual servo")
        self.controller = kind
        self.circuit = Circuit(kind if kind in KINDS else "connectome")
        self.readout = Readout(self.models["models"][kind]["coefficients"]) if kind in KINDS else None

    def reset(self, seed, difficulty):
        try:
            self.models = load_models(model_path())
        except (OSError, ValueError):
            self.models = None
            self.controller = "servo"
        new_flight = Flight(seed, difficulty)
        if self.flight:
            self.flight.close()
        self.flight = new_flight
        self.running = False
        self.sequence = 0
        self.intervention = "none"
        self.set_controller(self.controller)

    def apply(self, command):
        if command.action == "start":
            if self.flight.status != "flying":
                raise ValueError("Reset the finished flight before starting again")
            self.running = True
        elif command.action == "pause":
            self.running = False
        elif command.action == "reset":
            self.reset(command.seed, command.difficulty)
        elif command.action == "controller":
            self.set_controller(command.controller)
        elif command.action == "intervention":
            self.intervention = command.intervention
        elif command.action == "gust":
            self.flight.gust = command.force

    def frame(self, advance=True):
        observed_time = float(self.flight.data.time)
        image = self.flight.observe()
        obs, vision, processed = encode(image, self.flight.velocity, self.intervention)
        # Paused frames never advance the recurrent state.
        if self.running and advance:
            output = self.circuit.step(obs, self.intervention)
            command = visual_servo(obs) if self.controller == "servo" else self.readout.act(output)
            self.flight.step(command)
            self.sequence += 1
            if self.flight.status != "flying":
                self.running = False
        self.flight.last_image = processed
        return {
            "type": "frame",
            "sequence": self.sequence,
            **self.flight.snapshot(),
            "observedTime": observed_time,
            "camera": self.flight.jpeg(),
            "observation": obs.tolist(),
            "vision": vision,
            "activity": self.circuit.activity.tolist(),
            "controller": self.controller,
            "intervention": self.intervention,
            "running": self.running,
            "gust": self.flight.gust,
        }


@app.websocket("/ws")
async def live(websocket: WebSocket):
    if not origin_allowed(websocket.headers.get("origin")):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    session = None
    try:
        session = Session()
        await websocket.send_json(
            {
                "type": "init",
                "course": session.flight.course.payload(),
                "version": VERSION,
                "graphHash": GRAPH_HASH,
            }
        )
        await websocket.send_json(session.frame(advance=False))
        while True:
            started = time.perf_counter()
            try:
                raw = await asyncio.wait_for(
                    websocket.receive_text(), timeout=0.001 if session.running else 0.2
                )
                command = Command.model_validate_json(raw)
                session.apply(command)
                if command.action == "reset":
                    await websocket.send_json(
                        {
                            "type": "init",
                            "course": session.flight.course.payload(),
                            "version": VERSION,
                            "graphHash": GRAPH_HASH,
                        }
                    )
                await websocket.send_json(session.frame(advance=False))
            except TimeoutError:
                pass
            except (ValidationError, ValueError) as exc:
                await websocket.send_json({"type": "error", "message": str(exc)[:300]})
            if session.running:
                await websocket.send_json(session.frame())
            await asyncio.sleep(max(0, CONTROL_DT - (time.perf_counter() - started)))
    except WebSocketDisconnect:
        pass
    except Exception:
        try:
            await websocket.send_json(
                {"type": "error", "message": "Simulation connection failed; inspect server log"}
            )
        except Exception:
            pass
        raise
    finally:
        if session and session.flight:
            session.flight.close()


DIST = ROOT / "web" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/")
async def index():
    if not (DIST / "index.html").exists():
        raise HTTPException(503, "Build the workbench first: npm --prefix web run build")
    return FileResponse(DIST / "index.html")


def main():
    import uvicorn

    uvicorn.run("drone_fly.server:app", host="127.0.0.1", port=8765)


if __name__ == "__main__":
    main()
