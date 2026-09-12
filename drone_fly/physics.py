"""MuJoCo rigid-body quadcopter with four rotor forces and a velocity/attitude servo.

World axes: x along the hangar, y left, z up. Camera is gimbal-stabilized along x.
No state teleportation occurs during a step. This is a generic 0.32 kg quadcopter,
not a calibrated model of a commercial airframe.
"""

import base64
import io
import math

import mujoco
import numpy as np
from PIL import Image

from .course import Course, make_course

DT = 1 / 240
CONTROL_DT = 1 / 20
MASS = 0.32
ARM = 0.12
BODY_RADIUS = 0.16
MAX_TIME = 45.0


def model_xml(course: Course) -> str:
    geoms = []
    for i, g in enumerate(course.gates):
        for side in (-1, 1):
            geoms.append(
                f'<geom name="gate_{i}_side_{side}" type="box" '
                f'pos="{g.x} {g.y + side * (g.width / 2 + 0.05)} {g.z}" '
                f'size=".06 .05 {g.height / 2 + 0.1}" rgba=".95 .19 .06 1"/>'
            )
            geoms.append(
                f'<geom name="gate_{i}_bar_{side}" type="box" '
                f'pos="{g.x} {g.y} {g.z + side * (g.height / 2 + 0.05)}" '
                f'size=".06 {g.width / 2} .05" rgba=".95 .19 .06 1"/>'
            )
    for i, o in enumerate(course.obstacles):
        geoms.append(
            f'<geom name="pillar_{i}" type="cylinder" pos="{o.x} {o.y} {o.z}" '
            f'size="{o.radius} {o.height / 2}" rgba=".28 .32 .35 1"/>'
        )
    sites, actuators = [], []
    for i, (x, y, spin) in enumerate(((ARM, ARM, 1), (-ARM, ARM, -1), (-ARM, -ARM, 1), (ARM, -ARM, -1))):
        sites.append(f'<site name="rotor{i}" pos="{x} {y} 0" size=".025"/>')
        actuators.append(
            f'<general name="motor{i}" site="rotor{i}" '
            f'gear="0 0 1 0 0 {spin * 0.015}" ctrllimited="true" ctrlrange="0 2.4"/>'
        )
    return f'''<mujoco model="drone-fly">
      <compiler angle="radian"/>
      <option timestep="{DT}" gravity="0 0 -9.81" integrator="RK4"/>
      <visual><global offwidth="320" offheight="240"/><quality shadowsize="1024"/>
      <headlight ambient=".5 .5 .5" diffuse=".7 .7 .7"/></visual>
      <asset><texture name="floor" type="2d" builtin="checker" width="256" height="256"
        rgb1=".12 .14 .16" rgb2=".16 .18 .20"/>
        <material name="floor" texture="floor" texrepeat="20 8" reflectance="0"/>
      </asset>
      <worldbody>
        <light pos="10 0 6" dir="0 0 -1" diffuse=".7 .7 .7"/>
        <geom name="floor" type="plane" size="45 8 .1" material="floor"/>
        <geom name="leftwall" type="box" pos="15 5 2.5" size="23 .1 2.5" rgba=".18 .20 .23 1"/>
        <geom name="rightwall" type="box" pos="15 -5 2.5" size="23 .1 2.5" rgba=".18 .20 .23 1"/>
        <geom name="backwall" type="box" pos="35 0 2.5" size=".1 5 2.5" rgba=".23 .25 .27 1"/>
        {"".join(geoms)}
        <camera name="onboard" pos=".2 0 1.6" xyaxes="0 -1 0 0 0 1" fovy="75"/>
        <body name="drone" pos="0 0 1.7">
          <freejoint/>
          <inertial pos="0 0 0" mass="{MASS}" diaginertia=".0023 .0023 .004"/>
          <geom name="fuselage" type="ellipsoid" size=".13 .10 .045" rgba=".8 .82 .84 1"/>
          <geom name="arm1" type="capsule" fromto="-.12 -.12 0 .12 .12 0" size=".014"/>
          <geom name="arm2" type="capsule" fromto="-.12 .12 0 .12 -.12 0" size=".014"/>
          {"".join(sites)}
        </body>
      </worldbody><actuator>{"".join(actuators)}</actuator>
    </mujoco>'''


class Flight:
    def __init__(self, seed=42, difficulty="standard", render=True):
        self.course = make_course(seed, difficulty)
        self.model = mujoco.MjModel.from_xml_string(model_xml(self.course))
        self.data = mujoco.MjData(self.model)
        self.body_id = self.model.body("drone").id
        self.camera_id = self.model.camera("onboard").id
        self.renderer = mujoco.Renderer(self.model, height=120, width=160) if render else None
        self.gate_geoms = [
            [self.model.geom(f"gate_{i}_{kind}_{side}").id for kind in ("side", "bar") for side in (-1, 1)]
            for i in range(len(self.course.gates))
        ]
        self.mix = np.array(
            [[1, 1, 1, 1], [ARM, ARM, -ARM, -ARM], [-ARM, ARM, ARM, -ARM], [0.015, -0.015, 0.015, -0.015]]
        )
        self.mix_inv = np.linalg.inv(self.mix)
        self.gate_index = 0
        self.passed = 0
        self.missed = 0
        self.status = "flying"
        self.collision = None
        self.distance = 0.0
        self.energy = 0.0
        self.command = np.zeros(3)
        self.gust = 0.0
        self.last_image = np.zeros((120, 160, 3), dtype=np.uint8)
        mujoco.mj_forward(self.model, self.data)
        self._colors()

    def _colors(self):
        for i, ids in enumerate(self.gate_geoms):
            self.model.geom_rgba[ids] = (
                [0.95, 0.19, 0.06, 1] if i == self.gate_index else [0.24, 0.31, 0.34, 1]
            )

    @property
    def position(self):
        return self.data.qpos[:3].copy()

    @property
    def velocity(self):
        return self.data.qvel[:3].copy()

    def observe(self):
        if self.renderer is None:
            raise RuntimeError("Camera observations require rendering")
        # Mechanically stabilized camera; no attitude-derived synthetic pixels.
        self.model.cam_pos[self.camera_id] = self.position + [0.2, 0, 0.025]
        mujoco.mj_forward(self.model, self.data)
        self.renderer.update_scene(self.data, camera="onboard")
        self.last_image = self.renderer.render().copy()
        return self.last_image

    def jpeg(self):
        stream = io.BytesIO()
        Image.fromarray(self.last_image).save(stream, format="JPEG", quality=80)
        return base64.b64encode(stream.getvalue()).decode()

    def step(self, command):
        command = np.asarray(command, dtype=float)
        if command.shape != (3,) or not np.isfinite(command).all():
            raise ValueError("Velocity command must contain three finite values")
        if self.status != "flying":
            return
        self.command = np.clip(command, [-0.5, -2, -1.5], [2, 2, 1.5])
        previous = self.position
        for _ in range(12):
            rotation = self.data.xmat[self.body_id].reshape(3, 3)
            accel = np.clip(3.5 * (self.command - self.velocity), [-4, -4, -5], [4, 4, 5])
            force = MASS * (accel + [0, 0, 9.81])
            z_des = force / np.linalg.norm(force)
            y_des = np.cross(z_des, [1, 0, 0])
            y_des /= np.linalg.norm(y_des)
            r_des = np.column_stack((np.cross(y_des, z_des), y_des, z_des))
            err_matrix = 0.5 * (r_des.T @ rotation - rotation.T @ r_des)
            err = np.array([err_matrix[2, 1], err_matrix[0, 2], err_matrix[1, 0]])
            torque = -0.09 * err - 0.018 * self.data.qvel[3:6]
            total_thrust = float(np.dot(force, rotation[:, 2]))
            self.data.ctrl[:] = np.clip(self.mix_inv @ np.r_[total_thrust, torque], 0, 2.4)
            t = self.data.time
            wind = self.gust + (0.18 * math.sin(t * 1.7) if self.course.difficulty == "gusts" else 0)
            self.data.xfrc_applied[self.body_id, :3] = [0, wind, 0]
            mujoco.mj_step(self.model, self.data)
            self.energy += float(np.sum(self.data.ctrl**1.5)) * DT
            for c in self.data.contact:
                b1, b2 = self.model.geom_bodyid[c.geom1], self.model.geom_bodyid[c.geom2]
                if self.body_id in (b1, b2) and b1 != b2:
                    other = c.geom2 if b1 == self.body_id else c.geom1
                    self.collision = self.model.geom(other).name
                    self.status = "collision"
            if self.status != "flying":
                break
        now = self.position
        self.distance += float(np.linalg.norm(now - previous))
        if self.gate_index < len(self.course.gates):
            gate = self.course.gates[self.gate_index]
            if previous[0] < gate.x <= now[0]:
                alpha = (gate.x - previous[0]) / (now[0] - previous[0])
                crossing = previous + alpha * (now - previous)
                if (
                    abs(crossing[1] - gate.y) < gate.width / 2 - BODY_RADIUS
                    and abs(crossing[2] - gate.z) < gate.height / 2 - BODY_RADIUS
                ):
                    self.passed += 1
                else:
                    self.missed += 1
                self.gate_index += 1
                self._colors()
        if self.status == "flying":
            if self.gate_index == len(self.course.gates):
                self.status = "complete" if self.missed == 0 else "missed"
            elif self.data.time >= MAX_TIME:
                self.status = "timeout"
            elif now[2] > 5 or now[2] < 0.08 or abs(now[1]) > 5 or now[0] < -2:
                self.status = "out-of-bounds"

    def snapshot(self):
        return {
            "time": float(self.data.time),
            "position": self.position.tolist(),
            "quaternion": self.data.qpos[3:7].tolist(),
            "velocity": self.velocity.tolist(),
            "motors": self.data.ctrl.tolist(),
            "command": self.command.tolist(),
            "gateIndex": self.gate_index,
            "passed": self.passed,
            "missed": self.missed,
            "status": self.status,
            "collision": self.collision,
            "distance": self.distance,
            "energy": self.energy,
        }

    def close(self):
        if self.renderer is not None:
            self.renderer.close()
            self.renderer = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
